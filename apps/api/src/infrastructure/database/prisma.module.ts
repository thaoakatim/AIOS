import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * PrismaModule được đánh dấu @Global() để PrismaService có thể được
 * inject ở mọi module nghiệp vụ khác (Chat, Memory, Knowledge, Planner,...)
 * mà không cần phải import lặp lại ở từng module.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
