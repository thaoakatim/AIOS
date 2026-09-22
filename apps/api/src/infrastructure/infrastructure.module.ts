import { Module, Global } from '@nestjs/common';
import { PrismaModule } from './database/prisma.module';
import { LLMGatewayService } from '@core/llm/llm-gateway.service';
import { TokenCounterService } from '@core/llm/services/token-counter.service';
import { LLMClientFactory } from './llm-providers/llm-client.factory';
import { VectorStoreFactory } from './vector-store/vector-store.factory';
import { QdrantAdapter } from './vector-store/qdrant.adapter';
import { PgVectorAdapter } from './vector-store/pgvector.adapter';
import { RedisService } from './redis/redis.service';
import { QueueService } from './redis/queue.service';
import { LocalStorageService } from './storage/local-storage.service';
import { DocumentProcessorService } from './storage/document-processor.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    LLMGatewayService,
    TokenCounterService,
    LLMClientFactory,
    VectorStoreFactory,
    QdrantAdapter,
    PgVectorAdapter,
    RedisService,
    QueueService,
    LocalStorageService,
    DocumentProcessorService,
  ],
  exports: [
    PrismaModule,
    LLMGatewayService,
    TokenCounterService,
    LLMClientFactory,
    VectorStoreFactory,
    QdrantAdapter,
    PgVectorAdapter,
    RedisService,
    QueueService,
    LocalStorageService,
    DocumentProcessorService,
  ],
})
export class InfrastructureModule {}
