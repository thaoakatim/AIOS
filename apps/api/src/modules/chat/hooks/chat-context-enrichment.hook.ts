import { Injectable, Logger } from '@nestjs/common';
import { DocumentChunk } from '@prisma/client';
import { AgentExecutionContext } from '../../../core/context/agent-context.interface';
import { ContextBuilder } from '../../../core/context/context-builder';
import { AIOSHookHandler } from '../../../core/hooks/aios-hook.interface';
import { MemoryService } from '../../memory/memory.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';

/**
 * ChatContextEnrichmentHook — Nạp ký ức dài hạn (Memory) và tri thức (RAG)
 * song song bằng Promise.allSettled để tối ưu thời gian phản hồi (TTFT).
 *
 * Thực hiện Graceful Degradation: Nếu Memory hoặc Knowledge gặp sự cố,
 * hook sẽ ghi nhận cảnh báo vào metadata và tiếp tục cuộc hội thoại
 * thay vì làm hỏng trải nghiệm người dùng.
 */
@Injectable()
export class ChatContextEnrichmentHook implements AIOSHookHandler {
  private readonly logger = new Logger(ChatContextEnrichmentHook.name);

  constructor(
    private readonly memoryService: MemoryService,
    private readonly knowledgeService: KnowledgeService,
  ) {}

  async onBeforePromptBuild(
    ctx: AgentExecutionContext,
  ): Promise<AgentExecutionContext> {
    const documentIds = ctx.metadata.documentIds as string[] | undefined;

    // Chạy song song I/O fetch
    const [memoryResult, knowledgeResult] = await Promise.allSettled([
      this.memoryService.getRelevantMemory(ctx),
      this.knowledgeService.getRelevantChunks(ctx, {
        documentIds,
      }),
    ]);

    const builder = ContextBuilder.from(ctx);
    const warnings: string[] = [];

    // Xử lý Memory
    if (memoryResult.status === 'fulfilled') {
      const userProfile = this.memoryService.buildUserProfile(memoryResult.value);
      builder.mergeUserProfile(userProfile);
    } else {
      const err = memoryResult.reason as Error;
      this.logger.warn(`Lỗi khi nạp Memory cho user ${ctx.userId}: ${err?.message}`);
      warnings.push(`MemoryService recall failed: ${err?.message}`);
    }

    // Xử lý Knowledge RAG
    if (knowledgeResult.status === 'fulfilled') {
      const chunks: DocumentChunk[] = knowledgeResult.value.map((hit) => ({
        id: hit.chunkId,
        documentId: hit.documentId,
        content: hit.content,
        metadata: (hit.metadata as any) ?? null,
        embeddingModel: null,
        version: 1,
        contentHash: null,
        deletedAt: null,
      }));
      builder.setRagChunks(chunks);
    } else {
      const err = knowledgeResult.reason as Error;
      this.logger.warn(`Lỗi khi nạp Knowledge RAG cho user ${ctx.userId}: ${err?.message}`);
      warnings.push(`KnowledgeService getRelevantChunks failed: ${err?.message}`);
    }

    if (warnings.length > 0) {
      const existingWarnings = (ctx.metadata.warnings as string[]) ?? [];
      builder.mergeMetadata({ warnings: [...existingWarnings, ...warnings] });
    }

    return builder.build();
  }
}
