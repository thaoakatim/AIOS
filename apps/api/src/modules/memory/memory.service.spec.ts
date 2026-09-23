import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { MemoryService } from './memory.service';

describe('MemoryService', () => {
  let service: MemoryService;

  const prismaMock = {
    memoryRecord: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    agentSession: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<MemoryService>(MemoryService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('buildUserProfile maps key -> value', () => {
    const profile = service.buildUserProfile([
      {
        id: 'id-1',
        sourceAgentSessionId: null,
        scope: 'global',
        category: 'preference',
        key: 'preference.language',
        value: 'Tiếng Việt',
        updatedAt: new Date(),
      },
    ]);
    expect(profile).toEqual({ 'preference.language': 'Tiếng Việt' });
  });

  it('formatMemoryForPrompt renders empty string when no records', () => {
    expect(service.formatMemoryForPrompt([])).toBe('');
  });

  it('recall ranks keyword-matching records first', async () => {
    const now = new Date();
    prismaMock.memoryRecord.findMany.mockResolvedValue([
      {
        id: 'id-1',
        sourceAgentSessionId: null,
        scope: 'global',
        category: 'fact',
        key: 'project.stack',
        value: 'Dự án dùng NestJS và PostgreSQL',
        updatedAt: now,
      },
      {
        id: 'id-2',
        sourceAgentSessionId: null,
        scope: 'global',
        category: 'preference',
        key: 'preference.food',
        value: 'Thích ăn phở bò',
        updatedAt: now,
      },
    ]);

    const result = await service.recall('Dự án dùng công nghệ gì?');
    expect(result.map((r) => r.key)).toEqual([
      'project.stack',
      'preference.food',
    ]);
  });

  it('getRelevantMemory accepts an AgentExecutionContext', async () => {
    prismaMock.memoryRecord.findMany.mockResolvedValue([]);
    const result = await service.getRelevantMemory({
      executionId: 'exec-1',
      sessionId: '123e4567-e89b-12d3-a456-426614174000',
      query: 'hello',
      context: { userProfile: {}, systemRules: [], activePlans: {} },
      availableTools: [],
      metadata: {},
    });
    expect(result).toEqual([]);
    expect(prismaMock.memoryRecord.findMany).toHaveBeenCalled();
  });

  it('upsert creates when key does not exist', async () => {
    prismaMock.memoryRecord.findUnique.mockResolvedValue(null);
    prismaMock.memoryRecord.create.mockResolvedValue({
      id: 'new-id',
      sourceAgentSessionId: null,
      scope: 'global',
      category: 'profile',
      key: 'user.name',
      value: 'Huy',
      updatedAt: new Date(),
    });

    const { data, created } = await service.upsert({
      key: 'user.name',
      value: 'Huy',
      category: 'profile',
    });
    expect(created).toBe(true);
    expect(data.key).toBe('user.name');
  });

  it('create throws Conflict when key already exists', async () => {
    prismaMock.memoryRecord.findUnique.mockResolvedValue({ id: 'x' });
    await expect(
      service.create({ key: 'a', value: 'b', category: 'fact' }),
    ).rejects.toThrow('đã tồn tại');
  });

  it('create throws BadRequest on invalid category', async () => {
    await expect(
      service.create({ key: 'a', value: 'b', category: 'invalid' }),
    ).rejects.toThrow('không hợp lệ');
  });
  it('enrichContext merges memory without mutating the original ctx', () => {
    const ctx: Parameters<MemoryService['enrichContext']>[0] = {
      executionId: 'exec-1',
      sessionId: 'session-1',
      query: 'Xin chào',
      context: {
        userProfile: { existing: 'keep' },
        systemRules: [],
        activePlans: {},
      },
      availableTools: [],
      metadata: {},
    };
    const enriched = service.enrichContext(ctx, [
      {
        id: 'id-1',
        sourceAgentSessionId: null,
        scope: 'global',
        category: 'profile',
        key: 'user.name',
        value: 'Huy',
        updatedAt: new Date(),
      },
    ]);
    expect(enriched.context.userProfile).toEqual({
      existing: 'keep',
      'user.name': 'Huy',
    });
    expect(ctx.context.userProfile).toEqual({ existing: 'keep' });
  });
});
