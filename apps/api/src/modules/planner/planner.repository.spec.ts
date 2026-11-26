import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PlanStatus, TaskStatus } from '@aios/shared-types';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { PlannerRepository } from './planner.repository';
import { computeTaskContentHash } from './utils/planner-tree.util';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '22222222-2222-4222-8222-222222222222';
const WORKFLOW_ID = '33333333-3333-4333-8333-333333333333';
const TASK_ID = '44444444-4444-4444-8444-444444444444';
const CHILD_TASK_ID = '55555555-5555-4555-8555-555555555555';

const now = new Date('2026-11-26T10:00:00.000Z');

function getCallArg<T>(fn: jest.Mock, callIndex = 0): T {
  const calls = fn.mock.calls as unknown[][];
  return calls[callIndex]?.[0] as T;
}

const makePlanRow = (overrides: Record<string, unknown> = {}) => ({
  id: PLAN_ID,
  userId: USER_ID,
  workflowId: null,
  title: 'Test Plan',
  description: null,
  status: PlanStatus.ACTIVE,
  version: 1,
  contentHash: 'hash-plan',
  deletedAt: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const makeTaskRow = (overrides: Record<string, unknown> = {}) => ({
  id: TASK_ID,
  planId: PLAN_ID,
  parentTaskId: null,
  title: 'Test Task',
  description: null,
  status: TaskStatus.TODO,
  order: 0,
  dueDate: null,
  version: 1,
  contentHash: 'hash-task',
  deletedAt: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

describe('PlannerRepository', () => {
  let repository: PlannerRepository;
  let prisma: {
    plan: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    task: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      aggregate: jest.Mock;
    };
    workflow: {
      findFirst: jest.Mock;
    };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      plan: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      task: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        aggregate: jest.fn(),
      },
      workflow: {
        findFirst: jest.fn(),
      },
      $queryRaw: jest.fn(),
      $transaction: jest.fn((cb: (tx: unknown) => Promise<unknown>) =>
        cb(prisma),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlannerRepository,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    repository = module.get<PlannerRepository>(PlannerRepository);
  });

  describe('Plan operations', () => {
    it('createPlan enforces userId and computes contentHash', async () => {
      prisma.plan.create.mockResolvedValue(makePlanRow());

      const created = await repository.createPlan(USER_ID, {
        title: 'Test Plan',
        description: null,
        workflowId: null,
        status: PlanStatus.ACTIVE,
      });

      expect(created.id).toBe(PLAN_ID);
      const callArg = getCallArg<{
        data: {
          userId: string;
          title: string;
          version: number;
          contentHash: string;
        };
      }>(prisma.plan.create);
      expect(callArg.data.userId).toBe(USER_ID);
      expect(callArg.data.title).toBe('Test Plan');
      expect(callArg.data.version).toBe(1);
      expect(callArg.data.contentHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('maps Prisma P2002 on createPlan to ConflictException', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique failed', {
        code: 'P2002',
        clientVersion: '6.9.0',
      });
      prisma.plan.create.mockRejectedValue(p2002);

      await expect(
        repository.createPlan(USER_ID, {
          title: 'Test',
          description: null,
          workflowId: WORKFLOW_ID,
          status: PlanStatus.ACTIVE,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('updatePlan locks Plan row, merges business fields for contentHash, and increments version', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: PLAN_ID, status: PlanStatus.ARCHIVED, deletedAt: null },
      ]);
      prisma.plan.findFirst.mockResolvedValue(
        makePlanRow({
          title: 'Original Title',
          description: 'Original Desc',
          status: PlanStatus.ARCHIVED,
        }),
      );
      prisma.plan.update.mockResolvedValue(
        makePlanRow({
          title: 'Original Title',
          description: 'Original Desc',
          status: PlanStatus.ACTIVE,
          version: 2,
        }),
      );

      const updated = await repository.updatePlan(PLAN_ID, USER_ID, {
        status: PlanStatus.ACTIVE,
      });

      expect(updated?.status).toBe(PlanStatus.ACTIVE);
      expect(prisma.$queryRaw).toHaveBeenCalled();

      const updateArg = getCallArg<{
        where: { id: string };
        data: {
          title: string;
          description: string | null;
          status: string;
          version: { increment: number };
          contentHash: string;
        };
      }>(prisma.plan.update);
      expect(updateArg.where).toEqual({ id: PLAN_ID });
      expect(updateArg.data.title).toBe('Original Title');
      expect(updateArg.data.description).toBe('Original Desc');
      expect(updateArg.data.status).toBe(PlanStatus.ACTIVE);
      expect(updateArg.data.version).toEqual({ increment: 1 });
      expect(updateArg.data.contentHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('softDeletePlan cascades tombstone + version increment to child tasks inside transaction', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: PLAN_ID, status: PlanStatus.ACTIVE, deletedAt: null },
      ]);
      prisma.plan.update.mockResolvedValue(makePlanRow({ deletedAt: now }));
      prisma.task.updateMany.mockResolvedValue({ count: 3 });

      const result = await repository.softDeletePlan(PLAN_ID, USER_ID);

      expect(result).toBe(true);
      const planUpdateArg = getCallArg<{
        where: { id: string };
        data: { deletedAt: Date; version: { increment: number } };
      }>(prisma.plan.update);
      expect(planUpdateArg.where).toEqual({ id: PLAN_ID });
      expect(planUpdateArg.data.deletedAt).toBeInstanceOf(Date);
      expect(planUpdateArg.data.version).toEqual({ increment: 1 });

      const taskUpdateArg = getCallArg<{
        where: { planId: string; deletedAt: null };
        data: { deletedAt: Date; version: { increment: number } };
      }>(prisma.task.updateMany);
      expect(taskUpdateArg.where).toEqual({ planId: PLAN_ID, deletedAt: null });
      expect(taskUpdateArg.data.deletedAt).toBeInstanceOf(Date);
      expect(taskUpdateArg.data.version).toEqual({ increment: 1 });
    });
  });

  describe('Task operations with Lock-Before-Read', () => {
    it('createTaskInPlan assigns maxSiblingOrder + 1 when order is omitted', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: PLAN_ID, status: PlanStatus.ACTIVE, deletedAt: null },
      ]);
      prisma.task.aggregate.mockResolvedValue({ _max: { order: 2 } });
      prisma.task.create.mockResolvedValue(makeTaskRow({ order: 3 }));

      const created = await repository.createTaskInPlan(USER_ID, PLAN_ID, {
        title: 'Task 4',
        description: null,
        parentTaskId: null,
        status: TaskStatus.TODO,
        dueDate: null,
      });

      expect(created.order).toBe(3);
      const createArg = getCallArg<{
        data: { planId: string; order: number; version: number };
      }>(prisma.task.create);
      expect(createArg.data.planId).toBe(PLAN_ID);
      expect(createArg.data.order).toBe(3);
      expect(createArg.data.version).toBe(1);
    });

    it('createTaskInPlan rejects archived plans and missing plans', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: PLAN_ID, status: PlanStatus.ARCHIVED, deletedAt: null },
      ]);

      await expect(
        repository.createTaskInPlan(USER_ID, PLAN_ID, {
          title: 'Task',
          description: null,
          parentTaskId: null,
          status: TaskStatus.TODO,
          dueDate: null,
        }),
      ).rejects.toThrow(BadRequestException);

      prisma.$queryRaw.mockResolvedValue([]);
      await expect(
        repository.createTaskInPlan(USER_ID, PLAN_ID, {
          title: 'Task',
          description: null,
          parentTaskId: null,
          status: TaskStatus.TODO,
          dueDate: null,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updateTaskInPlan acquires FOR UPDATE OF p BEFORE reading currentTask and hashes merged business fields', async () => {
      const callOrder: string[] = [];
      prisma.$queryRaw.mockImplementation(() => {
        callOrder.push('lockPlanByTaskIdForUpdate');
        return Promise.resolve([
          { id: PLAN_ID, status: PlanStatus.ACTIVE, deletedAt: null },
        ]);
      });
      prisma.task.findFirst.mockImplementation(() => {
        callOrder.push('task.findFirst');
        return Promise.resolve(
          makeTaskRow({
            title: 'Existing Task',
            description: 'Keep me',
            status: TaskStatus.TODO,
            order: 1,
          }),
        );
      });
      prisma.task.update.mockResolvedValue(
        makeTaskRow({
          title: 'Existing Task',
          description: 'Keep me',
          status: TaskStatus.DONE,
          order: 1,
          version: 2,
        }),
      );

      const updated = await repository.updateTaskInPlan(USER_ID, TASK_ID, {
        status: TaskStatus.DONE,
      });

      expect(callOrder).toEqual([
        'lockPlanByTaskIdForUpdate',
        'task.findFirst',
      ]);
      expect(updated?.status).toBe(TaskStatus.DONE);

      const expectedHash = computeTaskContentHash({
        title: 'Existing Task',
        description: 'Keep me',
        status: TaskStatus.DONE,
        order: 1,
        dueDate: null,
        parentTaskId: null,
      });

      const updateArg = getCallArg<{
        where: { id: string };
        data: {
          title: string;
          description: string | null;
          status: string;
          contentHash: string;
          version: { increment: number };
        };
      }>(prisma.task.update);
      expect(updateArg.where).toEqual({ id: TASK_ID });
      expect(updateArg.data.title).toBe('Existing Task');
      expect(updateArg.data.description).toBe('Keep me');
      expect(updateArg.data.status).toBe(TaskStatus.DONE);
      expect(updateArg.data.contentHash).toBe(expectedHash);
      expect(updateArg.data.version).toEqual({ increment: 1 });
    });

    it('softDeleteTaskCascade locks plan first, cascades across descendants, and preserves contentHash', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: PLAN_ID, status: PlanStatus.ACTIVE, deletedAt: null },
      ]);
      prisma.task.findFirst.mockResolvedValue({ id: TASK_ID });
      prisma.task.findMany.mockResolvedValue([
        { id: TASK_ID, parentTaskId: null },
        { id: CHILD_TASK_ID, parentTaskId: TASK_ID },
      ]);
      prisma.task.updateMany.mockResolvedValue({ count: 2 });

      const result = await repository.softDeleteTaskCascade(USER_ID, TASK_ID);

      expect(result).toEqual({ deletedId: TASK_ID, deletedCount: 2 });
      const updateManyArg = getCallArg<{
        where: { id: { in: string[] }; planId: string; deletedAt: null };
        data: { deletedAt: Date; version: { increment: number } };
      }>(prisma.task.updateMany);
      expect(updateManyArg.where).toEqual({
        id: { in: [TASK_ID, CHILD_TASK_ID] },
        planId: PLAN_ID,
        deletedAt: null,
      });
      expect(updateManyArg.data.deletedAt).toBeInstanceOf(Date);
      expect(updateManyArg.data.version).toEqual({ increment: 1 });
    });
  });

  describe('createPlanWithTaskTree', () => {
    it('creates Plan and nested Tasks atomically inside $transaction', async () => {
      prisma.plan.create.mockResolvedValue(makePlanRow());
      prisma.task.create
        .mockResolvedValueOnce(makeTaskRow({ id: TASK_ID, parentTaskId: null }))
        .mockResolvedValueOnce(
          makeTaskRow({ id: CHILD_TASK_ID, parentTaskId: TASK_ID }),
        );

      const res = await repository.createPlanWithTaskTree(USER_ID, {
        title: 'Goal Plan',
        description: 'Goal',
        workflowId: null,
        tasks: [
          {
            title: 'Root',
            description: null,
            dueDate: null,
            order: 0,
            subTasks: [
              {
                title: 'Child',
                description: null,
                dueDate: null,
                order: 0,
                subTasks: [],
              },
            ],
          },
        ],
      });

      expect(res.plan.id).toBe(PLAN_ID);
      expect(res.tasks).toHaveLength(2);
      const secondCreateArg = getCallArg<{
        data: { parentTaskId: string | null };
      }>(prisma.task.create, 1);
      expect(secondCreateArg.data.parentTaskId).toBe(TASK_ID);
    });
  });
});
