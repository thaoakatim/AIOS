import { Job, Worker } from 'bullmq';
import { QueueJobData, QueueService } from './queue.service';
import { RedisService } from './redis.service';
import { IJobQueue } from '../../core/queue';

type MockProcessor = (job: Partial<Job<QueueJobData>>) => Promise<void>;

interface MockWorkerInstance {
  name: string;
  processor: MockProcessor;
  on: jest.Mock;
  close: jest.Mock;
}

const mockWorkersMap = new Map<string, MockWorkerInstance>();

jest.mock('bullmq', () => {
  return {
    Queue: jest.fn().mockImplementation((name: string) => ({
      name,
      add: jest.fn().mockResolvedValue({ id: 'job-123' }),
      close: jest.fn().mockResolvedValue(undefined),
    })),
    Worker: jest
      .fn()
      .mockImplementation((name: string, processor: MockProcessor) => {
        const emitter: MockWorkerInstance = {
          name,
          processor,
          on: jest.fn(),
          close: jest.fn().mockResolvedValue(undefined),
        };
        mockWorkersMap.set(name, emitter);
        return emitter;
      }),
  };
});

describe('QueueService (implementing IJobQueue)', () => {
  let service: QueueService;
  let redisServiceMock: { getClient: jest.Mock };

  beforeEach(() => {
    mockWorkersMap.clear();
    redisServiceMock = {
      getClient: jest.fn().mockReturnValue({}),
    };
    service = new QueueService(redisServiceMock as unknown as RedisService);
  });

  it('implements IJobQueue interface', () => {
    const queueInterface: IJobQueue = service;
    expect(queueInterface).toBeDefined();
    expect(typeof queueInterface.addJob).toBe('function');
    expect(typeof queueInterface.process).toBe('function');
    expect(typeof queueInterface.close).toBe('function');
  });

  it('addJob enqueues job and returns job id', async () => {
    const jobId = await service.addJob(
      'test-queue',
      'test-job',
      { foo: 'bar' },
      { delay: 100 },
    );
    expect(jobId).toBe('job-123');
  });

  it('process registers a worker and translates bull job to IJob', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    service.process('test-queue', handler, 3);

    const worker = mockWorkersMap.get('test-queue');
    expect(worker).toBeDefined();

    // Simulate BullMQ worker receiving a job
    const mockBullJob = {
      id: 'bull-job-1',
      name: 'test-job',
      data: {
        type: 'test-type',
        payload: { payload: 'hello' },
      },
      opts: { priority: 1 },
      timestamp: 123456789,
    };

    await worker!.processor(mockBullJob);

    expect(handler).toHaveBeenCalledWith({
      id: 'bull-job-1',
      name: 'test-job',
      data: {
        type: 'test-type',
        payload: { payload: 'hello' },
      },
      options: { priority: 1 },
      timestamp: 123456789,
    });
  });

  it('close shuts down all queues and workers', async () => {
    service.getQueue('queue-1');
    service.createWorker('queue-1', jest.fn().mockResolvedValue(undefined));

    await expect(service.close()).resolves.toBeUndefined();
  });
});
