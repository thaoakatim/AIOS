import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import {
  JOB_TYPES,
  QUEUE_NAMES,
  QueueService,
} from '../../infrastructure/redis/queue.service';
import { KnowledgeService } from './knowledge.service';

/**
 * KnowledgeIngestionWorker — worker BullMQ xử lý pipeline RAG nền
 * (docs/request-flow.md — Flow 3: Knowledge Ingestion & Indexing).
 *
 * Chỉ được đăng ký khi `KNOWLEDGE_PROCESSING_MODE=queue`; chế độ mặc định
 * (`sync`) xử lý ngay trong request nên không mở kết nối worker — nhờ vậy
 * app vẫn boot được khi Redis chưa sẵn sàng.
 */
@Injectable()
export class KnowledgeIngestionWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(KnowledgeIngestionWorker.name);
  private worker?: Worker;

  constructor(
    private readonly queue: QueueService,
    private readonly knowledgeService: KnowledgeService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get<string>('KNOWLEDGE_PROCESSING_MODE') !== 'queue') {
      return;
    }

    this.worker = this.queue.createWorker(
      QUEUE_NAMES.DOCUMENT_PROCESSING,
      async (job) => {
        const documentId = job.data.payload.documentId;
        if (typeof documentId !== 'string') {
          throw new Error(
            `Job ${job.id} thiếu payload.documentId — không thể xử lý ingestion.`,
          );
        }

        this.logger.log(`Worker bắt đầu index tài liệu ${documentId}`);
        const result = await this.knowledgeService.ingest(documentId, {
          chunkSize: job.data.payload.chunkSize as number | undefined,
          chunkOverlap: job.data.payload.chunkOverlap as number | undefined,
        });
        this.logger.log(
          `Worker xong tài liệu ${documentId}: ${result.chunkCount} chunk`,
        );
      },
      2,
    );

    this.logger.log(
      `Đã đăng ký BullMQ worker cho queue "${QUEUE_NAMES.DOCUMENT_PROCESSING}" (job "${JOB_TYPES.INDEX_DOCUMENT}")`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.worker) return;
    await this.worker.close();
    this.worker = undefined;
    this.logger.log('Đã đóng worker BullMQ của Knowledge Module');
  }
}
