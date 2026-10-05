import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatModule } from './modules/chat/chat.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { PlannerModule } from './modules/planner/planner.module';
import { MemoryModule } from './modules/memory/memory.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { AgentsModule } from './modules/agents/agents.module';

import { PrismaModule } from './infrastructure/database/prisma.module';
import { ToolsModule } from './modules/tools/tools.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';

@Module({
  imports: [
    // ConfigModule phải đứng đầu: các adapter hạ tầng (Qdrant, Redis,
    // Embedding, LLM, LocalStorage) đều inject ConfigService để đọc biến môi
    // trường. isGlobal để không phải import lặp ở từng module nghiệp vụ.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    PrismaModule,
    InfrastructureModule,
    ChatModule,
    KnowledgeModule,
    PlannerModule,
    MemoryModule,
    WorkflowModule,
    AgentsModule,
    ToolsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
