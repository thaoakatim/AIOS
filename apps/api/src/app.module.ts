import { Module } from '@nestjs/common';
import { ChatModule } from './modules/chat/chat.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { PlannerModule } from './modules/planner/planner.module';
import { MemoryModule } from './modules/memory/memory.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { AgentsModule } from './modules/agents/agents.module';

import { PrismaModule } from './infrastructure/database/prisma.module';

@Module({
  imports: [
    PrismaModule,
    ChatModule,
    KnowledgeModule,
    PlannerModule,
    MemoryModule,
    WorkflowModule,
    AgentsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
