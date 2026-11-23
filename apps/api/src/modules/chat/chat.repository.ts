import { Injectable, Logger } from '@nestjs/common';
import {
  AgentRun,
  Conversation,
  Message,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  ChatMessage,
  PrismaMessageWithRelations,
} from './entities/chat-message.entity';
import { ChatConversation } from './entities/chat-conversation.entity';
import { ChatAgentRun } from './entities/agent-run.entity';

export interface InitializeTurnParams {
  userId: string;
  conversationId?: string;
  defaultTitle: string;
  content: string;
  documentIds?: string[];
}

export interface InitializedTurnResult {
  conversation: ChatConversation;
  userMessage: ChatMessage;
  agentRun: ChatAgentRun;
}

@Injectable()
export class ChatRepository {
  private readonly logger = new Logger(ChatRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------- CONVERSATION CRUD --

  async findConversationById(
    id: string,
    userId: string,
  ): Promise<ChatConversation | null> {
    const record = await this.prisma.conversation.findFirst({
      where: {
        id,
        userId,
        deletedAt: null,
      },
    });
    return record ? ChatConversation.fromPrisma(record) : null;
  }

  async listConversations(
    userId: string,
    options: { limit: number; offset: number },
  ): Promise<{ items: ChatConversation[]; total: number }> {
    const where: Prisma.ConversationWhereInput = {
      userId,
      deletedAt: null,
    };

    const [records, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: options.limit,
        skip: options.offset,
      }),
      this.prisma.conversation.count({ where }),
    ]);

    return {
      items: records.map(ChatConversation.fromPrisma),
      total,
    };
  }

  async updateConversation(
    id: string,
    userId: string,
    data: { title: string },
  ): Promise<ChatConversation | null> {
    const existing = await this.findConversationById(id, userId);
    if (!existing) {
      return null;
    }

    const updated = await this.prisma.conversation.update({
      where: { id },
      data: {
        title: data.title,
        version: { increment: 1 },
      },
    });

    return ChatConversation.fromPrisma(updated);
  }

  async softDeleteConversation(
    id: string,
    userId: string,
  ): Promise<boolean> {
    const existing = await this.findConversationById(id, userId);
    if (!existing) {
      return false;
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.conversation.update({
        where: { id },
        data: {
          deletedAt: now,
          version: { increment: 1 },
        },
      }),
      this.prisma.message.updateMany({
        where: {
          conversationId: id,
          deletedAt: null,
        },
        data: {
          deletedAt: now,
          version: { increment: 1 },
        },
      }),
    ]);

    return true;
  }

  // ------------------------------------ TRANSACTIONAL TURN INITIALIZATION --

  async initializeChatTurn(
    params: InitializeTurnParams,
  ): Promise<InitializedTurnResult | null> {
    return this.prisma.$transaction(async (tx) => {
      let conversationRecord: Conversation | null = null;

      if (params.conversationId) {
        conversationRecord = await tx.conversation.findFirst({
          where: {
            id: params.conversationId,
            userId: params.userId,
            deletedAt: null,
          },
        });

        if (!conversationRecord) {
          return null;
        }
      } else {
        conversationRecord = await tx.conversation.create({
          data: {
            userId: params.userId,
            title: params.defaultTitle,
            version: 1,
          },
        });
      }

      // 2. Tạo tin nhắn người dùng (User Message)
      const userMessageRecord = await tx.message.create({
        data: {
          conversationId: conversationRecord.id,
          role: 'user',
          content: params.content,
          version: 1,
        },
      });

      // Cập nhật updatedAt của Conversation
      await tx.conversation.update({
        where: { id: conversationRecord.id },
        data: { updatedAt: new Date() },
      });

      // 3. Tạo AgentRun (status = running)
      const agentRunRecord = await tx.agentRun.create({
        data: {
          messageId: userMessageRecord.id,
          status: 'running',
          totalTokens: 0,
          traceLogs: {
            startTime: Date.now(),
          },
        },
      });

      // 4. Nếu có documentIds, liên kết vào message_documents
      if (params.documentIds && params.documentIds.length > 0) {
        await tx.messageDocument.createMany({
          data: params.documentIds.map((docId) => ({
            messageId: userMessageRecord.id,
            documentId: docId,
          })),
          skipDuplicates: true,
        });
      }

      return {
        conversation: ChatConversation.fromPrisma(conversationRecord),
        userMessage: ChatMessage.fromPrisma(userMessageRecord),
        agentRun: ChatAgentRun.fromPrisma(agentRunRecord),
      };
    });
  }

  // -------------------------------------------------------- MESSAGE CRUD --

  async createAssistantMessage(params: {
    conversationId: string;
    userId: string;
    content: string;
    agentSessionId?: string;
  }): Promise<ChatMessage | null> {
    const conversation = await this.findConversationById(
      params.conversationId,
      params.userId,
    );
    if (!conversation) {
      return null;
    }

    return this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          conversationId: params.conversationId,
          role: 'assistant',
          content: params.content,
          agentSessionId: params.agentSessionId,
          version: 1,
        },
      });

      await tx.conversation.update({
        where: { id: params.conversationId },
        data: { updatedAt: new Date() },
      });

      return ChatMessage.fromPrisma(message);
    });
  }

  async listMessages(
    conversationId: string,
    userId: string,
    options: { limit: number; offset: number },
  ): Promise<{ items: ChatMessage[]; total: number } | null> {
    const conversation = await this.findConversationById(
      conversationId,
      userId,
    );
    if (!conversation) {
      return null;
    }

    const where: Prisma.MessageWhereInput = {
      conversationId,
      deletedAt: null,
    };

    const [records, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        include: {
          messageDocuments: true,
          agentRun: true,
        },
        orderBy: { createdAt: 'asc' },
        take: options.limit,
        skip: options.offset,
      }),
      this.prisma.message.count({ where }),
    ]);

    return {
      items: records.map((r) =>
        ChatMessage.fromPrisma(r as PrismaMessageWithRelations),
      ),
      total,
    };
  }

  /**
   * Lấy danh sách tin nhắn gần nhất để nạp vào prompt lịch sử.
   * Đảm bảo loại trừ tin nhắn người dùng hiện tại (excludeMessageId)
   * và trả về theo thứ tự thời gian tăng dần (cũ nhất -> mới nhất).
   */
  async listRecentMessages(
    conversationId: string,
    userId: string,
    options: { limit: number; excludeMessageId?: string },
  ): Promise<ChatMessage[]> {
    const conversation = await this.findConversationById(
      conversationId,
      userId,
    );
    if (!conversation) {
      return [];
    }

    const where: Prisma.MessageWhereInput = {
      conversationId,
      deletedAt: null,
      ...(options.excludeMessageId
        ? { id: { not: options.excludeMessageId } }
        : {}),
    };

    const records = await this.prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options.limit,
    });

    // Đảo ngược để có thứ tự thời gian tăng dần
    return records.reverse().map(ChatMessage.fromPrisma);
  }

  // ----------------------------------------------------------- AGENT RUN --

  async updateAgentRun(
    runId: string,
    data: {
      status: 'running' | 'completed' | 'failed' | 'cancelled';
      totalTokens?: number;
      traceLogs?: any;
    },
  ): Promise<ChatAgentRun | null> {
    try {
      const updated = await this.prisma.agentRun.update({
        where: { id: runId },
        data: {
          status: data.status,
          totalTokens: data.totalTokens !== undefined ? data.totalTokens : undefined,
          traceLogs: data.traceLogs !== undefined ? (data.traceLogs as Prisma.InputJsonValue) : undefined,
        },
      });
      return ChatAgentRun.fromPrisma(updated);
    } catch (error) {
      this.logger.warn(`Không thể cập nhật AgentRun ${runId}: ${(error as Error).message}`);
      return null;
    }
  }

  async findAgentRunByMessageId(
    messageId: string,
    userId: string,
  ): Promise<ChatAgentRun | null> {
    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        deletedAt: null,
        conversation: {
          userId,
          deletedAt: null,
        },
      },
      include: {
        agentRun: true,
      },
    });

    return message?.agentRun ? ChatAgentRun.fromPrisma(message.agentRun) : null;
  }
}
