import { Injectable, Logger } from '@nestjs/common';
import { AgentExecutionContext } from '../../../core/context/agent-context.interface';
import { AgentResponse } from '../../../core/context/agent-response.interface';
import { AIOSHookHandler } from '../../../core/hooks/aios-hook.interface';
import { ChatRepository } from '../chat.repository';

@Injectable()
export class ChatObservabilityHook implements AIOSHookHandler {
  private readonly logger = new Logger(ChatObservabilityHook.name);

  constructor(private readonly chatRepository: ChatRepository) {}

  async onAfterCompletion(
    response: AgentResponse,
    ctx: AgentExecutionContext,
  ): Promise<void> {
    try {
      const runId = ctx.metadata.runId as string | undefined;
      if (!runId) {
        return;
      }

      const startTimeMs = ctx.metadata.startTimeMs as number | undefined;
      const latencyMs = startTimeMs ? Math.max(0, Date.now() - startTimeMs) : 0;

      const traceLogs: Record<string, unknown> = {
        executionId: ctx.executionId,
        latencyMs,
        usage: response.usage as unknown as Record<string, unknown>,
        ragChunksCount: ctx.prefetch?.ragChunks?.length ?? 0,
        memoryKeysCount: Object.keys(ctx.context.userProfile ?? {}).length,
        warnings: ctx.metadata.warnings ?? [],
      };

      await this.chatRepository.updateAgentRun(runId, {
        status: 'completed',
        totalTokens: response.usage?.totalTokens ?? 0,
        traceLogs,
      });
    } catch (error) {
      // Đảm bảo không ném lỗi ra ngoài làm crash response người dùng
      this.logger.warn(
        `Không thể ghi nhận trace vào AgentRun trong onAfterCompletion: ${(error as Error).message}`,
      );
    }
  }
}
