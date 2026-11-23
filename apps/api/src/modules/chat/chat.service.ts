import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChatResponseDto,
  ChatStreamEvent,
  ChatTokenUsage,
  PaginatedResponse,
} from '@aios/shared-types';
import { AuthenticatedUser } from '../auth/entities/authenticated-user.interface';
import { AgentExecutionContext } from '../../core/context/agent-context.interface';
import { ContextBuilder } from '../../core/context/context-builder';
import type { IHookRegistry } from '../../core/hooks/hook-registry';
import { LLMGatewayService } from '../../core/llm/llm-gateway.service';
import { TokenCounterService } from '../../core/llm/services/token-counter.service';
import { KnowledgeRepository } from '../knowledge/knowledge.repository';
import { ChatRepository, InitializedTurnResult } from './chat.repository';
import { CHAT_HOOK_REGISTRY } from './chat.tokens';
import { SendChatMessageDto } from './dto/send-chat-message.dto';
import { QueryConversationDto } from './dto/query-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { ChatConversation } from './entities/chat-conversation.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatAgentRun } from './entities/agent-run.entity';
import { ChatPromptBuilderService } from './services/chat-prompt-builder.service';

const HISTORY_LIMIT = 20;

export interface PreparedChatTurn {
  turnResult: InitializedTurnResult;
  initialCtx: AgentExecutionContext;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly promptBuilder: ChatPromptBuilderService,
    private readonly llmGateway: LLMGatewayService,
    private readonly tokenCounter: TokenCounterService,
    private readonly config: ConfigService,
    private readonly knowledgeRepository: KnowledgeRepository,
    @Inject(CHAT_HOOK_REGISTRY) private readonly hookRegistry: IHookRegistry,
  ) {}

  // ------------------------------------------------ PREPARE CHAT TURN --

  /**
   * Bước 1 dùng chung: Xác thực ownership documentIds, khởi tạo Turn trong
   * DB transaction, nạp recent messages (loại trừ message hiện tại) và tạo
   * AgentExecutionContext ban đầu.
   *
   * Được gọi TRƯỚC KHI mở SSE stream để mọi lỗi (400, 404) trả về REST HTTP chuẩn.
   */
  async prepareChatTurn(
    dto: SendChatMessageDto,
    user: AuthenticatedUser,
  ): Promise<PreparedChatTurn> {
    this.validateSendChatDto(dto);

    // 1. Xác thực quyền sở hữu toàn bộ documentIds (Chống IDOR)
    if (dto.documentIds && dto.documentIds.length > 0) {
      const checkDocs = await Promise.all(
        dto.documentIds.map((docId) =>
          this.knowledgeRepository.findDocumentById(docId, user.id),
        ),
      );

      const hasInvalidDoc = checkDocs.some((d) => !d);
      if (hasInvalidDoc) {
        throw new NotFoundException(
          'Một hoặc nhiều tài liệu đính kèm không tồn tại hoặc không thuộc quyền sở hữu của bạn.',
        );
      }
    }

    // 2. Sinh tiêu đề mặc định an toàn cho conversation mới
    const defaultTitle = dto.content.trim().replace(/\s+/g, ' ').slice(0, 80);

    // 3. Khởi tạo Turn trong DB Transaction
    const turnResult = await this.chatRepository.initializeChatTurn({
      userId: user.id,
      conversationId: dto.conversationId,
      defaultTitle: defaultTitle || 'Cuộc hội thoại mới',
      content: dto.content,
      documentIds: dto.documentIds,
    });

    if (!turnResult) {
      throw new NotFoundException(
        'Cuộc hội thoại không tồn tại hoặc bạn không có quyền truy cập.',
      );
    }

    // 4. Lấy lịch sử tin nhắn gần nhất (loại trừ tin nhắn user vừa tạo để không lặp prompt)
    const recentMessages = await this.chatRepository.listRecentMessages(
      turnResult.conversation.id,
      user.id,
      {
        limit: HISTORY_LIMIT,
        excludeMessageId: turnResult.userMessage.id,
      },
    );

    // 5. Khởi tạo AgentExecutionContext
    const initialCtx = new ContextBuilder()
      .setExecutionId(randomUUID())
      .setUserId(user.id)
      .setSessionId(turnResult.conversation.id)
      .setQuery(dto.content)
      .setRecentMessages(recentMessages as any)
      .setMetadata({
        runId: turnResult.agentRun.id,
        userMessageId: turnResult.userMessage.id,
        documentIds: dto.documentIds,
        startTimeMs: Date.now(),
      })
      .build();

    return { turnResult, initialCtx };
  }

  // ---------------------------------------------------- POST /chat (UNARY) --

  async sendMessage(
    dto: SendChatMessageDto,
    user: AuthenticatedUser,
  ): Promise<ChatResponseDto> {
    const { turnResult, initialCtx } = await this.prepareChatTurn(dto, user);

    try {
      // Làm giàu context qua Immutable Hook Pipeline
      const enrichedCtx = await this.hookRegistry.runBeforePromptBuild(
        initialCtx,
      );

      // Xây dựng messages và token budget
      const messages = this.promptBuilder.buildMessages(enrichedCtx);

      // Gọi LLM
      const result = await this.llmGateway.generate(messages);

      // Lưu tin nhắn trợ lý (Assistant Message)
      const assistantMessage =
        await this.chatRepository.createAssistantMessage({
          conversationId: turnResult.conversation.id,
          userId: user.id,
          content: result.message.content,
        });

      // Hook hoàn tất: Ghi Observability & Token Usage vào AgentRun
      await this.hookRegistry.executeAfterCompletion(
        {
          content: result.message.content,
          usage: result.usage,
        },
        enrichedCtx,
      );

      return {
        conversationId: turnResult.conversation.id,
        userMessageId: turnResult.userMessage.id,
        assistantMessage: assistantMessage!,
        runId: turnResult.agentRun.id,
        usage: result.usage,
      };
    } catch (error) {
      const latencyMs = Math.max(
        0,
        Date.now() - (initialCtx.metadata.startTimeMs as number),
      );
      await this.chatRepository.updateAgentRun(turnResult.agentRun.id, {
        status: 'failed',
        traceLogs: {
          error: (error as Error).message,
          latencyMs,
        },
      });
      throw error;
    }
  }

  // --------------------------------------------- POST /chat/stream (SSE) --

  async *executeStreamTurn(
    turn: PreparedChatTurn,
    signal?: AbortSignal,
  ): AsyncIterable<ChatStreamEvent> {
    const { turnResult, initialCtx } = turn;

    // 1. Gửi event meta ngay khi mở kết nối
    yield {
      type: 'meta',
      conversationId: turnResult.conversation.id,
      userMessageId: turnResult.userMessage.id,
      runId: turnResult.agentRun.id,
    };

    try {
      // 2. Làm giàu context qua Immutable Hook Pipeline
      const enrichedCtx = await this.hookRegistry.runBeforePromptBuild(
        initialCtx,
      );

      if (signal?.aborted) {
        await this.chatRepository.updateAgentRun(turnResult.agentRun.id, {
          status: 'cancelled',
          traceLogs: { reason: 'Client disconnected before LLM call' },
        });
        return;
      }

      // 3. Xây dựng messages
      const messages = this.promptBuilder.buildMessages(enrichedCtx);

      // 4. Stream LLM tokens
      let fullText = '';
      let streamUsage: ChatTokenUsage | undefined = undefined;

      for await (const chunk of this.llmGateway.stream(messages, { signal })) {
        if (signal?.aborted) {
          break;
        }

        if (chunk.delta?.content) {
          fullText += chunk.delta.content;
          yield {
            type: 'token',
            content: chunk.delta.content,
          };
        }

        if (chunk.usage) {
          streamUsage = chunk.usage;
        }
      }

      // Xử lý khi client ngắt kết nối giữa chừng
      if (signal?.aborted) {
        const latencyMs = Math.max(
          0,
          Date.now() - (initialCtx.metadata.startTimeMs as number),
        );
        await this.chatRepository.updateAgentRun(turnResult.agentRun.id, {
          status: 'cancelled',
          traceLogs: {
            reason: 'Client disconnected during stream',
            partialLength: fullText.length,
            latencyMs,
          },
        });
        return;
      }

      // 5. Tính toán Token Usage (Fallback qua TokenCounter nếu stream provider không trả)
      const model = this.config.get('LLM_MODEL') || 'gpt-4o-mini';
      const promptTokens =
        streamUsage?.promptTokens ??
        this.tokenCounter.countMessagesTokens(messages, model);
      const completionTokens =
        streamUsage?.completionTokens ??
        this.tokenCounter.countTokens(fullText, model);
      const totalTokens =
        streamUsage?.totalTokens ?? promptTokens + completionTokens;

      const finalUsage: ChatTokenUsage = {
        promptTokens,
        completionTokens,
        totalTokens,
      };

      // 6. Lưu Assistant Message
      const assistantMessage =
        await this.chatRepository.createAssistantMessage({
          conversationId: turnResult.conversation.id,
          userId: initialCtx.userId,
          content: fullText,
        });

      // 7. Ghi Observability
      await this.hookRegistry.executeAfterCompletion(
        {
          content: fullText,
          usage: finalUsage,
        },
        enrichedCtx,
      );

      // 8. Yield event done
      yield {
        type: 'done',
        conversationId: turnResult.conversation.id,
        messageId: assistantMessage?.id ?? '',
        runId: turnResult.agentRun.id,
        usage: finalUsage,
      };
    } catch (error) {
      if (signal?.aborted) {
        await this.chatRepository.updateAgentRun(turnResult.agentRun.id, {
          status: 'cancelled',
        });
        return;
      }

      const latencyMs = Math.max(
        0,
        Date.now() - (initialCtx.metadata.startTimeMs as number),
      );
      await this.chatRepository.updateAgentRun(turnResult.agentRun.id, {
        status: 'failed',
        traceLogs: {
          error: (error as Error).message,
          latencyMs,
        },
      });

      yield {
        type: 'error',
        code: 'STREAM_FAILED',
        error: (error as Error).message,
      };
    }
  }

  // ---------------------------------------- CONVERSATION & MESSAGE CRUD --

  async listConversations(
    user: AuthenticatedUser,
    query: QueryConversationDto,
  ): Promise<PaginatedResponse<ChatConversation>> {
    const result = await this.chatRepository.listConversations(user.id, {
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    });

    return {
      items: result.items,
      total: result.total,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    };
  }

  async getConversation(
    id: string,
    user: AuthenticatedUser,
  ): Promise<ChatConversation> {
    const conversation = await this.chatRepository.findConversationById(
      id,
      user.id,
    );
    if (!conversation) {
      throw new NotFoundException(
        'Cuộc hội thoại không tồn tại hoặc bạn không có quyền truy cập.',
      );
    }
    return conversation;
  }

  async listMessages(
    conversationId: string,
    user: AuthenticatedUser,
    query: QueryConversationDto,
  ): Promise<PaginatedResponse<ChatMessage>> {
    const result = await this.chatRepository.listMessages(
      conversationId,
      user.id,
      {
        limit: query.limit ?? 50,
        offset: query.offset ?? 0,
      },
    );

    if (!result) {
      throw new NotFoundException(
        'Cuộc hội thoại không tồn tại hoặc bạn không có quyền truy cập.',
      );
    }

    return {
      items: result.items,
      total: result.total,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    };
  }

  async updateConversation(
    id: string,
    user: AuthenticatedUser,
    dto: UpdateConversationDto,
  ): Promise<ChatConversation> {
    this.assertUuid(id, 'id');
    if (!dto || typeof dto.title !== 'string' || !dto.title.trim()) {
      throw new BadRequestException('Tiêu đề "title" không được để trống.');
    }
    const trimmedTitle = dto.title.trim();
    if (trimmedTitle.length > 200) {
      throw new BadRequestException('Tiêu đề không được vượt quá 200 ký tự.');
    }

    const updated = await this.chatRepository.updateConversation(
      id,
      user.id,
      { title: trimmedTitle },
    );

    if (!updated) {
      throw new NotFoundException(
        'Cuộc hội thoại không tồn tại hoặc bạn không có quyền truy cập.',
      );
    }
    return updated;
  }

  async deleteConversation(
    id: string,
    user: AuthenticatedUser,
  ): Promise<{ success: boolean; message: string }> {
    const deleted = await this.chatRepository.softDeleteConversation(
      id,
      user.id,
    );
    if (!deleted) {
      throw new NotFoundException(
        'Cuộc hội thoại không tồn tại hoặc bạn không có quyền truy cập.',
      );
    }
    return { success: true, message: 'Đã xóa cuộc hội thoại thành công.' };
  }

  async getAgentRun(
    messageId: string,
    user: AuthenticatedUser,
  ): Promise<ChatAgentRun> {
    const agentRun = await this.chatRepository.findAgentRunByMessageId(
      messageId,
      user.id,
    );
    if (!agentRun) {
      throw new NotFoundException(
        'Không tìm thấy bản ghi AgentRun tương ứng với tin nhắn này.',
      );
    }
    return agentRun;
  }

  private assertUuid(value: string, fieldName: string): void {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(value)) {
      throw new BadRequestException(
        `Trường "${fieldName}" không phải là UUID hợp lệ (${value}).`,
      );
    }
  }

  private validateSendChatDto(dto: SendChatMessageDto): void {
    if (!dto || typeof dto.content !== 'string' || !dto.content.trim()) {
      throw new BadRequestException(
        'Nội dung tin nhắn "content" là bắt buộc và không được để trống.',
      );
    }
    if (dto.content.length > 32000) {
      throw new BadRequestException(
        'Nội dung tin nhắn không được vượt quá 32,000 ký tự.',
      );
    }
    if (dto.conversationId !== undefined && dto.conversationId !== null) {
      this.assertUuid(dto.conversationId, 'conversationId');
    }
    if (dto.documentIds !== undefined && dto.documentIds !== null) {
      if (!Array.isArray(dto.documentIds)) {
        throw new BadRequestException('Trường "documentIds" phải là một mảng.');
      }
      if (dto.documentIds.length > 20) {
        throw new BadRequestException(
          'Không được đính kèm quá 20 tài liệu trong một lượt chat.',
        );
      }
      for (const id of dto.documentIds) {
        this.assertUuid(id, 'documentIds item');
      }
    }
  }
}
