import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ITask } from '@aios/shared-types';
import { PlanStatus, TaskStatus } from '@aios/shared-types';
import {
  MAX_TASK_DEPTH,
  buildTaskTree,
  collectDescendantIds,
  computePlanContentHash,
  computePlanProgress,
  computeTaskContentHash,
  extractAndValidateDecompositionJson,
  validateReparenting,
} from './planner-tree.util';

const makeTask = (overrides: Partial<ITask> & { id: string }): ITask => ({
  id: overrides.id,
  planId: overrides.planId ?? 'plan-1',
  parentTaskId: overrides.parentTaskId ?? null,
  title: overrides.title ?? `Task ${overrides.id}`,
  description: overrides.description ?? null,
  status: overrides.status ?? TaskStatus.TODO,
  order: overrides.order ?? 0,
  dueDate: overrides.dueDate ?? null,
  version: overrides.version ?? 1,
  contentHash: overrides.contentHash ?? null,
  deletedAt: overrides.deletedAt ?? null,
  createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: overrides.updatedAt ?? new Date('2026-01-01T00:00:00.000Z'),
});

describe('planner-tree.util', () => {
  describe('buildTaskTree', () => {
    it('builds nested tree sorted by (order, createdAt, id)', () => {
      const tasks = [
        makeTask({ id: 't2', order: 1 }),
        makeTask({ id: 't1', order: 0 }),
        makeTask({ id: 't1-b', parentTaskId: 't1', order: 1 }),
        makeTask({ id: 't1-a', parentTaskId: 't1', order: 0 }),
        makeTask({ id: 't1-a-1', parentTaskId: 't1-a', order: 0 }),
      ];

      const { roots, orphanIds } = buildTaskTree(tasks);

      expect(orphanIds).toEqual([]);
      expect(roots.map((r) => r.id)).toEqual(['t1', 't2']);
      expect(roots[0].subTasks.map((c) => c.id)).toEqual(['t1-a', 't1-b']);
      expect(roots[0].subTasks[0].subTasks.map((g) => g.id)).toEqual([
        't1-a-1',
      ]);
    });

    it('recovers orphaned active tasks by promoting them to root', () => {
      const tasks = [
        makeTask({ id: 't1', parentTaskId: null }),
        makeTask({ id: 'orphan', parentTaskId: 'missing-parent' }),
        makeTask({ id: 'self', parentTaskId: 'self' }),
      ];

      const { roots, orphanIds } = buildTaskTree(tasks);

      expect(roots.map((r) => r.id)).toEqual(['orphan', 'self', 't1']);
      expect(orphanIds).toEqual(['orphan', 'self']);
    });
  });

  describe('computePlanProgress', () => {
    it('returns completionRate = 0 when plan has no tasks', () => {
      expect(computePlanProgress([])).toEqual({
        totalTasks: 0,
        todo: 0,
        inProgress: 0,
        blocked: 0,
        done: 0,
        completionRate: 0,
      });
    });

    it('computes accurate counts and percentage rounded to 2 decimal places', () => {
      const progress = computePlanProgress([
        { status: TaskStatus.TODO },
        { status: TaskStatus.IN_PROGRESS },
        { status: TaskStatus.BLOCKED },
        { status: TaskStatus.DONE },
        { status: TaskStatus.DONE },
        { status: TaskStatus.TODO },
      ]);

      expect(progress).toEqual({
        totalTasks: 6,
        todo: 2,
        inProgress: 1,
        blocked: 1,
        done: 2,
        completionRate: 33.33,
      });
    });
  });

  describe('validateReparenting', () => {
    it('rejects self-parenting', () => {
      const tasks = [makeTask({ id: 'a' })];
      expect(() => validateReparenting(tasks, 'a', 'a')).toThrow(
        BadRequestException,
      );
    });

    it('rejects cycles (descendant as parent)', () => {
      const tasks = [
        makeTask({ id: 'a', parentTaskId: null }),
        makeTask({ id: 'b', parentTaskId: 'a' }),
        makeTask({ id: 'c', parentTaskId: 'b' }),
      ];
      expect(() => validateReparenting(tasks, 'a', 'c')).toThrow(
        BadRequestException,
      );
    });

    it('rejects cross-plan or missing parentTaskId', () => {
      const tasks = [makeTask({ id: 'a', parentTaskId: null })];
      expect(() => validateReparenting(tasks, 'a', 'other-plan-task')).toThrow(
        BadRequestException,
      );
    });

    it('rejects reparenting when subtree height pushes descendants past MAX_TASK_DEPTH', () => {
      // Branch P: p1 -> p2 -> p3 -> p4 (p4 ở độ sâu 4)
      // Subtree A: a -> a1 -> a2 (height = 2)
      // Gắn A dưới p4 => A ở tầng 5, a1 ở tầng 6, a2 ở tầng 7 (> 5)
      const tasks = [
        makeTask({ id: 'p1', parentTaskId: null }),
        makeTask({ id: 'p2', parentTaskId: 'p1' }),
        makeTask({ id: 'p3', parentTaskId: 'p2' }),
        makeTask({ id: 'p4', parentTaskId: 'p3' }),
        makeTask({ id: 'a', parentTaskId: null }),
        makeTask({ id: 'a1', parentTaskId: 'a' }),
        makeTask({ id: 'a2', parentTaskId: 'a1' }),
      ];

      expect(() =>
        validateReparenting(tasks, 'a', 'p4', MAX_TASK_DEPTH),
      ).toThrow(BadRequestException);
    });

    it('allows reparenting when depth(newParent) + 1 + subtreeHeight <= MAX_TASK_DEPTH', () => {
      // p1 -> p2 (depth 2) + A (height 2) => 2 + 1 + 2 = 5 <= 5
      const tasks = [
        makeTask({ id: 'p1', parentTaskId: null }),
        makeTask({ id: 'p2', parentTaskId: 'p1' }),
        makeTask({ id: 'a', parentTaskId: null }),
        makeTask({ id: 'a1', parentTaskId: 'a' }),
        makeTask({ id: 'a2', parentTaskId: 'a1' }),
      ];

      expect(() =>
        validateReparenting(tasks, 'a', 'p2', MAX_TASK_DEPTH),
      ).not.toThrow();
    });
  });

  describe('collectDescendantIds', () => {
    it('collects root and all descendants iteratively', () => {
      const tasks = [
        makeTask({ id: 'root', parentTaskId: null }),
        makeTask({ id: 'c1', parentTaskId: 'root' }),
        makeTask({ id: 'c2', parentTaskId: 'root' }),
        makeTask({ id: 'g1', parentTaskId: 'c1' }),
        makeTask({ id: 'other', parentTaskId: null }),
      ];

      expect(collectDescendantIds(tasks, 'root').sort()).toEqual([
        'c1',
        'c2',
        'g1',
        'root',
      ]);
    });
  });

  describe('contentHash helpers', () => {
    it('produces identical hash for equivalent business fields regardless of Date vs ISO string', () => {
      const h1 = computeTaskContentHash({
        title: 'Task',
        description: null,
        status: TaskStatus.TODO,
        order: 0,
        dueDate: new Date('2026-12-01T00:00:00.000Z'),
        parentTaskId: null,
      });
      const h2 = computeTaskContentHash({
        title: 'Task',
        description: null,
        status: TaskStatus.TODO,
        order: 0,
        dueDate: '2026-12-01T00:00:00.000Z',
        parentTaskId: null,
      });
      expect(h1).toBe(h2);
      expect(h1).toHaveLength(64);

      const p1 = computePlanContentHash({
        title: 'Plan',
        description: 'Desc',
        status: PlanStatus.ACTIVE,
        workflowId: null,
      });
      expect(p1).toHaveLength(64);
    });
  });

  describe('extractAndValidateDecompositionJson', () => {
    const fixedNow = new Date('2026-11-26T00:00:00.000Z');

    it('parses markdown-fenced JSON with braces inside strings', () => {
      const raw = [
        'Here is your plan:',
        '```json',
        JSON.stringify({
          title: 'Launch {AIOS} v1',
          tasks: [
            {
              title: 'Design Schema',
              description: 'Check {plans} and {tasks}',
              dueDaysOffset: 2,
              subTasks: [{ title: 'Add Partial Index' }],
            },
          ],
        }),
        '```',
      ].join('\n');

      const result = extractAndValidateDecompositionJson(raw, 2, 50, fixedNow);

      expect(result.title).toBe('Launch {AIOS} v1');
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].dueDate).toBe('2026-11-28T00:00:00.000Z');
      expect(result.tasks[0].subTasks[0]).toMatchObject({
        title: 'Add Partial Index',
        order: 0,
        subTasks: [],
      });
    });

    it('throws UnprocessableEntityException for malformed JSON or depth overflow', () => {
      expect(() =>
        extractAndValidateDecompositionJson('not json at all', 2),
      ).toThrow(UnprocessableEntityException);

      const tooDeep = JSON.stringify({
        tasks: [
          {
            title: 'L1',
            subTasks: [{ title: 'L2', subTasks: [{ title: 'L3' }] }],
          },
        ],
      });
      expect(() => extractAndValidateDecompositionJson(tooDeep, 2)).toThrow(
        UnprocessableEntityException,
      );
    });

    it('rejects invalid dueDaysOffset or excessive task count', () => {
      const badOffset = JSON.stringify({
        tasks: [{ title: 'T1', dueDaysOffset: -5 }],
      });
      expect(() => extractAndValidateDecompositionJson(badOffset, 2)).toThrow(
        UnprocessableEntityException,
      );

      const tooMany = JSON.stringify({
        tasks: [{ title: 'T1' }, { title: 'T2' }, { title: 'T3' }],
      });
      expect(() => extractAndValidateDecompositionJson(tooMany, 2, 2)).toThrow(
        UnprocessableEntityException,
      );
    });
  });
});
