import { Test, TestingModule } from '@nestjs/testing';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';

describe('MemoryController', () => {
  let controller: MemoryController;

  const memoryServiceMock = {
    create: jest.fn(),
    upsert: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    findByKey: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    getRelevantMemoryByQuery: jest.fn(),
    buildUserProfile: jest.fn(),
    formatMemoryForPrompt: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MemoryController],
      providers: [{ provide: MemoryService, useValue: memoryServiceMock }],
    }).compile();

    controller = module.get<MemoryController>(MemoryController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('create delegates to MemoryService', async () => {
    memoryServiceMock.create.mockResolvedValue({ id: 'id-1' });
    const dto = { key: 'user.name', value: 'Huy', category: 'profile' };
    await expect(controller.create(dto)).resolves.toEqual({ id: 'id-1' });
    expect(memoryServiceMock.create).toHaveBeenCalledWith(dto);
  });

  it('getRelevant maps query params to RelevantMemoryQueryDto', async () => {
    memoryServiceMock.getRelevantMemoryByQuery.mockResolvedValue([]);
    await controller.getRelevant('hello', undefined, undefined, undefined, '5');
    expect(memoryServiceMock.getRelevantMemoryByQuery).toHaveBeenCalledWith({
      query: 'hello',
      sessionId: undefined,
      scope: undefined,
      category: undefined,
      limit: 5,
    });
  });
});
