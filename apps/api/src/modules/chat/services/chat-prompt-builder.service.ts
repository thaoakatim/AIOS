import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentExecutionContext } from '../../../core/context/agent-context.interface';
import { LLMMessage } from '../../../core/llm/interfaces/llm.interface';
import { TokenCounterService } from '../../../core/llm/services/token-counter.service';

@Injectable()
export class ChatPromptBuilderService {
  constructor(
    private readonly tokenCounter: TokenCounterService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Chuyển đổi AgentExecutionContext thành mảng LLMMessage hợp lệ,
   * tuân thủ ngân sách token và cắt tỉa lịch sử khi vượt giới hạn context window.
   */
  buildMessages(ctx: AgentExecutionContext): LLMMessage[] {
    const model = this.config.get('LLM_MODEL') || 'gpt-4o-mini';

    // 1. Xây dựng System Message
    const systemParts: string[] = [];

    // System Rules
    if (ctx.context.systemRules && ctx.context.systemRules.length > 0) {
      systemParts.push(ctx.context.systemRules.join('\n'));
    }

    // Long-term Memory Profile
    const profileKeys = Object.keys(ctx.context.userProfile ?? {});
    if (profileKeys.length > 0) {
      const memoryLines = profileKeys.map(
        (key) => `- ${key}: ${ctx.context.userProfile[key]}`,
      );
      systemParts.push(
        `## User Profile & Long-term Memory\n${memoryLines.join('\n')}`,
      );
    }

    // RAG Knowledge Chunks
    if (ctx.prefetch?.ragChunks && ctx.prefetch.ragChunks.length > 0) {
      const chunkSections = ctx.prefetch.ragChunks.map((chunk, index) => {
        return `[Tài liệu ${index + 1} - Document ID: ${chunk.documentId}]:\n${chunk.content}`;
      });
      systemParts.push(
        `## Retrieved Knowledge Context\n${chunkSections.join('\n\n')}`,
      );
    }

    const systemMessage: LLMMessage = {
      role: 'system',
      content:
        systemParts.join('\n\n') ||
        'You are AIOS (Personal AI Operating System), a helpful assistant.',
    };

    // 2. Xây dựng Current User Message
    const currentUserMessage: LLMMessage = {
      role: 'user',
      content: ctx.query,
    };

    // 3. Xây dựng Lịch sử tin nhắn (Recent Messages)
    const rawHistory: LLMMessage[] = (ctx.prefetch?.recentMessages ?? []).map(
      (msg) => ({
        role: msg.role as 'user' | 'assistant' | 'system' | 'tool',
        content: msg.content,
      }),
    );

    // 4. Token Budgeting & Cắt tỉa lịch sử
    const limits = this.tokenCounter.getModelLimits(model);
    const reserveTokens = 1000;
    const maxTokens = limits.contextWindow - reserveTokens;

    const baseTokens =
      this.tokenCounter.countMessageTokens(systemMessage, model) +
      this.tokenCounter.countMessageTokens(currentUserMessage, model);

    // Cắt tỉa các tin nhắn lịch sử cũ nhất ở đầu danh sách cho đến khi vừa ngân sách
    const trimmedHistory = [...rawHistory];
    let historyTokens = this.tokenCounter.countMessagesTokens(
      trimmedHistory,
      model,
    );

    while (
      baseTokens + historyTokens > maxTokens &&
      trimmedHistory.length > 0
    ) {
      const removed = trimmedHistory.shift();
      if (removed) {
        historyTokens -= this.tokenCounter.countMessageTokens(removed, model);
      }
    }

    // Trả về: [SystemMessage, ...TrimmedHistory, CurrentUserMessage]
    return [systemMessage, ...trimmedHistory, currentUserMessage];
  }
}
