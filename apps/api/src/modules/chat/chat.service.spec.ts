import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { MessageRole } from '@aios/shared-types';
import { AuthenticatedUser } from '../auth/entities/authenticated-user.interface';
import { LLMGatewayService } from '../../core/llm/llm-gateway.service';
import { TokenCounterService } from '../../core/llm/services/token-counter.service';
import { KnowledgeRepository } from '../knowledge/knowledge.repository';
import { ChatRepository } from './chat.repository';
import { CHAT_HOOK_REGISTRY } from './chat.tokens';
import { ChatService } from './chat.service';
import { ChatPromptBuilderService } from './services/chat-prompt-builder.service';
import { ChatConversation } from './entities/chat-conversation.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatAgentRun } from './entities/agent-run.entity';

describe('ChatService', () => {
  let service: ChatService;
  let chatRepository: {
    findConversationById: jest.Mock;
    listConversations: jest.Mock;
    updateConversation: jest.Mock;
    softDeleteConversation: jest.Mock;
    initializeChatTurn: jest.Mock;
    createAssistantMessage: jest.Mock;
    listMessages: jest.Mock;
    listRecentMessages: jest.Mock;
    updateAgentRun: jest.Mock;
    findAgentRunByMessageId: jest.Mock;
  };
  let promptBuilder: {
    buildMessages: jest.Mock;
  };
  let llmGateway: {
    generate: jest.Mock;
    stream: jest.Mock;
  };
  let tokenCounter: {
    countTokens: jest.Mock;
    countMessagesTokens: jest.Mock;
  };
  let knowledgeRepository: {
    findDocumentById: jest.Mock;
  };
  let hookRegistry: {
    runBeforePromptBuild: jest.Mock;
    executeAfterCompletion: jest.Mock;
  };

  const mockUser: AuthenticatedUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'test@aios.local',
    displayName: 'Test User',
    keycloakSubject: 'keycloak-sub-1',
    emailVerified: true,
    authMode: 'dev_bypass',
  };

  const mockDate = new Date('2026-11-23T12:00:00Z');
  const mockConvId = '22222222-2222-4222-8222-222222222222';
  const mockForeignDocId = '99999999-9999-4999-8999-999999999999';
  const mockNotFoundConvId = '88888888-8888-4888-8888-888888888888';

  const mockConversation: ChatConversation = {
    id: mockConvId,
    userId: mockUser.id,
    title: 'Test Conversation',
    version: 1,
    contentHash: null,
    deletedAt: null,
    createdAt: mockDate,
    updatedAt: mockDate,
  };

  const mockUserMessage: ChatMessage = {
    id: '33333333-3333-4333-8333-333333333333',
    conversationId: mockConvId,
    agentSessionId: null,
    role: MessageRole.USER,
    content: 'Hello AIOS',
    version: 1,
    contentHash: null,
    deletedAt: null,
    createdAt: mockDate,
  };

  const mockAgentRun: ChatAgentRun = {
    id: '44444444-4444-4444-8444-444444444444',
    messageId: '33333333-3333-4333-8333-333333333333',
    status: 'running',
    totalTokens: 0,
    traceLogs: null,
    createdAt: mockDate,
  };

  beforeEach(async () => {
    chatRepository = {
      findConversationById: jest.fn(),
      listConversations: jest.fn(),
      updateConversation: jest.fn(),
      softDeleteConversation: jest.fn(),
      initializeChatTurn: jest.fn(),
      createAssistantMessage: jest.fn(),
      listMessages: jest.fn(),
      listRecentMessages: jest.fn(),
      updateAgentRun: jest.fn(),
      findAgentRunByMessageId: jest.fn(),
    };
    promptBuilder = {
      buildMessages: jest.fn(),
    };
    llmGateway = {
      generate: jest.fn(),
      stream: jest.fn(),
    };
    tokenCounter = {
      countTokens: jest.fn().mockReturnValue(20),
      countMessagesTokens: jest.fn().mockReturnValue(50),
    };
    knowledgeRepository = {
      findDocumentById: jest.fn(),
    };
    hookRegistry = {
      runBeforePromptBuild: jest.fn((ctx) => Promise.resolve(ctx)),
      executeAfterCompletion: jest.fn(() => Promise.resolve()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: ChatRepository, useValue: chatRepository },
        { provide: ChatPromptBuilderService, useValue: promptBuilder },
        { provide: LLMGatewayService, useValue: llmGateway },
        { provide: TokenCounterService, useValue: tokenCounter },
        { provide: KnowledgeRepository, useValue: knowledgeRepository },
        { provide: CHAT_HOOK_REGISTRY, useValue: hookRegistry },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((k: string) => (k === 'LLM_MODEL' ? 'gpt-4o-mini' : null)),
          },
        },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
  });

  describe('prepareChatTurn', () => {
    it('throws NotFoundException when documentId does not belong to user (Anti-IDOR)', async () => {
      knowledgeRepository.findDocumentById.mockResolvedValue(null);

      await expect(
        service.prepareChatTurn(
          { content: 'Check this doc', documentIds: [mockForeignDocId] },
          mockUser,
        ),
      ).rejects.toThrow(NotFoundException);

      expect(knowledgeRepository.findDocumentById).toHaveBeenCalledWith(
        mockForeignDocId,
        mockUser.id,
      );
    });

    it('throws NotFoundException when conversation does not exist or user lacks permission', async () => {
      chatRepository.initializeChatTurn.mockResolvedValue(null);

      await expect(
        service.prepareChatTurn(
          { conversationId: mockNotFoundConvId, content: 'Hi' },
          mockUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('successfully initializes turn and excludes current message from history', async () => {
      chatRepository.initializeChatTurn.mockResolvedValue({
        conversation: mockConversation,
        userMessage: mockUserMessage,
        agentRun: mockAgentRun,
      });
      chatRepository.listRecentMessages.mockResolvedValue([]);

      const result = await service.prepareChatTurn(
        { content: 'Hello AIOS' },
        mockUser,
      );

      expect(result.turnResult.conversation.id).toBe(mockConvId);
      expect(result.turnResult.userMessage.id).toBe('33333333-3333-4333-8333-333333333333');
      expect(chatRepository.listRecentMessages).toHaveBeenCalledWith(
        mockConvId,
        mockUser.id,
        {
          limit: 20,
          excludeMessageId: '33333333-3333-4333-8333-333333333333',
        },
      );
    });
  });

  describe('sendMessage (Unary)', () => {
    it('executes full unary chat turn successfully', async () => {
      chatRepository.initializeChatTurn.mockResolvedValue({
        conversation: mockConversation,
        userMessage: mockUserMessage,
        agentRun: mockAgentRun,
      });
      chatRepository.listRecentMessages.mockResolvedValue([]);
      promptBuilder.buildMessages.mockReturnValue([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'Hello AIOS' },
      ]);
      llmGateway.generate.mockResolvedValue({
        message: { role: 'assistant', content: 'AIOS is ready.' },
        usage: { promptTokens: 30, completionTokens: 10, totalTokens: 40 },
        finishReason: 'stop',
      });
      chatRepository.createAssistantMessage.mockResolvedValue({
        id: 'msg-assistant-1',
        conversationId: mockConvId,
        role: MessageRole.ASSISTANT,
        content: 'AIOS is ready.',
        createdAt: mockDate,
      });

      const response = await service.sendMessage(
        { content: 'Hello AIOS' },
        mockUser,
      );

      expect(response.conversationId).toBe(mockConvId);
      expect(response.userMessageId).toBe('33333333-3333-4333-8333-333333333333');
      expect(response.assistantMessage.content).toBe('AIOS is ready.');
      expect(hookRegistry.runBeforePromptBuild).toHaveBeenCalled();
      expect(hookRegistry.executeAfterCompletion).toHaveBeenCalled();
    });

    it('marks AgentRun as failed when LLM call throws error', async () => {
      chatRepository.initializeChatTurn.mockResolvedValue({
        conversation: mockConversation,
        userMessage: mockUserMessage,
        agentRun: mockAgentRun,
      });
      chatRepository.listRecentMessages.mockResolvedValue([]);
      promptBuilder.buildMessages.mockReturnValue([]);
      llmGateway.generate.mockRejectedValue(new Error('LLM Gateway 503'));

      await expect(
        service.sendMessage({ content: 'Hello' }, mockUser),
      ).rejects.toThrow('LLM Gateway 503');

      expect(chatRepository.updateAgentRun).toHaveBeenCalledWith(
        '44444444-4444-4444-8444-444444444444',
        expect.objectContaining({
          status: 'failed',
          traceLogs: expect.objectContaining({
            error: 'LLM Gateway 503',
          }),
        }),
      );
    });
  });

  describe('executeStreamTurn (SSE)', () => {
    it('yields meta, tokens, and done events and calculates fallback usage', async () => {
      const preparedTurn = {
        turnResult: {
          conversation: mockConversation,
          userMessage: mockUserMessage,
          agentRun: mockAgentRun,
        },
        initialCtx: {
          executionId: 'exec-1',
          userId: mockUser.id,
          sessionId: mockConvId,
          query: 'Stream test',
          context: { userProfile: {}, systemRules: [] },
          availableTools: [],
          metadata: { runId: '44444444-4444-4444-8444-444444444444', startTimeMs: Date.now() },
        } as any,
      };

      promptBuilder.buildMessages.mockReturnValue([
        { role: 'user', content: 'Stream test' },
      ]);

      async function* mockStreamGenerator() {
        yield { delta: { content: 'Chunk 1 ' } };
        yield { delta: { content: 'Chunk 2' } };
      }
      llmGateway.stream.mockReturnValue(mockStreamGenerator());

      chatRepository.createAssistantMessage.mockResolvedValue({
        id: 'msg-assistant-1',
        conversationId: mockConvId,
        content: 'Chunk 1 Chunk 2',
      });

      const events: any[] = [];
      for await (const event of service.executeStreamTurn(preparedTurn)) {
        events.push(event);
      }

      // 1. Meta event
      expect(events[0]).toEqual({
        type: 'meta',
        conversationId: mockConvId,
        userMessageId: '33333333-3333-4333-8333-333333333333',
        runId: '44444444-4444-4444-8444-444444444444',
      });

      // 2. Token events
      expect(events[1]).toEqual({ type: 'token', content: 'Chunk 1 ' });
      expect(events[2]).toEqual({ type: 'token', content: 'Chunk 2' });

      // 3. Done event
      expect(events[3].type).toBe('done');
      expect(events[3].conversationId).toBe(mockConvId);
      expect(events[3].usage.totalTokens).toBe(70); // 50 prompt + 20 completion from fallback mock

      expect(hookRegistry.executeAfterCompletion).toHaveBeenCalled();
    });

    it('marks AgentRun as cancelled when abort signal is triggered', async () => {
      const abortController = new AbortController();

      const preparedTurn = {
        turnResult: {
          conversation: mockConversation,
          userMessage: mockUserMessage,
          agentRun: mockAgentRun,
        },
        initialCtx: {
          executionId: 'exec-1',
          userId: mockUser.id,
          sessionId: mockConvId,
          query: 'Stream test',
          context: { userProfile: {}, systemRules: [] },
          availableTools: [],
          metadata: { runId: '44444444-4444-4444-8444-444444444444', startTimeMs: Date.now() },
        } as any,
      };

      async function* mockStreamGenerator() {
        yield { delta: { content: 'Starting...' } };
        abortController.abort(); // Simulates client disconnecting
        yield { delta: { content: 'After abort' } };
      }
      llmGateway.stream.mockReturnValue(mockStreamGenerator());

      const events: any[] = [];
      for await (const event of service.executeStreamTurn(
        preparedTurn,
        abortController.signal,
      )) {
        events.push(event);
      }

      expect(chatRepository.updateAgentRun).toHaveBeenCalledWith(
        '44444444-4444-4444-8444-444444444444',
        expect.objectContaining({
          status: 'cancelled',
        }),
      );
    });
  });

  describe('Conversation CRUD & Observability', () => {
    it('lists conversations for user', async () => {
      chatRepository.listConversations.mockResolvedValue({
        items: [mockConversation],
        total: 1,
      });

      const res = await service.listConversations(mockUser, { limit: 10, offset: 0 });
      expect(res.items).toHaveLength(1);
      expect(res.total).toBe(1);
      expect(chatRepository.listConversations).toHaveBeenCalledWith(mockUser.id, {
        limit: 10,
        offset: 0,
      });
    });

    it('throws NotFoundException when conversation does not exist', async () => {
      chatRepository.findConversationById.mockResolvedValue(null);

      await expect(
        service.getConversation(mockNotFoundConvId, mockUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates conversation title', async () => {
      chatRepository.updateConversation.mockResolvedValue({
        ...mockConversation,
        title: 'Updated Title',
      });

      const res = await service.updateConversation(mockConvId, mockUser, {
        title: 'Updated Title',
      });
      expect(res.title).toBe('Updated Title');
    });

    it('deletes conversation', async () => {
      chatRepository.softDeleteConversation.mockResolvedValue(true);

      const res = await service.deleteConversation(mockConvId, mockUser);
      expect(res.success).toBe(true);
    });

    it('gets agent run by messageId', async () => {
      chatRepository.findAgentRunByMessageId.mockResolvedValue(mockAgentRun);

      const res = await service.getAgentRun('33333333-3333-4333-8333-333333333333', mockUser);
      expect(res.id).toBe('44444444-4444-4444-8444-444444444444');
      expect(chatRepository.findAgentRunByMessageId).toHaveBeenCalledWith(
        '33333333-3333-4333-8333-333333333333',
        mockUser.id,
      );
    });
  });
});
