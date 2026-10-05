import { Module } from '@nestjs/common';
import { RecursiveTextSplitter } from './services/recursive-text-splitter';
import { KnowledgeRepository } from './knowledge.repository';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeIngestionWorker } from './knowledge.ingestion.worker';

/**
 * KnowledgeModule — Task 2.2 (Phase 3: Knowledge & RAG).
 *
 * Luồng phụ thuộc: Controller -> Service -> Repository -> PrismaService.
 * Repository là điểm duy nhất chạm database; Service điều phối pipeline RAG
 * qua các adapter hạ tầng (LocalStorage, DocumentProcessor, EmbeddingGateway,
 * VectorStore, BullMQ).
 *
 * Export KnowledgeService để Chat Module (Task 2.3) inject trực tiếp gọi
 * `getRelevantChunks(ctx)` / `injectIntoContext(ctx)` khi build prompt RAG.
 * PrismaService và các adapter hạ tầng đến từ @Global modules
 * (PrismaModule, InfrastructureModule) nên không cần import lại.
 */
@Module({
  controllers: [KnowledgeController],
  providers: [
    KnowledgeRepository,
    KnowledgeService,
    RecursiveTextSplitter,
    KnowledgeIngestionWorker,
  ],
  exports: [KnowledgeRepository, KnowledgeService, RecursiveTextSplitter],
})
export class KnowledgeModule {}
