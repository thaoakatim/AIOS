import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PlanStatus, TaskStatus } from '@aios/shared-types';
import { ContextBuilder } from '../../core/context/context-builder';
import { LLMGatewayService } from '../../core/llm/llm-gateway.service';
import type { AuthenticatedUser } from '../auth/entities/authenticated-user.interface';
import { PlannerRepository } from './planner.repository';
import { PlannerService } from './planner.service';

const USER: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'user@aios.local',
  displayName: 'Test User',
  keycloakSubject: null,
  emailVerified: true,
  authMode: 'dev_bypass',
};

const PLAN_ID = '22222222-2222-4222-8222-222222222222';
const WORKFLOW_ID = '33333333-3333-4333-8333-333333333333';
const TASK_ID = '44444444-4444-4444-8444-444444444444';
const now = new Date('2026-11-26T10:00:00.000Z');

describe('PlannerService', () => {
  let service: PlannerService;
  let repository: {
    createPlan: jest.Mock;
    findPlanById: jest.Mock;
    findActivePlanByWorkflowId: jest.Mock;
    findWorkflowById: jest.Mock;
    listPlans: jest.Mock;
    listActivePlansWithTasks: jest.Mock;
    updatePlan: jest.Mock;
    softDeletePlan: jest.Mock;
    createTaskInPlan: jest.Mock;
    findTaskById: jest.Mock;
    listTasksByPlan: jest.Mock;
    updateTaskInPlan: jest.Mock;
    softDeleteTaskCascade: jest.Mock;
    createPlanWithTaskTree: jest.Mock;
  };
  let llmGateway: {
    generateWithContextCheck: jest.Mock;
  };

  beforeEach(async () => {
    repository = {
      createPlan: jest.fn(),
      findPlanById: jest.fn(),
      findActivePlanByWorkflowId: jest.fn(),
      findWorkflowById: jest.fn(),
      listPlans: jest.fn(),
      listActivePlansWithTasks: jest.fn(),
      updatePlan: jest.fn(),
      softDeletePlan: jest.fn(),
      createTaskInPlan: jest.fn(),
      findTaskById: jest.fn(),
      listTasksByPlan: jest.fn(),
      updateTaskInPlan: jest.fn(),
      softDeleteTaskCascade: jest.fn(),
      createPlanWithTaskTree: jest.fn(),
    };

    llmGateway = {
      generateWithContextCheck: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlannerService,
        { provide: PlannerRepository, useValue: repository },
        { provide: LLMGatewayService, useValue: llmGateway },
      ],
    }).compile();

    service = module.get<PlannerService>(PlannerService);
  });

  describe('Plan CRUD & Workflow validation', () => {
    it('creates a standalone Plan when workflowId is omitted', async () => {
      repository.createPlan.mockResolvedValue({
        id: PLAN_ID,
        userId: USER.id,
        workflowId: null,
        title: 'Q4 Roadmap',
        description: null,
        status: PlanStatus.ACTIVE,
        version: 1,
        contentHash: 'abc',
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      });

      const res = await service.createPlan({ title: '  Q4 Roadmap  ' }, USER);

      expect(res.title).toBe('Q4 Roadmap');
      expect(repository.createPlan).toHaveBeenCalledWith(USER.id, {
        title: 'Q4 Roadmap',
        description: null,
        workflowId: null,
        status: PlanStatus.ACTIVE,
      });
    });

    it('rejects createPlan with missing/unowned workflowId (404) or already linked workflowId (409)', async () => {
      repository.findWorkflowById.mockResolvedValue(null);
      await expect(
        service.createPlan({ title: 'Plan', workflowId: WORKFLOW_ID }, USER),
      ).rejects.toThrow(NotFoundException);

      repository.findWorkflowById.mockResolvedValue({ id: WORKFLOW_ID });
      repository.findActivePlanByWorkflowId.mockResolvedValue({ id: PLAN_ID });
      await expect(
        service.createPlan({ title: 'Plan', workflowId: WORKFLOW_ID }, USER),
      ).rejects.toThrow(ConflictException);
    });

    it('validates input types, status, and UUIDs strictly', async () => {
      await expect(service.createPlan({ title: '' }, USER)).rejects.toThrow(
        BadRequestException,
      );

      await expect(
        service.createPlan({ title: 'Valid', status: 'invalid' }, USER),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createPlan({ title: 'Valid', workflowId: 'not-uuid' }, USER),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows un-archiving a Plan from archived to active via updatePlan', async () => {
      repository.updatePlan.mockResolvedValue({
        id: PLAN_ID,
        status: PlanStatus.ACTIVE,
      });

      const updated = await service.updatePlan(
        PLAN_ID,
        { status: PlanStatus.ACTIVE },
        USER,
      );

      expect(updated.status).toBe(PlanStatus.ACTIVE);
      expect(repository.updatePlan).toHaveBeenCalledWith(PLAN_ID, USER.id, {
        title: undefined,
        description: undefined,
        status: PlanStatus.ACTIVE,
      });
    });
  });

  describe('Roadmap & Tasks', () => {
    it('builds hierarchical roadmap and progress metrics', async () => {
      repository.findPlanById.mockResolvedValue({
        id: PLAN_ID,
        userId: USER.id,
        workflowId: null,
        title: 'Plan 1',
        description: null,
        status: PlanStatus.ACTIVE,
        version: 1,
        contentHash: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      repository.listTasksByPlan.mockResolvedValue([
        {
          id: TASK_ID,
          planId: PLAN_ID,
          parentTaskId: null,
          title: 'Root',
          description: null,
          status: TaskStatus.DONE,
          order: 0,
          dueDate: null,
          version: 1,
          contentHash: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: '55555555-5555-4555-8555-555555555555',
          planId: PLAN_ID,
          parentTaskId: TASK_ID,
          title: 'Child',
          description: null,
          status: TaskStatus.BLOCKED,
          order: 0,
          dueDate: null,
          version: 1,
          contentHash: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const roadmap = await service.getRoadmap(PLAN_ID, USER);

      expect(roadmap.progress).toEqual({
        totalTasks: 2,
        todo: 0,
        inProgress: 0,
        blocked: 1,
        done: 1,
        completionRate: 50,
      });
      expect(roadmap.tasks).toHaveLength(1);
      expect(roadmap.tasks[0].subTasks).toHaveLength(1);
    });

    it('rejects invalid dueDate or negative order when creating task', async () => {
      await expect(
        service.createTask(
          PLAN_ID,
          { title: 'T1', dueDate: 'not-a-date' },
          USER,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createTask(PLAN_ID, { title: 'T1', order: -1 }, USER),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('AI Goal Decomposition', () => {
    it('fails fast before calling LLM if workflowId is missing or already linked', async () => {
      repository.findWorkflowById.mockResolvedValue(null);

      await expect(
        service.decomposeGoal(
          { goal: 'Build AIOS', workflowId: WORKFLOW_ID },
          USER,
        ),
      ).rejects.toThrow(NotFoundException);

      expect(llmGateway.generateWithContextCheck).not.toHaveBeenCalled();
    });

    it('supports dryRun=true without persisting to repository', async () => {
      llmGateway.generateWithContextCheck.mockResolvedValue({
        message: {
          role: 'assistant',
          content: JSON.stringify({
            title: 'AIOS Sprint 3',
            tasks: [{ title: 'Implement Planner', subTasks: [] }],
          }),
        },
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        finishReason: 'stop',
        trimmed: false,
      });

      const res = await service.decomposeGoal(
        { goal: 'Build Planner', dryRun: true },
        USER,
      );

      expect(res.dryRun).toBe(true);
      if (res.dryRun) {
        expect(res.title).toBe('AIOS Sprint 3');
        expect(res.tasks).toHaveLength(1);
      }
      expect(repository.createPlanWithTaskTree).not.toHaveBeenCalled();
    });

    it('persists decomposed tree when dryRun is false', async () => {
      llmGateway.generateWithContextCheck.mockResolvedValue({
        message: {
          role: 'assistant',
          content: JSON.stringify({
            title: 'AIOS Sprint 3',
            tasks: [{ title: 'Task 1', subTasks: [{ title: 'Sub 1' }] }],
          }),
        },
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        finishReason: 'stop',
        trimmed: false,
      });
      repository.createPlanWithTaskTree.mockResolvedValue({
        plan: {
          id: PLAN_ID,
          userId: USER.id,
          workflowId: null,
          title: 'AIOS Sprint 3',
          description: 'Build Planner',
          status: PlanStatus.ACTIVE,
          version: 1,
          contentHash: 'h',
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        },
        tasks: [
          {
            id: TASK_ID,
            planId: PLAN_ID,
            parentTaskId: null,
            title: 'Task 1',
            description: null,
            status: TaskStatus.TODO,
            order: 0,
            dueDate: null,
            version: 1,
            contentHash: 't1',
            deletedAt: null,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: '55555555-5555-4555-8555-555555555555',
            planId: PLAN_ID,
            parentTaskId: TASK_ID,
            title: 'Sub 1',
            description: null,
            status: TaskStatus.TODO,
            order: 0,
            dueDate: null,
            version: 1,
            contentHash: 't2',
            deletedAt: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });

      const res = await service.decomposeGoal(
        { goal: 'Build Planner', dryRun: false },
        USER,
      );

      expect(res.dryRun).toBe(false);
      if (!res.dryRun) {
        expect(res.plan.id).toBe(PLAN_ID);
        expect(res.progress.totalTasks).toBe(2);
        expect(res.tasks[0].subTasks).toHaveLength(1);
      }
    });

    it('throws UnprocessableEntityException (422) when LLM returns invalid JSON and BadGatewayException (502) on LLM error', async () => {
      llmGateway.generateWithContextCheck.mockResolvedValue({
        message: { role: 'assistant', content: 'invalid json' },
      });

      await expect(
        service.decomposeGoal({ goal: 'Build Planner' }, USER),
      ).rejects.toThrow(UnprocessableEntityException);

      llmGateway.generateWithContextCheck.mockRejectedValue(
        new Error('Network timeout'),
      );

      await expect(
        service.decomposeGoal({ goal: 'Build Planner' }, USER),
      ).rejects.toThrow(BadGatewayException);
    });
  });

  describe('Immutable Context Enrichment', () => {
    it('enriches AgentExecutionContext immutably via ContextBuilder', async () => {
      repository.listActivePlansWithTasks.mockResolvedValue([
        {
          id: PLAN_ID,
          title: 'Active Plan',
          status: PlanStatus.ACTIVE,
          tasks: [
            {
              id: TASK_ID,
              title: 'Pending Task',
              status: TaskStatus.IN_PROGRESS,
              dueDate: now,
            },
          ],
        },
      ]);

      const baseCtx = new ContextBuilder()
        .setExecutionId('exec-1')
        .setUserId(USER.id)
        .setSessionId('sess-1')
        .setQuery('What should I work on?')
        .build();

      const enriched = await service.enrichContext(baseCtx);

      expect(baseCtx.context.activePlans).toBeUndefined();
      expect(Object.isFrozen(enriched)).toBe(true);
      expect(enriched.context.activePlans).toEqual({
        totalActivePlans: 1,
        plans: [
          {
            id: PLAN_ID,
            title: 'Active Plan',
            status: PlanStatus.ACTIVE,
            tasks: [
              {
                id: TASK_ID,
                title: 'Pending Task',
                status: TaskStatus.IN_PROGRESS,
                dueDate: '2026-11-26',
              },
            ],
          },
        ],
      });
    });
  });
});
