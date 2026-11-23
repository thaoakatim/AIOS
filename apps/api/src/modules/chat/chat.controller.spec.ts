import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter } from 'events';
import { Request, Response } from 'express';
import { AuthenticatedUser } from '../auth/entities/authenticated-user.interface';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

describe('ChatController', () => {
  let controller: ChatController;
  let chatService: {
    sendMessage: jest.Mock;
    prepareChatTurn: jest.Mock;
    executeStreamTurn: jest.Mock;
    listConversations: jest.Mock;
    getConversation: jest.Mock;
    listMessages: jest.Mock;
    updateConversation: jest.Mock;
    deleteConversation: jest.Mock;
    getAgentRun: jest.Mock;
  };

  const mockUser: AuthenticatedUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'test@aios.local',
    displayName: 'Test User',
    keycloakSubject: 'keycloak-sub-1',
    emailVerified: true,
    authMode: 'dev_bypass',
  };

  beforeEach(async () => {
    chatService = {
      sendMessage: jest.fn(),
      prepareChatTurn: jest.fn(),
      executeStreamTurn: jest.fn(),
      listConversations: jest.fn(),
      getConversation: jest.fn(),
      listMessages: jest.fn(),
      updateConversation: jest.fn(),
      deleteConversation: jest.fn(),
      getAgentRun: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        {
          provide: ChatService,
          useValue: chatService,
        },
      ],
    }).compile();

    controller = module.get<ChatController>(ChatController);
  });

  describe('sendMessage', () => {
    it('delegates to chatService.sendMessage with dto and authenticated user', async () => {
      const dto = { content: 'Hello' };
      chatService.sendMessage.mockResolvedValue({ conversationId: 'conv-1' });

      const res = await controller.sendMessage(dto, mockUser);
      expect(res).toEqual({ conversationId: 'conv-1' });
      expect(chatService.sendMessage).toHaveBeenCalledWith(dto, mockUser);
    });
  });

  describe('streamMessage', () => {
    it('prepares turn, sets SSE headers, flushes, writes events, and ends response', async () => {
      const dto = { content: 'Stream test' };
      const mockTurn = { turnResult: {}, initialCtx: {} };
      chatService.prepareChatTurn.mockResolvedValue(mockTurn);

      async function* mockEvents() {
        yield { type: 'meta', conversationId: 'conv-1', userMessageId: 'msg-1', runId: 'run-1' };
        yield { type: 'token', content: 'Hi' };
        yield { type: 'done', conversationId: 'conv-1', messageId: 'msg-2', runId: 'run-1', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
      }
      chatService.executeStreamTurn.mockReturnValue(mockEvents());

      const reqEmitter = new EventEmitter() as unknown as Request;
      const headers: Record<string, string> = {};
      const written: string[] = [];
      let ended = false;

      const res = {
        setHeader: jest.fn((k: string, v: string) => {
          headers[k] = v;
        }),
        flushHeaders: jest.fn(),
        write: jest.fn((data: string) => {
          written.push(data);
          return true;
        }),
        end: jest.fn(() => {
          ended = true;
        }),
        get writableEnded() {
          return ended;
        },
      } as unknown as Response;

      await controller.streamMessage(dto, mockUser, reqEmitter, res);

      expect(chatService.prepareChatTurn).toHaveBeenCalledWith(dto, mockUser);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/event-stream; charset=utf-8',
      );
      expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
      expect(res.flushHeaders).toHaveBeenCalled();

      expect(written.length).toBe(3);
      expect(written[0]).toContain('"type":"meta"');
      expect(written[1]).toContain('"type":"token"');
      expect(written[2]).toContain('"type":"done"');
      expect(res.end).toHaveBeenCalled();
    });
  });

  describe('Conversation and Run Endpoints', () => {
    it('delegates listConversations to chatService', async () => {
      chatService.listConversations.mockResolvedValue({ items: [], total: 0 });
      await controller.listConversations(mockUser, { limit: 10, offset: 0 });
      expect(chatService.listConversations).toHaveBeenCalledWith(mockUser, {
        limit: 10,
        offset: 0,
      });
    });

    it('delegates getConversation to chatService', async () => {
      chatService.getConversation.mockResolvedValue({ id: 'c1' });
      await controller.getConversation('c1', mockUser);
      expect(chatService.getConversation).toHaveBeenCalledWith('c1', mockUser);
    });

    it('delegates listMessages to chatService', async () => {
      chatService.listMessages.mockResolvedValue({ items: [], total: 0 });
      await controller.listMessages('c1', mockUser, { limit: 10, offset: 0 });
      expect(chatService.listMessages).toHaveBeenCalledWith('c1', mockUser, {
        limit: 10,
        offset: 0,
      });
    });

    it('delegates updateConversation to chatService', async () => {
      chatService.updateConversation.mockResolvedValue({ id: 'c1', title: 'New' });
      await controller.updateConversation('c1', mockUser, { title: 'New' });
      expect(chatService.updateConversation).toHaveBeenCalledWith('c1', mockUser, {
        title: 'New',
      });
    });

    it('delegates deleteConversation to chatService', async () => {
      chatService.deleteConversation.mockResolvedValue({ success: true });
      await controller.deleteConversation('c1', mockUser);
      expect(chatService.deleteConversation).toHaveBeenCalledWith('c1', mockUser);
    });

    it('delegates getAgentRun to chatService', async () => {
      chatService.getAgentRun.mockResolvedValue({ id: 'run-1' });
      await controller.getAgentRun('msg-1', mockUser);
      expect(chatService.getAgentRun).toHaveBeenCalledWith('msg-1', mockUser);
    });
  });
});
