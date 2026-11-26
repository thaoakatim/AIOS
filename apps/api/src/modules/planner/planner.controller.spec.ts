import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/entities/authenticated-user.interface';
import { PlannerController } from './planner.controller';
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
const TASK_ID = '44444444-4444-4444-8444-444444444444';

describe('PlannerController', () => {
  let controller: PlannerController;
  let service: {
    decomposeGoal: jest.Mock;
    createPlan: jest.Mock;
    listPlans: jest.Mock;
    getRoadmap: jest.Mock;
    getPlan: jest.Mock;
    updatePlan: jest.Mock;
    deletePlan: jest.Mock;
    createTask: jest.Mock;
    listTasksByPlan: jest.Mock;
    updateTask: jest.Mock;
    deleteTask: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      decomposeGoal: jest.fn(),
      createPlan: jest.fn(),
      listPlans: jest.fn(),
      getRoadmap: jest.fn(),
      getPlan: jest.fn(),
      updatePlan: jest.fn(),
      deletePlan: jest.fn(),
      createTask: jest.fn(),
      listTasksByPlan: jest.fn(),
      updateTask: jest.fn(),
      deleteTask: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlannerController],
      providers: [{ provide: PlannerService, useValue: service }],
    }).compile();

    controller = module.get<PlannerController>(PlannerController);
  });

  it('delegates decomposeGoal with @CurrentUser()', async () => {
    const dto = { goal: 'Ship Planner', dryRun: true };
    service.decomposeGoal.mockResolvedValue({
      dryRun: true,
      title: 'T',
      tasks: [],
    });

    await controller.decomposeGoal(dto, USER);

    expect(service.decomposeGoal).toHaveBeenCalledWith(dto, USER);
  });

  it('delegates plan CRUD and roadmap operations with user context', async () => {
    await controller.createPlan({ title: 'Plan 1' }, USER);
    expect(service.createPlan).toHaveBeenCalledWith({ title: 'Plan 1' }, USER);

    await controller.listPlans(USER, 'active', 'roadmap', '10', '5');
    expect(service.listPlans).toHaveBeenCalledWith(
      { status: 'active', search: 'roadmap', limit: 10, offset: 5 },
      USER,
    );

    await controller.getRoadmap(PLAN_ID, USER);
    expect(service.getRoadmap).toHaveBeenCalledWith(PLAN_ID, USER);

    await controller.getPlan(PLAN_ID, USER);
    expect(service.getPlan).toHaveBeenCalledWith(PLAN_ID, USER);

    await controller.updatePlan(PLAN_ID, { status: 'completed' }, USER);
    expect(service.updatePlan).toHaveBeenCalledWith(
      PLAN_ID,
      { status: 'completed' },
      USER,
    );

    await controller.deletePlan(PLAN_ID, USER);
    expect(service.deletePlan).toHaveBeenCalledWith(PLAN_ID, USER);
  });

  it('delegates task CRUD operations with user context', async () => {
    await controller.createTask(PLAN_ID, { title: 'Task 1' }, USER);
    expect(service.createTask).toHaveBeenCalledWith(
      PLAN_ID,
      { title: 'Task 1' },
      USER,
    );

    await controller.listTasksByPlan(PLAN_ID, USER);
    expect(service.listTasksByPlan).toHaveBeenCalledWith(PLAN_ID, USER);

    await controller.updateTask(TASK_ID, { status: 'done' }, USER);
    expect(service.updateTask).toHaveBeenCalledWith(
      TASK_ID,
      { status: 'done' },
      USER,
    );

    await controller.deleteTask(TASK_ID, USER);
    expect(service.deleteTask).toHaveBeenCalledWith(TASK_ID, USER);
  });
});
