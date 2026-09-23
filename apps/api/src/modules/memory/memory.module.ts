import { Module } from '@nestjs/common';
import { MemoryRepository } from './memory.repository';
import { MemoryService } from './memory.service';
import { MemoryController } from './memory.controller';

/**
 * MemoryModule — Task 2.1 (Phase 3).
 *
 * Luồng phụ thuộc: Controller -> Service -> Repository -> PrismaService.
 * Repository là điểm duy nhất chạm database; Service chỉ chứa business
 * logic + validation và giao tiếp DB thông qua Repository.
 *
 * Export MemoryService để Chat Module (Task 2.3) và Agents Module
 * inject trực tiếp gọi `getRelevantMemory(ctx)` khi build prompt.
 * PrismaService dùng chung qua @Global PrismaModule nên không cần import.
 */
@Module({
  controllers: [MemoryController],
  providers: [MemoryRepository, MemoryService],
  exports: [MemoryRepository, MemoryService],
})
export class MemoryModule {}
