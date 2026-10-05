import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { KnowledgeRepository } from './knowledge.repository';

describe('KnowledgeRepository', () => {
  let repository: KnowledgeRepository;

  const prismaMock = {
    document: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      groupBy: jest.fn(),
    },
    documentChunk: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      deleteMany: jest.fn(),
    },
    messageDocument: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    message: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KnowledgeRepository,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    repository = module.get<KnowledgeRepository>(KnowledgeRepository);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  it('createDocument maps domain fields to prisma', async () => {
    prismaMock.document.create.mockResolvedValue({ id: 'doc-1' });

    await expect(
      repository.createDocument({
        title: 'Sơ đồ kiến trúc',
        fileType: 'pdf',
        sourceUrl: '/api/files/abc.pdf',
        status: 'processing',
      }),
    ).resolves.toEqual({ id: 'doc-1' });

    expect(prismaMock.document.create).toHaveBeenCalledWith({
      data: {
        title: 'Sơ đồ kiến trúc',
        fileType: 'pdf',
        sourceUrl: '/api/files/abc.pdf',
        status: 'processing',
      },
    });
  });

  it('findDocumentsAndCount builds filters and paginates', async () => {
    prismaMock.document.findMany.mockResolvedValue([]);
    prismaMock.document.count.mockResolvedValue(0);

    await repository.findDocumentsAndCount({
      status: 'indexed',
      fileType: 'md',
      search: 'arch',
      take: 10,
      skip: 5,
    });

    expect(prismaMock.document.findMany).toHaveBeenCalledWith({
      where: {
        status: 'indexed',
        fileType: 'md',
        title: { contains: 'arch', mode: 'insensitive' },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      skip: 5,
      include: { _count: { select: { chunks: true } } },
    });
    expect(prismaMock.document.count).toHaveBeenCalledWith({
      where: {
        status: 'indexed',
        fileType: 'md',
        title: { contains: 'arch', mode: 'insensitive' },
      },
    });
  });

  it('updateDocument only maps provided fields', async () => {
    prismaMock.document.update.mockResolvedValue({ id: 'doc-1' });

    await repository.updateDocument('doc-1', { status: 'indexed' });

    expect(prismaMock.document.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { status: 'indexed' },
    });
  });

  it('countDocumentsByStatus flattens the groupBy result', async () => {
    prismaMock.document.groupBy.mockResolvedValue([
      { status: 'indexed', _count: { _all: 3 } },
      { status: 'failed', _count: { _all: 1 } },
    ]);

    await expect(repository.countDocumentsByStatus()).resolves.toEqual({
      indexed: 3,
      failed: 1,
    });
  });

  it('replaceChunks deletes old chunks then creates the new batch', async () => {
    prismaMock.documentChunk.deleteMany.mockResolvedValue({ count: 2 });
    prismaMock.documentChunk.createMany.mockResolvedValue({ count: 2 });
    prismaMock.documentChunk.findMany.mockResolvedValue([
      { id: 'chunk-1' },
      { id: 'chunk-2' },
    ]);

    const result = await repository.replaceChunks('doc-1', [
      {
        id: 'chunk-1',
        documentId: 'doc-1',
        content: 'a',
        metadata: { chunkIndex: 0 },
      },
      {
        id: 'chunk-2',
        documentId: 'doc-1',
        content: 'b',
        metadata: { chunkIndex: 1 },
      },
    ]);

    expect(prismaMock.documentChunk.deleteMany).toHaveBeenCalledWith({
      where: { documentId: 'doc-1' },
    });
    expect(prismaMock.documentChunk.createMany).toHaveBeenCalledWith({
      data: [
        {
          id: 'chunk-1',
          documentId: 'doc-1',
          content: 'a',
          metadata: { chunkIndex: 0 },
        },
        {
          id: 'chunk-2',
          documentId: 'doc-1',
          content: 'b',
          metadata: { chunkIndex: 1 },
        },
      ],
    });
    expect(result).toEqual([{ id: 'chunk-1' }, { id: 'chunk-2' }]);
  });

  it('replaceChunks skips createMany when there is nothing to write', async () => {
    await expect(repository.replaceChunks('doc-1', [])).resolves.toEqual([]);
    expect(prismaMock.documentChunk.deleteMany).toHaveBeenCalled();
    expect(prismaMock.documentChunk.createMany).not.toHaveBeenCalled();
  });

  it('linkDocumentsToMessage uses skipDuplicates for idempotency', async () => {
    prismaMock.messageDocument.createMany.mockResolvedValue({ count: 2 });

    await repository.linkDocumentsToMessage({
      messageId: 'msg-1',
      documentIds: ['doc-1', 'doc-2'],
    });

    expect(prismaMock.messageDocument.createMany).toHaveBeenCalledWith({
      data: [
        { messageId: 'msg-1', documentId: 'doc-1' },
        { messageId: 'msg-1', documentId: 'doc-2' },
      ],
      skipDuplicates: true,
    });
  });

  it('linkDocumentsToMessage short-circuits on an empty id list', async () => {
    await expect(
      repository.linkDocumentsToMessage({
        messageId: 'msg-1',
        documentIds: [],
      }),
    ).resolves.toEqual({ count: 0 });
    expect(prismaMock.messageDocument.createMany).not.toHaveBeenCalled();
  });

  it('existingLinkedDocumentIds projects only the documentId column', async () => {
    prismaMock.messageDocument.findMany.mockResolvedValue([
      { documentId: 'doc-1' },
    ]);

    await expect(
      repository.existingLinkedDocumentIds('msg-1', ['doc-1', 'doc-2']),
    ).resolves.toEqual(['doc-1']);

    expect(prismaMock.messageDocument.findMany).toHaveBeenCalledWith({
      where: { messageId: 'msg-1', documentId: { in: ['doc-1', 'doc-2'] } },
      select: { documentId: true },
    });
  });

  it('listDocumentsForMessage filters through the M:N relation', async () => {
    prismaMock.document.findMany.mockResolvedValue([]);

    await repository.listDocumentsForMessage('msg-1');

    expect(prismaMock.document.findMany).toHaveBeenCalledWith({
      where: { messageDocuments: { some: { messageId: 'msg-1' } } },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { chunks: true } } },
    });
  });

  it('messageExists reflects the presence of the row', async () => {
    prismaMock.message.findUnique.mockResolvedValueOnce({ id: 'msg-1' });
    await expect(repository.messageExists('msg-1')).resolves.toBe(true);

    prismaMock.message.findUnique.mockResolvedValueOnce(null);
    await expect(repository.messageExists('missing')).resolves.toBe(false);
  });
});
