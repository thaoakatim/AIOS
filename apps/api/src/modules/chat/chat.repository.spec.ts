import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ChatRepository } from './chat.repository';

describe('ChatRepository', () => {
  let repository: ChatRepository;
  let prisma: {
    conversation: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    message: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    agentRun: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    messageDocument: {
      createMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const mockDate = new Date('2026-11-23T12:00:00Z');
  const mockUserId = '11111111-1111-4111-8111-111111111111';
  const mockConvId = '22222222-2222-4222-8222-222222222222';
  const mockMessageId = '33333333-3333-4333-8333-333333333333';
  const mockRunId = '44444444-4444-4444-8444-444444444444';

  beforeEach(async () => {
    prisma = {
      conversation: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      message: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      agentRun: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      messageDocument: {
        createMany: jest.fn(),
      },
      $transaction: jest.fn((callbackOrArr) => {
        if (typeof callbackOrArr === 'function') {
          return callbackOrArr(prisma);
        }
        return Promise.all(callbackOrArr);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatRepository,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    repository = module.get<ChatRepository>(ChatRepository);
  });

  describe('findConversationById', () => {
    it('returns conversation when found and belongs to user with deletedAt: null', async () => {
      prisma.conversation.findFirst.mockResolvedValue({
        id: mockConvId,
        userId: mockUserId,
        title: 'Test Conv',
        version: 1,
        contentHash: null,
        deletedAt: null,
        createdAt: mockDate,
        updatedAt: mockDate,
      });

      const result = await repository.findConversationById(mockConvId, mockUserId);
      expect(result).toBeDefined();
      expect(result?.id).toBe(mockConvId);
      expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
        where: { id: mockConvId, userId: mockUserId, deletedAt: null },
      });
    });

    it('returns null when conversation not found', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);
      const result = await repository.findConversationById(mockConvId, mockUserId);
      expect(result).toBeNull();
    });
  });

  describe('listConversations', () => {
    it('lists conversations for user with pagination and count', async () => {
      prisma.conversation.findMany.mockResolvedValue([
        {
          id: mockConvId,
          userId: mockUserId,
          title: 'Conv 1',
          version: 1,
          contentHash: null,
          deletedAt: null,
          createdAt: mockDate,
          updatedAt: mockDate,
        },
      ]);
      prisma.conversation.count.mockResolvedValue(1);

      const result = await repository.listConversations(mockUserId, {
        limit: 10,
        offset: 0,
      });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(prisma.conversation.findMany).toHaveBeenCalledWith({
        where: { userId: mockUserId, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        skip: 0,
      });
    });
  });

  describe('updateConversation', () => {
    it('updates title and increments version when user owns conversation', async () => {
      prisma.conversation.findFirst.mockResolvedValue({
        id: mockConvId,
        userId: mockUserId,
        title: 'Old Title',
        version: 1,
        contentHash: null,
        deletedAt: null,
        createdAt: mockDate,
        updatedAt: mockDate,
      });
      prisma.conversation.update.mockResolvedValue({
        id: mockConvId,
        userId: mockUserId,
        title: 'New Title',
        version: 2,
        contentHash: null,
        deletedAt: null,
        createdAt: mockDate,
        updatedAt: mockDate,
      });

      const result = await repository.updateConversation(mockConvId, mockUserId, {
        title: 'New Title',
      });

      expect(result).toBeDefined();
      expect(result?.title).toBe('New Title');
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: mockConvId },
        data: { title: 'New Title', version: { increment: 1 } },
      });
    });

    it('returns null if conversation does not exist', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);
      const result = await repository.updateConversation(mockConvId, mockUserId, {
        title: 'New Title',
      });
      expect(result).toBeNull();
    });
  });

  describe('softDeleteConversation', () => {
    it('soft deletes conversation and its messages in a transaction', async () => {
      prisma.conversation.findFirst.mockResolvedValue({
        id: mockConvId,
        userId: mockUserId,
      });

      const result = await repository.softDeleteConversation(mockConvId, mockUserId);
      expect(result).toBe(true);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('returns false if conversation not found', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);
      const result = await repository.softDeleteConversation(mockConvId, mockUserId);
      expect(result).toBe(false);
    });
  });

  describe('initializeChatTurn', () => {
    it('creates new conversation, user message, agentRun, and links documents', async () => {
      const mockDocId = '55555555-5555-4555-8555-555555555555';
      prisma.conversation.create.mockResolvedValue({
        id: mockConvId,
        userId: mockUserId,
        title: 'Hello AI',
        version: 1,
        contentHash: null,
        deletedAt: null,
        createdAt: mockDate,
        updatedAt: mockDate,
      });
      prisma.message.create.mockResolvedValue({
        id: mockMessageId,
        conversationId: mockConvId,
        agentSessionId: null,
        role: 'user',
        content: 'Hello AI',
        version: 1,
        contentHash: null,
        deletedAt: null,
        createdAt: mockDate,
      });
      prisma.conversation.update.mockResolvedValue({});
      prisma.agentRun.create.mockResolvedValue({
        id: mockRunId,
        messageId: mockMessageId,
        status: 'running',
        totalTokens: 0,
        traceLogs: { startTime: 123 },
        createdAt: mockDate,
      });
      prisma.messageDocument.createMany.mockResolvedValue({ count: 1 });

      const result = await repository.initializeChatTurn({
        userId: mockUserId,
        defaultTitle: 'Hello AI',
        content: 'Hello AI',
        documentIds: [mockDocId],
      });

      expect(result).toBeDefined();
      expect(result?.conversation.id).toBe(mockConvId);
      expect(result?.userMessage.id).toBe(mockMessageId);
      expect(result?.agentRun.id).toBe(mockRunId);
      expect(prisma.messageDocument.createMany).toHaveBeenCalledWith({
        data: [{ messageId: mockMessageId, documentId: mockDocId }],
        skipDuplicates: true,
      });
    });

    it('returns null if existing conversationId is not found or not owned', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);

      const result = await repository.initializeChatTurn({
        userId: mockUserId,
        conversationId: mockConvId,
        defaultTitle: 'Hello',
        content: 'Hello',
      });

      expect(result).toBeNull();
    });
  });

  describe('listRecentMessages', () => {
    it('lists recent messages excluding current user message and returns in chronological order', async () => {
      prisma.conversation.findFirst.mockResolvedValue({ id: mockConvId, userId: mockUserId });

      const msg1 = {
        id: 'msg-1',
        conversationId: mockConvId,
        role: 'user',
        content: 'Turn 1 user',
        version: 1,
        createdAt: new Date('2026-11-23T10:00:00Z'),
      };
      const msg2 = {
        id: 'msg-2',
        conversationId: mockConvId,
        role: 'assistant',
        content: 'Turn 1 assistant',
        version: 1,
        createdAt: new Date('2026-11-23T10:01:00Z'),
      };

      // Prisma findMany returns orderBy createdAt desc [msg2, msg1]
      prisma.message.findMany.mockResolvedValue([msg2, msg1]);

      const result = await repository.listRecentMessages(mockConvId, mockUserId, {
        limit: 10,
        excludeMessageId: 'current-msg-id',
      });

      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: {
          conversationId: mockConvId,
          deletedAt: null,
          id: { not: 'current-msg-id' },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      // Repository reverses order so msg1 is first, msg2 is second
      expect(result[0].id).toBe('msg-1');
      expect(result[1].id).toBe('msg-2');
    });
  });

  describe('updateAgentRun', () => {
    it('updates status and traceLogs by runId', async () => {
      prisma.agentRun.update.mockResolvedValue({
        id: mockRunId,
        messageId: mockMessageId,
        status: 'completed',
        totalTokens: 150,
        traceLogs: { latencyMs: 500 },
        createdAt: mockDate,
      });

      const result = await repository.updateAgentRun(mockRunId, {
        status: 'completed',
        totalTokens: 150,
        traceLogs: { latencyMs: 500 },
      });

      expect(result?.status).toBe('completed');
      expect(prisma.agentRun.update).toHaveBeenCalledWith({
        where: { id: mockRunId },
        data: {
          status: 'completed',
          totalTokens: 150,
          traceLogs: { latencyMs: 500 },
        },
      });
    });

    it('returns null gracefully on error without throwing', async () => {
      prisma.agentRun.update.mockRejectedValue(new Error('DB connection error'));

      const result = await repository.updateAgentRun(mockRunId, {
        status: 'failed',
      });

      expect(result).toBeNull();
    });
  });

  describe('findAgentRunByMessageId', () => {
    it('finds agentRun through message ownership check', async () => {
      prisma.message.findFirst.mockResolvedValue({
        id: mockMessageId,
        agentRun: {
          id: mockRunId,
          messageId: mockMessageId,
          status: 'completed',
          totalTokens: 100,
          traceLogs: null,
          createdAt: mockDate,
        },
      });

      const result = await repository.findAgentRunByMessageId(mockMessageId, mockUserId);
      expect(result).toBeDefined();
      expect(result?.id).toBe(mockRunId);
      expect(prisma.message.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockMessageId,
          deletedAt: null,
          conversation: {
            userId: mockUserId,
            deletedAt: null,
          },
        },
        include: { agentRun: true },
      });
    });

    it('returns null if message not found or belongs to another user', async () => {
      prisma.message.findFirst.mockResolvedValue(null);
      const result = await repository.findAgentRunByMessageId(mockMessageId, mockUserId);
      expect(result).toBeNull();
    });
  });
});
