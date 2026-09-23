import { MemoryRecord } from '@prisma/client';

/**
 * Entity đại diện cho một ký ức dài hạn (bảng `memory_records`).
 * Là lớp thuần TypeScript bọc Prisma model để tầng Controller
 * không phụ thuộc trực tiếp vào kiểu Prisma.
 */
export class Memory {
  id!: string;
  sourceAgentSessionId!: string | null;
  scope!: string;
  category!: string;
  key!: string;
  value!: string;
  updatedAt!: Date;

  static fromPrisma(record: MemoryRecord): Memory {
    const entity = new Memory();
    entity.id = record.id;
    entity.sourceAgentSessionId = record.sourceAgentSessionId;
    entity.scope = record.scope;
    entity.category = record.category;
    entity.key = record.key;
    entity.value = record.value;
    entity.updatedAt = record.updatedAt;
    return entity;
  }

  static fromPrismaMany(records: MemoryRecord[]): Memory[] {
    return records.map((record) => Memory.fromPrisma(record));
  }
}

/** Kết quả phân trang cho Memory Board (Dashboard). */
export interface MemoryListResult {
  data: Memory[];
  total: number;
}
