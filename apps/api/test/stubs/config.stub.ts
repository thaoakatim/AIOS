/**
 * Stub CJS cho `@nestjs/config`.
 *
 * Lý do tồn tại: `@nestjs/config` v12 là package ESM-only (`"type": "module"`,
 * không kèm bản CommonJS). Runtime NestJS chạy trên Node >= 22.12 nên
 * `require()` ESM hoạt động bình thường, nhưng Jest dùng CommonJS runtime
 * riêng và sẽ ném lỗi "Must use import to load ES Module" ngay khi bất kỳ
 * spec nào import ConfigService.
 *
 * Thay vì cấu hình Jest chạy ESM (đụng vào toàn bộ test hiện có), ta ánh xạ
 * `@nestjs/config` sang stub này. Stub cài đặt lại đúng phần API mà dự án dùng:
 * - `ConfigService.get(key, defaultValue)` đọc từ config nội bộ, rồi tới
 *   `process.env` (thứ tự giống hành vi thật của ConfigService).
 * - `ConfigModule.forRoot()` trả về DynamicModule tối thiểu cho AppModule.
 *
 * Các spec vẫn override provider `ConfigService` bằng mock riêng nên không
 * phụ thuộc vào hành vi này.
 */
import { DynamicModule, Global, Module } from '@nestjs/common';

type ConfigRecord = Record<string, unknown>;

export class ConfigService {
  private readonly internalConfig: ConfigRecord;

  constructor(internalConfig: ConfigRecord = {}) {
    this.internalConfig = { ...internalConfig };
  }

  get<T = string>(propertyPath: string): T;
  get<T = string>(propertyPath: string, defaultValue: T): T;
  get<T = string>(propertyPath: string, defaultValue?: T): T {
    const key = this.resolveKey(propertyPath);
    if (key in this.internalConfig) {
      return this.internalConfig[key] as T;
    }
    if (key in process.env) {
      return process.env[key] as unknown as T;
    }
    return defaultValue as T;
  }

  set<T = string>(propertyPath: string, value: T): void {
    this.internalConfig[this.resolveKey(propertyPath)] = value;
  }

  private resolveKey(propertyPath: string): string {
    const normalized = propertyPath
      .replace(/\[["']?([^"'\]]+)["']?\]/gu, '.$1')
      .replace(/^\./u, '')
      .replace(/\./gu, '_')
      .toUpperCase();
    // Cho phép truy cập bằng cả dạng "DATABASE_URL" và "databaseUrl".
    return normalized in process.env || keyInEnv(normalized)
      ? normalized
      : propertyPath;
  }
}

function keyInEnv(key: string): boolean {
  return Object.keys(process.env).includes(key);
}

@Global()
@Module({})
export class ConfigModule {
  static forRoot(
    options: { isGlobal?: boolean; envFilePath?: string | string[] } = {},
  ): DynamicModule {
    // envFilePath không được nạp ở stub: test không nên phụ thuộc file .env
    // trên đĩa, và mọi giá trị đều lấy từ process.env.
    void options;
    return {
      module: ConfigModule,
      providers: [
        {
          provide: ConfigService,
          useFactory: () => new ConfigService(),
        },
      ],
      exports: [ConfigService],
    };
  }
}
