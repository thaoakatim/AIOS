import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmbeddingGatewayService } from '../../core/llm/embedding-gateway.service';
import { LocalStorageService } from '../../infrastructure/storage/local-storage.service';
import { DocumentProcessorService } from '../../infrastructure/storage/document-processor.service';
import { VectorStoreFactory } from '../../infrastructure/vector-store/vector-store.factory';
import { QueueService } from '../../infrastructure/redis/queue.service';
import { KnowledgeRepository } from './knowledge.repository';
import { KnowledgeService } from './knowledge.service';
import { RecursiveTextSplitter } from './services/recursive-text-splitter';

describe('KnowledgeService', () => {
  let service: KnowledgeService;

  const documentRow = {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Tài liệu kiến trúc',
    fileType: 'md',
    sourceUrl: '/api/files/abc.md',
    status: 'processing',
    createdAt: new Date('2026-09-24T00:00:00.000Z'),
    _count: { chunks: 0 },
  };

  const repositoryMock = {
    createDocument: jest.fn(),
    findDocumentById: jest.fn(),
    findDocumentsAndCount: jest.fn(),
    updateDocument: jest.fn(),
    deleteDocument: jest.fn(),
    countDocumentsByStatus: jest.fn(),
    replaceChunks: jest.fn(),
    findChunksByDocumentId: jest.fn(),
    findChunksByIds: jest.fn(),
    countChunks: jest.fn(),
    findDocumentsByIds: jest.fn(),
    linkDocumentsToMessage: jest.fn(),
    unlinkDocumentFromMessage: jest.fn(),
    listDocumentsForMessage: jest.fn(),
    listMessagesForDocument: jest.fn(),
    messageExists: jest.fn(),
    existingLinkedDocumentIds: jest.fn(),
  };

  const storageMock = {
    saveFile: jest.fn(),
    getFile: jest.fn(),
  };

  const documentProcessorMock = {
    extractText: jest.fn(),
  };

  const embeddingMock = {
    embedDocuments: jest.fn(),
    embedQuery: jest.fn(),
    getModel: jest.fn().mockReturnValue('nomic-embed-text'),
    getDimensions: jest.fn().mockReturnValue(768),
    getProvider: jest.fn().mockReturnValue('ollama'),
  };

  const vectorStoreMock = {
    upsert: jest.fn(),
    delete: jest.fn(),
    searchSimilarity: jest.fn(),
  };

  const vectorStoreFactoryMock = {
    createStore: jest.fn(() => vectorStoreMock),
  };

  const queueMock = {
    addJob: jest.fn(),
  };

  const configMock = {
    get: jest.fn().mockReturnValue(undefined),
  };

  const makeFile = (
    overrides: Partial<Express.Multer.File> = {},
  ): Express.Multer.File =>
    ({
      originalname: 'arch.md',
      mimetype: 'text/markdown',
      size: 11,
      buffer: Buffer.from('# AIOS\n\n'),
      ...overrides,
    }) as Express.Multer.File;

  /** Vector 768 chiều khớp `EMBEDDING_DIMENSIONS` (cột `vector(768)` của DB). */
  const DOC_ID = '66666666-6666-4666-8666-666666666666';
  const DOC_ID_2 = '77777777-7777-4777-8777-777777777777';

  const makeVector = (seed = 1): number[] =>
    Array.from({ length: 768 }, (_, i) => ((i + seed) % 7) / 10);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KnowledgeService,
        RecursiveTextSplitter,
        { provide: KnowledgeRepository, useValue: repositoryMock },
        { provide: LocalStorageService, useValue: storageMock },
        { provide: DocumentProcessorService, useValue: documentProcessorMock },
        {
          provide: EmbeddingGatewayService,
          useValue: embeddingMock,
        },
        { provide: VectorStoreFactory, useValue: vectorStoreFactoryMock },
        { provide: QueueService, useValue: queueMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    service = module.get<KnowledgeService>(KnowledgeService);
    jest.clearAllMocks();
    vectorStoreFactoryMock.createStore.mockReturnValue(vectorStoreMock);
  });

  // ------------------------------------------------------------- Upload --

  it('upload runs the full RAG pipeline and marks the document indexed', async () => {
    storageMock.saveFile.mockResolvedValue({
      id: 'abc',
      url: '/api/files/abc.md',
    });
    repositoryMock.createDocument.mockResolvedValue(documentRow);
    repositoryMock.replaceChunks.mockResolvedValue([
      { id: 'chunk-1', documentId: documentRow.id, content: '# AIOS' },
    ]);
    embeddingMock.embedDocuments.mockResolvedValue([makeVector()]);
    repositoryMock.updateDocument.mockResolvedValue({ ...documentRow });
    repositoryMock.findDocumentById.mockResolvedValue({
      ...documentRow,
      status: 'indexed',
      _count: { chunks: 1 },
    });
    documentProcessorMock.extractText.mockResolvedValue({
      text: '# AIOS',
      metadata: { title: 'AIOS' },
    });

    const result = await service.upload(makeFile(), { title: 'Kiến trúc' });

    expect(storageMock.saveFile).toHaveBeenCalledWith(
      Buffer.from('# AIOS\n\n'),
      'arch.md',
      'text/markdown',
    );
    expect(repositoryMock.createDocument).toHaveBeenCalledWith({
      title: 'Kiến trúc',
      fileType: 'md',
      sourceUrl: '/api/files/abc.md',
      status: 'processing',
    });
    expect(documentProcessorMock.extractText).toHaveBeenCalledWith(
      expect.any(Buffer),
      'text/markdown',
    );
    expect(embeddingMock.embedDocuments).toHaveBeenCalledWith(['# AIOS']);
    expect(vectorStoreMock.upsert).toHaveBeenCalledWith('aios_documents', [
      expect.objectContaining({
        id: 'chunk-1',
        vector: makeVector(),
        payload: expect.objectContaining({
          documentId: documentRow.id,
        }) as unknown,
      }),
    ]);
    expect(repositoryMock.updateDocument).toHaveBeenLastCalledWith(
      documentRow.id,
      { status: 'indexed' },
    );
    expect(result).toMatchObject({
      status: 'indexed',
      chunkCount: 1,
      queued: false,
    });
    expect(result.document.status).toBe('indexed');
  });

  it('upload persists chunkIndex and offsets inside the JSONB metadata', async () => {
    storageMock.saveFile.mockResolvedValue({ url: '/api/files/abc.md' });
    repositoryMock.createDocument.mockResolvedValue(documentRow);
    repositoryMock.findDocumentById.mockResolvedValue(documentRow);
    documentProcessorMock.extractText.mockResolvedValue({
      // Hai đoạn văn mỗi đoạn <= chunkSize -> tách đúng tại ranh giới đoạn văn.
      text: `${'A'.repeat(150)}\n\n${'B'.repeat(150)}`,
      metadata: {},
    });
    repositoryMock.replaceChunks.mockImplementation(
      (
        _id: string,
        chunks: Array<{ id: string; content: string }>,
      ): Promise<unknown> =>
        Promise.resolve(
          chunks.map((chunk) => ({ ...chunk, documentId: documentRow.id })),
        ),
    );
    embeddingMock.embedDocuments.mockResolvedValue([
      makeVector(),
      makeVector(2),
    ]);

    await service.upload(makeFile(), { chunkSize: 200, chunkOverlap: 0 });

    const chunksArg = (
      repositoryMock.replaceChunks.mock.calls as unknown as Array<
        [string, Array<{ metadata: Record<string, unknown> }>]
      >
    )[0][1];
    expect(chunksArg).toHaveLength(2);
    expect(chunksArg[0].metadata).toMatchObject({
      chunkIndex: 0,
      startOffset: 0,
      endOffset: 150,
      totalChunks: 2,
      sourceTitle: 'Tài liệu kiến trúc',
      fileType: 'md',
    });
    expect(chunksArg[1].metadata).toMatchObject({
      chunkIndex: 1,
      startOffset: 152,
      endOffset: 302,
    });
  });

  it('upload derives title from the filename when title is omitted', async () => {
    storageMock.saveFile.mockResolvedValue({ url: '/api/files/abc.md' });
    repositoryMock.createDocument.mockResolvedValue(documentRow);
    repositoryMock.findDocumentById.mockResolvedValue(documentRow);
    documentProcessorMock.extractText.mockResolvedValue({
      text: 'nội dung',
      metadata: {},
    });
    repositoryMock.replaceChunks.mockResolvedValue([
      { id: 'chunk-1', documentId: documentRow.id, content: 'nội dung' },
    ]);
    embeddingMock.embedDocuments.mockResolvedValue([makeVector()]);

    await service.upload(makeFile());

    expect(repositoryMock.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'arch.md' }),
    );
  });

  it('upload rejects a missing file', async () => {
    await expect(
      service.upload(undefined as unknown as Express.Multer.File),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upload rejects an empty file', async () => {
    await expect(
      service.upload(makeFile({ buffer: Buffer.alloc(0), size: 0 })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upload rejects unsupported mime types', async () => {
    await expect(
      service.upload(
        makeFile({
          originalname: 'virus.exe',
          mimetype: 'application/x-msdownload',
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repositoryMock.createDocument).not.toHaveBeenCalled();
  });

  it('upload rejects an out-of-range chunkSize', async () => {
    await expect(
      service.upload(makeFile(), { chunkSize: 10 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upload rejects an overlap that is not smaller than chunkSize', async () => {
    await expect(
      service.upload(makeFile(), { chunkSize: 200, chunkOverlap: 200 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upload marks the document failed when extraction yields no text', async () => {
    storageMock.saveFile.mockResolvedValue({ url: '/api/files/abc.md' });
    repositoryMock.createDocument.mockResolvedValue(documentRow);
    documentProcessorMock.extractText.mockResolvedValue({
      text: '   ',
      metadata: {},
    });

    await expect(service.upload(makeFile())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(repositoryMock.updateDocument).toHaveBeenLastCalledWith(
      documentRow.id,
      { status: 'failed' },
    );
    expect(embeddingMock.embedDocuments).not.toHaveBeenCalled();
  });

  it('upload marks the document failed when the embedding dimension mismatches', async () => {
    storageMock.saveFile.mockResolvedValue({ url: '/api/files/abc.md' });
    repositoryMock.createDocument.mockResolvedValue(documentRow);
    repositoryMock.findDocumentById.mockResolvedValue(documentRow);
    documentProcessorMock.extractText.mockResolvedValue({
      text: 'nội dung hợp lệ',
      metadata: {},
    });
    repositoryMock.replaceChunks.mockResolvedValue([
      { id: 'chunk-1', documentId: documentRow.id, content: 'nội dung hợp lệ' },
    ]);
    embeddingMock.embedDocuments.mockResolvedValue([[0.1, 0.2]]);

    await expect(service.upload(makeFile())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(vectorStoreMock.upsert).not.toHaveBeenCalled();
    expect(repositoryMock.updateDocument).toHaveBeenLastCalledWith(
      documentRow.id,
      { status: 'failed' },
    );
  });

  it('upload enqueues a BullMQ job in queue mode', async () => {
    storageMock.saveFile.mockResolvedValue({ url: '/api/files/abc.md' });
    repositoryMock.createDocument.mockResolvedValue(documentRow);
    queueMock.addJob.mockResolvedValue(undefined);

    const result = await service.upload(makeFile(), { mode: 'queue' });

    expect(queueMock.addJob).toHaveBeenCalledWith(
      'document-processing',
      'index-document',
      expect.objectContaining({
        payload: expect.objectContaining({
          documentId: documentRow.id,
        }) as unknown,
      }) as unknown,
    );
    expect(result).toMatchObject({ status: 'pending', queued: true });
    expect(embeddingMock.embedDocuments).not.toHaveBeenCalled();
  });

  it('upload falls back to synchronous processing when the queue is down', async () => {
    storageMock.saveFile.mockResolvedValue({ url: '/api/files/abc.md' });
    repositoryMock.createDocument.mockResolvedValue(documentRow);
    repositoryMock.findDocumentById.mockResolvedValue(documentRow);
    queueMock.addJob.mockRejectedValue(new Error('Redis unreachable'));
    documentProcessorMock.extractText.mockResolvedValue({
      text: 'nội dung',
      metadata: {},
    });
    repositoryMock.replaceChunks.mockResolvedValue([
      { id: 'chunk-1', documentId: documentRow.id, content: 'nội dung' },
    ]);
    embeddingMock.embedDocuments.mockResolvedValue([makeVector()]);

    const result = await service.upload(makeFile(), { mode: 'queue' });

    expect(result).toMatchObject({ status: 'indexed', queued: false });
  });

  it('upload rejects an unknown processing mode', async () => {
    await expect(
      service.upload(makeFile(), { mode: 'turbo' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upload links the new document to the given messages', async () => {
    const messageId = '22222222-2222-4222-8222-222222222222';
    storageMock.saveFile.mockResolvedValue({ url: '/api/files/abc.md' });
    repositoryMock.createDocument.mockResolvedValue(documentRow);
    repositoryMock.findDocumentById.mockResolvedValue(documentRow);
    repositoryMock.messageExists.mockResolvedValue(true);
    repositoryMock.findDocumentsByIds.mockResolvedValue([
      { id: documentRow.id },
    ]);
    documentProcessorMock.extractText.mockResolvedValue({
      text: 'nội dung',
      metadata: {},
    });
    repositoryMock.replaceChunks.mockResolvedValue([
      { id: 'chunk-1', documentId: documentRow.id, content: 'nội dung' },
    ]);
    embeddingMock.embedDocuments.mockResolvedValue([makeVector()]);

    await service.upload(makeFile(), { messageIds: [messageId] });

    expect(repositoryMock.linkDocumentsToMessage).toHaveBeenCalledWith({
      messageId,
      documentIds: [documentRow.id],
    });
  });

  // ------------------------------------------------------------- Search --

  it('search embeds the query and hydrates hits from postgres', async () => {
    embeddingMock.embedQuery.mockResolvedValue(makeVector());
    vectorStoreMock.searchSimilarity.mockResolvedValue([
      {
        id: 'chunk-1',
        score: 0.92,
        payload: { documentId: documentRow.id },
      },
      { id: 'chunk-2', score: 0.41, payload: { documentId: documentRow.id } },
    ]);
    repositoryMock.findChunksByIds.mockResolvedValue([
      {
        id: 'chunk-1',
        documentId: documentRow.id,
        content: 'Modular Monolith',
        metadata: { chunkIndex: 3 },
      },
      {
        id: 'chunk-2',
        documentId: documentRow.id,
        content: 'Nội dung khác',
        metadata: { chunkIndex: 4 },
      },
    ]);
    repositoryMock.findDocumentsByIds.mockResolvedValue([
      { id: documentRow.id, title: 'Tài liệu kiến trúc' },
    ]);

    const result = await service.search({ query: 'modular monolith' });

    expect(embeddingMock.embedQuery).toHaveBeenCalledWith('modular monolith');
    expect(vectorStoreMock.searchSimilarity).toHaveBeenCalledWith(
      'aios_documents',
      makeVector(),
      expect.any(Number),
      undefined,
    );
    expect(result.total).toBe(2);
    expect(result.data[0]).toEqual({
      chunkId: 'chunk-1',
      documentId: documentRow.id,
      documentTitle: 'Tài liệu kiến trúc',
      content: 'Modular Monolith',
      score: 0.92,
      chunkIndex: 3,
      metadata: { chunkIndex: 3 },
    });
    expect(result.embedding).toEqual({
      model: 'nomic-embed-text',
      dimensions: 768,
    });
  });

  it('search drops hits below minScore', async () => {
    embeddingMock.embedQuery.mockResolvedValue(makeVector());
    vectorStoreMock.searchSimilarity.mockResolvedValue([
      { id: 'chunk-1', score: 0.9, payload: { documentId: documentRow.id } },
      { id: 'chunk-2', score: 0.2, payload: { documentId: documentRow.id } },
    ]);
    repositoryMock.findChunksByIds.mockResolvedValue([
      {
        id: 'chunk-1',
        documentId: documentRow.id,
        content: 'hit mạnh',
        metadata: { chunkIndex: 0 },
      },
    ]);

    const result = await service.search({ query: 'q', minScore: 0.5 });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].chunkId).toBe('chunk-1');
  });

  it('search skips vector hits whose chunk no longer exists in postgres', async () => {
    embeddingMock.embedQuery.mockResolvedValue(makeVector());
    vectorStoreMock.searchSimilarity.mockResolvedValue([
      { id: 'ghost', score: 0.99, payload: { documentId: documentRow.id } },
    ]);
    repositoryMock.findChunksByIds.mockResolvedValue([]);

    const result = await service.search({ query: 'q' });

    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('search forwards a documentId filter to the vector store', async () => {
    embeddingMock.embedQuery.mockResolvedValue(makeVector());
    vectorStoreMock.searchSimilarity.mockResolvedValue([]);

    await service.search({
      query: 'q',
      documentId: '33333333-3333-4333-8333-333333333333',
    });

    expect(vectorStoreMock.searchSimilarity).toHaveBeenCalledWith(
      'aios_documents',
      makeVector(),
      expect.any(Number),
      { documentId: '33333333-3333-4333-8333-333333333333' },
    );
  });

  it('search rejects a blank query', async () => {
    await expect(service.search({ query: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('search rejects a minScore outside [0, 1]', async () => {
    await expect(
      service.search({ query: 'q', minScore: 5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // -------------------------------------------------- RAG context helpers --

  it('formatChunksForPrompt renders an empty string when there is no hit', () => {
    expect(service.formatChunksForPrompt([])).toBe('');
  });

  it('formatChunksForPrompt includes title, chunk index and score', () => {
    const section = service.formatChunksForPrompt([
      {
        chunkId: 'chunk-1',
        documentId: documentRow.id,
        documentTitle: 'Tài liệu kiến trúc',
        content: 'AIOS dùng Modular Monolith',
        score: 0.87654,
        chunkIndex: 2,
        metadata: {},
      },
    ]);

    expect(section).toContain('## Knowledge Base (RAG)');
    expect(section).toContain('Tài liệu kiến trúc #2');
    expect(section).toContain('score=0.877');
    expect(section).toContain('AIOS dùng Modular Monolith');
  });

  it('getRelevantChunks degrades gracefully when the vector store fails', async () => {
    embeddingMock.embedQuery.mockRejectedValue(new Error('Embedding down'));

    await expect(service.getRelevantChunks('câu hỏi')).resolves.toEqual([]);
  });

  it('getRelevantChunks restricts results to the attached documents', async () => {
    const docA = '44444444-4444-4444-8444-444444444444';
    const docB = '55555555-5555-4555-8555-555555555555';
    embeddingMock.embedQuery.mockResolvedValue(makeVector());
    vectorStoreMock.searchSimilarity.mockResolvedValue([
      { id: 'chunk-a', score: 0.9, payload: { documentId: docA } },
      { id: 'chunk-b', score: 0.8, payload: { documentId: docB } },
    ]);
    repositoryMock.findChunksByIds.mockResolvedValue([
      { id: 'chunk-a', documentId: docA, content: 'A', metadata: {} },
      { id: 'chunk-b', documentId: docB, content: 'B', metadata: {} },
    ]);
    repositoryMock.findDocumentsByIds.mockResolvedValue([
      { id: docA, title: 'Doc A' },
      { id: docB, title: 'Doc B' },
    ]);

    const hits = await service.getRelevantChunks('q', {
      documentIds: [docA],
    });

    expect(hits.map((hit) => hit.chunkId)).toEqual(['chunk-a']);
  });

  it('injectIntoContext returns a new context with prefetch.ragChunks', async () => {
    embeddingMock.embedQuery.mockResolvedValue(makeVector());
    vectorStoreMock.searchSimilarity.mockResolvedValue([
      { id: 'chunk-1', score: 0.9, payload: { documentId: documentRow.id } },
    ]);
    repositoryMock.findChunksByIds.mockResolvedValue([
      {
        id: 'chunk-1',
        documentId: documentRow.id,
        content: 'RAG chunk',
        metadata: { chunkIndex: 0 },
      },
    ]);
    repositoryMock.findDocumentsByIds.mockResolvedValue([
      { id: documentRow.id, title: 'Tài liệu kiến trúc' },
    ]);

    const ctx = {
      executionId: 'exec-1',
      sessionId: 'session-1',
      query: 'hỏi về RAG',
      context: {
        userProfile: {},
        systemRules: [],
        activePlans: {},
      },
      availableTools: [],
      metadata: {},
    };
    const original = JSON.parse(JSON.stringify(ctx)) as unknown;

    const result = await service.injectIntoContext(ctx);

    expect(result.chunks).toHaveLength(1);
    expect(result.promptSection).toContain('RAG chunk');
    expect(result.context.prefetch?.ragChunks?.[0]).toMatchObject({
      id: 'chunk-1',
      content: 'RAG chunk',
      metadata: { chunkIndex: 0, documentTitle: 'Tài liệu kiến trúc' },
    });
    // Context gốc phải bất biến (readonly theo AgentExecutionContext).
    expect(JSON.parse(JSON.stringify(ctx))).toEqual(original);
  });

  // ---------------------------------------------------- Message <-> Doc --

  it('attachDocumentsToMessage skips documents that are already linked', async () => {
    const messageId = '22222222-2222-4222-8222-222222222222';
    repositoryMock.messageExists.mockResolvedValue(true);
    repositoryMock.findDocumentsByIds.mockResolvedValue([
      { id: DOC_ID },
      { id: DOC_ID_2 },
    ]);
    repositoryMock.existingLinkedDocumentIds.mockResolvedValue([DOC_ID]);

    const result = await service.attachDocumentsToMessage(messageId, {
      documentIds: [DOC_ID, DOC_ID_2],
    });

    expect(repositoryMock.linkDocumentsToMessage).toHaveBeenCalledWith({
      messageId,
      documentIds: [DOC_ID_2],
    });
    expect(result).toEqual({
      messageId,
      linked: [DOC_ID_2],
      skipped: [DOC_ID],
    });
  });

  it('attachDocumentsToMessage rejects a non-uuid message id', async () => {
    await expect(
      service.attachDocumentsToMessage('not-a-uuid', {
        documentIds: [DOC_ID],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('attachDocumentsToMessage rejects an empty documentIds array', async () => {
    await expect(
      service.attachDocumentsToMessage('22222222-2222-4222-8222-222222222222', {
        documentIds: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('attachDocumentsToMessage 404s when a document does not exist', async () => {
    repositoryMock.messageExists.mockResolvedValue(true);
    repositoryMock.findDocumentsByIds.mockResolvedValue([{ id: DOC_ID }]);

    await expect(
      service.attachDocumentsToMessage('22222222-2222-4222-8222-222222222222', {
        documentIds: [DOC_ID, DOC_ID_2],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('detachDocumentFromMessage 404s when the link is missing', async () => {
    repositoryMock.unlinkDocumentFromMessage.mockResolvedValue({ count: 0 });

    await expect(
      service.detachDocumentFromMessage(
        '22222222-2222-4222-8222-222222222222',
        '44444444-4444-4444-8444-444444444444',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findMessageIdsByDocument delegates to the repository', async () => {
    repositoryMock.listMessagesForDocument.mockResolvedValue(['msg-1']);

    await expect(
      service.findMessageIdsByDocument('44444444-4444-4444-8444-444444444444'),
    ).resolves.toEqual(['msg-1']);
  });

  // ----------------------------------------------------------------- CRUD --

  it('findAll normalizes status and pagination', async () => {
    repositoryMock.findDocumentsAndCount.mockResolvedValue({
      records: [documentRow],
      total: 1,
    });

    const result = await service.findAll({ status: 'INDEXED', limit: 10 });

    expect(repositoryMock.findDocumentsAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'indexed', take: 10, skip: 0 }),
    );
    expect(result.data[0].title).toBe('Tài liệu kiến trúc');
    expect(result.total).toBe(1);
  });

  it('findAll rejects an unknown status', async () => {
    await expect(
      service.findAll({ status: 'archived' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('findOne 404s for a missing document', async () => {
    repositoryMock.findDocumentById.mockResolvedValue(null);

    await expect(
      service.findOne('11111111-1111-4111-8111-111111111111'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findChunks sorts by the metadata chunkIndex', async () => {
    repositoryMock.findDocumentById.mockResolvedValue(documentRow);
    repositoryMock.findChunksByDocumentId.mockResolvedValue([
      {
        id: 'chunk-2',
        documentId: documentRow.id,
        content: 'hai',
        metadata: { chunkIndex: 1 },
      },
      {
        id: 'chunk-1',
        documentId: documentRow.id,
        content: 'một',
        metadata: { chunkIndex: 0 },
      },
    ]);

    const chunks = await service.findChunks(documentRow.id);

    expect(chunks.map((chunk) => chunk.id)).toEqual(['chunk-1', 'chunk-2']);
    expect(chunks[0].chunkIndex).toBe(0);
  });

  it('remove deletes the vectors before the database rows', async () => {
    repositoryMock.findDocumentById.mockResolvedValue(documentRow);
    repositoryMock.findChunksByDocumentId.mockResolvedValue([
      { id: 'chunk-1', documentId: documentRow.id },
    ]);
    vectorStoreMock.delete.mockResolvedValue(undefined);
    repositoryMock.deleteDocument.mockResolvedValue(documentRow);

    await service.remove(documentRow.id);

    expect(vectorStoreMock.delete).toHaveBeenCalledWith('aios_documents', [
      'chunk-1',
    ]);
    expect(repositoryMock.deleteDocument).toHaveBeenCalledWith(documentRow.id);
  });

  it('remove still deletes the row when the vector store fails', async () => {
    repositoryMock.findDocumentById.mockResolvedValue(documentRow);
    repositoryMock.findChunksByDocumentId.mockResolvedValue([
      { id: 'chunk-1', documentId: documentRow.id },
    ]);
    vectorStoreMock.delete.mockRejectedValue(new Error('Qdrant down'));
    repositoryMock.deleteDocument.mockResolvedValue(documentRow);

    await expect(service.remove(documentRow.id)).resolves.toBeDefined();
    expect(repositoryMock.deleteDocument).toHaveBeenCalledWith(documentRow.id);
  });

  it('stats reports the embedding configuration', async () => {
    repositoryMock.countDocumentsByStatus.mockResolvedValue({ indexed: 2 });

    await expect(service.stats()).resolves.toEqual({
      documentsByStatus: { indexed: 2 },
      embedding: {
        provider: 'ollama',
        model: 'nomic-embed-text',
        dimensions: 768,
      },
      collection: 'aios_documents',
    });
  });
});
