import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IActivePlanContext } from '@aios/shared-types';
import { AgentExecutionContext } from '../../../core/context/agent-context.interface';
import { LLMMessage } from '../../../core/llm/interfaces/llm.interface';
import { TokenCounterService } from '../../../core/llm/services/token-counter.service';

const MAX_ACTIVE_PLANS_TOKENS = 600;

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

    // Active Plans & Tasks
    if (ctx.context.activePlans) {
      const plansSection = this.formatActivePlansSection(
        ctx.context.activePlans,
        model,
      );
      if (plansSection) {
        systemParts.push(plansSection);
      }
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

  /**
   * Render `ctx.context.activePlans` kèm giới hạn ngân sách token (~600 tokens)
   * để không làm tràn system prompt khi người dùng có nhiều plan/task.
   */
  private formatActivePlansSection(
    activePlans: Record<string, unknown>,
    model: string,
  ): string | null {
    const rawPlans = activePlans.plans;
    if (!Array.isArray(rawPlans) || rawPlans.length === 0) {
      return null;
    }

    const header = '## Active Plans & Tasks';
    const blocks: string[] = [header];

    for (const rawPlan of rawPlans as IActivePlanContext[]) {
      if (!rawPlan || typeof rawPlan.title !== 'string') continue;
      const lines: string[] = [`- Plan "${rawPlan.title}" [${rawPlan.status}]`];

      if (Array.isArray(rawPlan.tasks)) {
        for (const task of rawPlan.tasks) {
          if (!task || typeof task.title !== 'string') continue;
          const dueSuffix = task.dueDate ? ` (due: ${task.dueDate})` : '';
          lines.push(`  - [${task.status}] ${task.title}${dueSuffix}`);
        }
      }

      const candidateBlock = lines.join('\n');
      const nextText = [...blocks, candidateBlock].join('\n');
      if (
        blocks.length > 1 &&
        this.tokenCounter.countTokens(nextText, model) > MAX_ACTIVE_PLANS_TOKENS
      ) {
        break;
      }

      if (
        blocks.length === 1 &&
        this.tokenCounter.countTokens(nextText, model) > MAX_ACTIVE_PLANS_TOKENS
      ) {
        // Giữ tối thiểu tiêu đề plan đầu tiên nếu vượt ngân sách ở plan 1.
        blocks.push(`- Plan "${rawPlan.title}" [${rawPlan.status}]`);
        break;
      }

      blocks.push(candidateBlock);
    }

    return blocks.length > 1 ? blocks.join('\n') : null;
  }
}
