import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { MemoryRepository } from './memory.repository';

describe('MemoryRepository', () => {
  let repository: MemoryRepository;

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
        MemoryRepository,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    repository = module.get<MemoryRepository>(MemoryRepository);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  it('create delegates to prisma.memoryRecord.create', async () => {
    prismaMock.memoryRecord.create.mockResolvedValue({ id: 'id-1' });
    const data = {
      key: 'user.name',
      value: 'Huy',
      category: 'profile',
      scope: 'global',
      sourceAgentSessionId: null,
    };
    await expect(repository.create(data)).resolves.toEqual({ id: 'id-1' });
    expect(prismaMock.memoryRecord.create).toHaveBeenCalledWith({
      data,
    });
  });

  it('findManyAndCount builds search where clause and paginates', async () => {
    prismaMock.memoryRecord.findMany.mockResolvedValue([]);
    prismaMock.memoryRecord.count.mockResolvedValue(0);

    await repository.findManyAndCount({
      search: 'phở',
      take: 10,
      skip: 5,
    });

    expect(prismaMock.memoryRecord.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { key: { contains: 'phở', mode: 'insensitive' } },
          { value: { contains: 'phở', mode: 'insensitive' } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      skip: 5,
    });
    expect(prismaMock.memoryRecord.count).toHaveBeenCalled();
  });

  it('findRecallCandidates scopes to global + own conversation session', async () => {
    prismaMock.memoryRecord.findMany.mockResolvedValue([]);
    const sessionId = '123e4567-e89b-12d3-a456-426614174000';

    await repository.findRecallCandidates({ sessionId, take: 200 });

    expect(prismaMock.memoryRecord.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { scope: 'global' },
          { scope: 'conversation', sourceAgentSessionId: sessionId },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
  });

  it('update maps null sourceAgentSessionId to disconnect', async () => {
    prismaMock.memoryRecord.update.mockResolvedValue({ id: 'id-1' });

    await repository.update('id-1', {
      value: 'Mới',
      sourceAgentSessionId: null,
    });

    expect(prismaMock.memoryRecord.update).toHaveBeenCalledWith({
      where: { id: 'id-1' },
      data: {
        value: 'Mới',
        sourceAgentSession: { disconnect: true },
      },
    });
  });

  it('update maps session id to connect', async () => {
    prismaMock.memoryRecord.update.mockResolvedValue({ id: 'id-1' });
    const sessionId = '123e4567-e89b-12d3-a456-426614174000';

    await repository.update('id-1', { sourceAgentSessionId: sessionId });

    expect(prismaMock.memoryRecord.update).toHaveBeenCalledWith({
      where: { id: 'id-1' },
      data: {
        sourceAgentSession: { connect: { id: sessionId } },
      },
    });
  });

  it('agentSessionExists returns true/false from prisma', async () => {
    prismaMock.agentSession.findUnique.mockResolvedValueOnce({ id: 's-1' });
    await expect(repository.agentSessionExists('s-1')).resolves.toBe(true);

    prismaMock.agentSession.findUnique.mockResolvedValueOnce(null);
    await expect(repository.agentSessionExists('missing')).resolves.toBe(false);
  });
});
