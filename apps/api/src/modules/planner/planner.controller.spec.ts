import { Test, TestingModule } from '@nestjs/testing';
import { PlannerController } from './planner.controller';
import { PlannerService } from './planner.service';

describe('PlannerController', () => {
  let controller: PlannerController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlannerController],
      providers: [PlannerService],
    }).compile();

    controller = module.get<PlannerController>(PlannerController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
