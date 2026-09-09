import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService quản lý kết nối vòng đời (Lifecycle) tới PostgreSQL database.
 * Kế thừa trực tiếp từ PrismaClient để các Service khác có thể inject và truy vấn
 * 14 bảng dữ liệu (Conversation, Message, AgentRun, Document, Task,...) theo type-safe.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log:
        process.env.NODE_ENV === 'development'
          ? [
              { emit: 'event', level: 'query' },
              { emit: 'stdout', level: 'info' },
              { emit: 'stdout', level: 'warn' },
              { emit: 'stdout', level: 'error' },
            ]
          : [{ emit: 'stdout', level: 'error' }],
    });
  }

  /**
   * Kích hoạt khi module khởi tạo: mở kết nối tới database
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('✅ Kết nối PostgreSQL thành công qua Prisma');

      // Tùy chọn: Log câu query ở môi trường development
      if (process.env.NODE_ENV === 'development') {
        // @ts-expect-error - Prisma client event listener typing
        this.$on('query', (e: { query: string; duration: number }) => {
          this.logger.debug(`[Query] ${e.query} - ${e.duration}ms`);
        });
      }
    } catch (error) {
      this.logger.error('❌ Lỗi kết nối PostgreSQL database:', error);
      throw error;
    }
  }

  /**
   * Kích hoạt khi ứng dụng dừng/tắt: ngắt kết nối an toàn tránh rò rỉ connection pool
   */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('🔌 Đã đóng kết nối PostgreSQL an toàn');
  }

  /**
   * Phương thức tiện ích dọn dẹp dữ liệu (chỉ cho phép dùng trong môi trường test/e2e)
   */
  async cleanDatabase(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Không thể chạy cleanDatabase trên môi trường Production!',
      );
    }

    const models = Reflect.ownKeys(this).filter(
      (key) =>
        typeof key === 'string' && !key.startsWith('_') && !key.startsWith('$'),
    );

    return Promise.all(
      models.map((modelKey) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const model = (this as Record<string, any>)[modelKey as string];
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (model && typeof model.deleteMany === 'function') {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          return model.deleteMany();
        }
        return Promise.resolve();
      }),
    ).then(() => {
      this.logger.warn(
        '🧹 Toàn bộ dữ liệu database đã được làm sạch (Test Mode)',
      );
    });
  }
}
