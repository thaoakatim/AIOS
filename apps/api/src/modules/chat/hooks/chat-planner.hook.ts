import { Injectable, Logger } from '@nestjs/common';
import type { AgentExecutionContext } from '../../../core/context/agent-context.interface';
import { ContextBuilder } from '../../../core/context/context-builder';
import type { AIOSHookHandler } from '../../../core/hooks/aios-hook.interface';
import { PlannerService } from '../../planner/planner.service';

/**
 * ChatPlannerHook — Nạp các Active Plans & Tasks chưa hoàn thành vào
 * `AgentExecutionContext.context.activePlans` trong pipeline `onBeforePromptBuild`.
 *
 * Thực hiện Graceful Degradation: lỗi truy vấn Planner sẽ được ghi cảnh báo
 * vào metadata để không làm gián đoạn luồng hội thoại của người dùng.
 */
@Injectable()
export class ChatPlannerHook implements AIOSHookHandler {
  private readonly logger = new Logger(ChatPlannerHook.name);

  constructor(private readonly plannerService: PlannerService) {}

  async onBeforePromptBuild(
    ctx: AgentExecutionContext,
  ): Promise<AgentExecutionContext> {
    try {
      return await this.plannerService.enrichContext(ctx);
    } catch (error) {
      const err = error as Error;
      this.logger.warn(
        `Lỗi khi nạp Active Plans cho user ${ctx.userId}: ${err?.message}`,
      );
      const existingWarnings = (ctx.metadata.warnings as string[]) ?? [];
      return ContextBuilder.from(ctx)
        .mergeMetadata({
          warnings: [
            ...existingWarnings,
            `PlannerService enrichContext failed: ${err?.message}`,
          ],
        })
        .build();
    }
  }
}
