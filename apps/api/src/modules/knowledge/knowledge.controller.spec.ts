import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

describe('KnowledgeController', () => {
  let controller: KnowledgeController;

  const serviceMock = {
    upload: jest.fn(),
    search: jest.fn(),
    getRelevantChunks: jest.fn(),
    formatChunksForPrompt: jest.fn().mockReturnValue('## Knowledge Base (RAG)'),
    attachDocumentsToMessage: jest.fn(),
    detachDocumentFromMessage: jest.fn(),
    findDocumentsByMessage: jest.fn(),
    findMessageIdsByDocument: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    findChunks: jest.fn(),
    ingest: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    stats: jest.fn(),
  };

  const makeFile = (): Express.Multer.File =>
    ({
      originalname: 'arch.md',
      mimetype: 'text/markdown',
      buffer: Buffer.from('nội dung'),
    }) as Express.Multer.File;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [KnowledgeController],
      providers: [{ provide: KnowledgeService, useValue: serviceMock }],
    }).compile();

    controller = module.get<KnowledgeController>(KnowledgeController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('upload forwards the file and the parsed messageIds', () => {
    serviceMock.upload.mockReturnValue({ queued: true });
    const messageId = '22222222-2222-4222-8222-222222222222';

    void controller.upload(makeFile(), {
      title: 'Kiến trúc',
      messageIds: `["${messageId}"]` as unknown as string[],
    });

    expect(serviceMock.upload).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        title: 'Kiến trúc',
        messageIds: [messageId],
      }),
    );
  });

  it('upload accepts a comma separated messageIds list', () => {
    const a = '22222222-2222-4222-8222-222222222222';
    const b = '33333333-3333-4333-8333-333333333333';

    void controller.upload(makeFile(), {
      messageIds: `${a}, ${b}` as unknown as string[],
    });

    expect(serviceMock.upload).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ messageIds: [a, b] }),
    );
  });

  it('upload rejects a malformed JSON messageIds payload', () => {
    expect(
      () =>
        void controller.upload(makeFile(), {
          messageIds: '["broken"' as unknown as string[],
        }),
    ).toThrow(BadRequestException);
  });

  it('search maps query params into the DTO', () => {
    serviceMock.search.mockReturnValue({ data: [] });

    void controller.search('modular monolith', undefined, '5', '0.3', 'doc-1');

    expect(serviceMock.search).toHaveBeenCalledWith({
      query: 'modular monolith',
      limit: 5,
      minScore: 0.3,
      documentId: 'doc-1',
    });
  });

  it('search supports the short "q" alias', () => {
    serviceMock.search.mockReturnValue({ data: [] });

    void controller.search(
      undefined,
      'vi sao',
      undefined,
      undefined,
      undefined,
    );

    expect(serviceMock.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'vi sao' }),
    );
  });

  it('getContext returns hits together with a ready-to-prompt section', async () => {
    const hits = [{ chunkId: 'chunk-1' }];
    serviceMock.getRelevantChunks.mockResolvedValue(hits);

    const result = await controller.getContext('câu hỏi', '3', '0.5', 'doc-1');

    expect(serviceMock.getRelevantChunks).toHaveBeenCalledWith('câu hỏi', {
      query: 'câu hỏi',
      limit: 3,
      minScore: 0.5,
      documentIds: ['doc-1'],
    });
    expect(result).toEqual({
      chunks: hits,
      promptSection: '## Knowledge Base (RAG)',
    });
  });

  it('findAll maps list query params', () => {
    serviceMock.findAll.mockReturnValue({ data: [], total: 0 });

    void controller.findAll('indexed', 'md', 'arch', '10', '20');

    expect(serviceMock.findAll).toHaveBeenCalledWith({
      status: 'indexed',
      fileType: 'md',
      search: 'arch',
      limit: 10,
      offset: 20,
    });
  });

  it('exposes CRUD and Message links through the service', () => {
    void controller.findOne('doc-1');
    void controller.findChunks('doc-1');
    void controller.findMessages('doc-1');
    void controller.update('doc-1', { title: 'Mới' });
    void controller.remove('doc-1');
    void controller.reindex('doc-1', { mode: 'sync' });
    void controller.stats();
    void controller.attachToMessage('msg-1', { documentIds: ['doc-1'] });
    void controller.detachFromMessage('msg-1', 'doc-1');
    void controller.findByMessage('msg-1');

    expect(serviceMock.findOne).toHaveBeenCalledWith('doc-1');
    expect(serviceMock.findChunks).toHaveBeenCalledWith('doc-1');
    expect(serviceMock.findMessageIdsByDocument).toHaveBeenCalledWith('doc-1');
    expect(serviceMock.update).toHaveBeenCalledWith('doc-1', {
      title: 'Mới',
    });
    expect(serviceMock.remove).toHaveBeenCalledWith('doc-1');
    expect(serviceMock.ingest).toHaveBeenCalledWith('doc-1', { mode: 'sync' });
    expect(serviceMock.stats).toHaveBeenCalled();
    expect(serviceMock.attachDocumentsToMessage).toHaveBeenCalledWith('msg-1', {
      documentIds: ['doc-1'],
    });
    expect(serviceMock.detachDocumentFromMessage).toHaveBeenCalledWith(
      'msg-1',
      'doc-1',
    );
    expect(serviceMock.findDocumentsByMessage).toHaveBeenCalledWith('msg-1');
  });
});
