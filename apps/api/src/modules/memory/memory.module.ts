import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { MemoryController } from './memory.controller';

/**
 * MemoryModule — Task 2.1 (Phase 3).
 * Export MemoryService để Chat Module (Task 2.3) và Agents Module
 * inject trực tiếp gọi `getRelevantMemory(ctx)` khi build prompt.
 * PrismaService dùng chung qua @Global PrismaModule nên không cần import.
 */
@Module({
  controllers: [MemoryController],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
