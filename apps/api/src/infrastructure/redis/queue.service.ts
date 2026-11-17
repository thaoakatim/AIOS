import { Injectable } from '@nestjs/common';
import { Queue, Worker, Job } from 'bullmq';
import { RedisService } from './redis.service';
import { IJobQueue, JobHandler, JobOptions } from '../../core/queue';

export interface QueueJobData {
  type: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export type JobProcessor = (job: Job<QueueJobData>) => Promise<void>;

@Injectable()
export class QueueService implements IJobQueue {
  private readonly queues: Map<string, Queue> = new Map();
  private readonly workers: Map<string, Worker> = new Map();

  constructor(private readonly redisService: RedisService) {}

  getQueue(name: string): Queue {
    if (!this.queues.has(name)) {
      this.queues.set(
        name,
        new Queue(name, { connection: this.redisService.getClient() }),
      );
    }
    return this.queues.get(name)!;
  }

  createWorker(name: string, processor: JobProcessor, concurrency = 5): Worker {
    const worker = new Worker(name, processor, {
      connection: this.redisService.getClient(),
      concurrency,
    });

    worker.on('completed', (job) => {
      console.log(`Job ${job.id} completed in queue ${name}`);
    });

    worker.on('failed', (job, err) => {
      console.error(`Job ${job?.id} failed in queue ${name}:`, err);
    });

    this.workers.set(name, worker);
    return worker;
  }

  async addJob<T = Record<string, unknown>>(
    queueName: string,
    jobName: string,
    data: T,
    options?: JobOptions,
  ): Promise<void | string> {
    const queue = this.getQueue(queueName);
    const job = await queue.add(jobName, data, options);
    return job?.id;
  }

  process<T = Record<string, unknown>>(
    queueName: string,
    handler: JobHandler<T>,
    concurrency = 5,
  ): void {
    this.createWorker(
      queueName,
      async (bullJob) => {
        await handler({
          id: bullJob.id,
          name: bullJob.name,
          data: bullJob.data as T,
          options: bullJob.opts as unknown as JobOptions,
          timestamp: bullJob.timestamp,
        });
      },
      concurrency,
    );
  }

  async close(): Promise<void> {
    await Promise.all([
      ...Array.from(this.queues.values()).map((q) => q.close()),
      ...Array.from(this.workers.values()).map((w) => w.close()),
    ]);
  }
}

export const QUEUE_NAMES = {
  DOCUMENT_PROCESSING: 'document-processing',
  WORKFLOW_EXECUTION: 'workflow-execution',
  EMBEDDING_GENERATION: 'embedding-generation',
  NOTIFICATION: 'notification',
} as const;

export const JOB_TYPES = {
  CHUNK_DOCUMENT: 'chunk-document',
  GENERATE_EMBEDDINGS: 'generate-embeddings',
  INDEX_DOCUMENT: 'index-document',
  EXECUTE_WORKFLOW_STEP: 'execute-workflow-step',
  SEND_NOTIFICATION: 'send-notification',
} as const;
