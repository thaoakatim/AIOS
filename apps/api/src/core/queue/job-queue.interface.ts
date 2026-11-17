/**
 * Tùy chọn cấu hình khi đẩy job vào hàng đợi.
 */
export interface JobOptions {
  delay?: number;
  priority?: number;
  attempts?: number;
  backoff?: number | { type: string; delay?: number };
  [key: string]: unknown;
}

/**
 * Dữ liệu bao đóng của một Job khi được xử lý.
 */
export interface IJob<T = Record<string, unknown>> {
  readonly id?: string;
  readonly name: string;
  readonly data: T;
  readonly options?: JobOptions;
  readonly timestamp?: number;
}

/**
 * Handler xử lý tác vụ của một Job.
 */
export type JobHandler<T = Record<string, unknown>> = (
  job: IJob<T>,
) => Promise<void>;

/**
 * IJobQueue — Hợp đồng trừu tượng hóa hàng đợi tác vụ nền (Queue Abstraction).
 * Độc lập 100% với SDK bên ngoài (BullMQ / Redis / PGlite SQL Table Queue).
 *
 * Môi trường hoạt động:
 * - Docker Dev / Cloud: Sử dụng BullMQ + Redis adapter (`QueueService`).
 * - Desktop Production: Sử dụng `PgLiteQueueAdapter` lưu trạng thái job vào bảng SQL của PGlite (Zero-Daemon).
 */
export interface IJobQueue {
  /**
   * Đẩy một tác vụ mới vào hàng đợi chỉ định.
   */
  addJob<T = Record<string, unknown>>(
    queueName: string,
    jobName: string,
    data: T,
    options?: JobOptions,
  ): Promise<void | string>;

  /**
   * Đăng ký worker/handler lắng nghe và xử lý tác vụ từ hàng đợi.
   */
  process<T = Record<string, unknown>>(
    queueName: string,
    handler: JobHandler<T>,
    concurrency?: number,
  ): Promise<void> | void;

  /**
   * Đóng toàn bộ kết nối hàng đợi và workers giải phóng tài nguyên.
   */
  close(): Promise<void>;
}
