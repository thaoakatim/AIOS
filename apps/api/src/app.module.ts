import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ChatModule } from './modules/chat/chat.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { PlannerModule } from './modules/planner/planner.module';
import { MemoryModule } from './modules/memory/memory.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { AgentsModule } from './modules/agents/agents.module';

@Module({
  imports: [ChatModule, KnowledgeModule, PlannerModule, MemoryModule, WorkflowModule, AgentsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
