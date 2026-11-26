import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma.module';
import { InfrastructureModule } from '../../infrastructure/infrastructure.module';
import { AuthModule } from '../auth/auth.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { MemoryModule } from '../memory/memory.module';
import { PlannerModule } from '../planner/planner.module';
import { HookRegistry } from '../../core/hooks/hook-registry';
import { ChatController } from './chat.controller';
import { ChatRepository } from './chat.repository';
import { ChatService } from './chat.service';
import { CHAT_HOOK_REGISTRY } from './chat.tokens';
import { ChatSystemRulesHook } from './hooks/chat-system-rules.hook';
import { ChatContextEnrichmentHook } from './hooks/chat-context-enrichment.hook';
import { ChatPlannerHook } from './hooks/chat-planner.hook';
import { ChatObservabilityHook } from './hooks/chat-observability.hook';
import { ChatPromptBuilderService } from './services/chat-prompt-builder.service';

@Module({
  imports: [
    PrismaModule,
    InfrastructureModule,
    AuthModule,
    KnowledgeModule,
    MemoryModule,
    PlannerModule,
  ],
  controllers: [ChatController],
  providers: [
    ChatRepository,
    ChatPromptBuilderService,
    ChatSystemRulesHook,
    ChatContextEnrichmentHook,
    ChatPlannerHook,
    ChatObservabilityHook,
    {
      provide: CHAT_HOOK_REGISTRY,
      useFactory: (
        systemRulesHook: ChatSystemRulesHook,
        enrichmentHook: ChatContextEnrichmentHook,
        plannerHook: ChatPlannerHook,
        observabilityHook: ChatObservabilityHook,
      ) => {
        const registry = new HookRegistry();
        registry.registerHook(systemRulesHook);
        registry.registerHook(enrichmentHook);
        registry.registerHook(plannerHook);
        registry.registerHook(observabilityHook);
        return registry;
      },
      inject: [
        ChatSystemRulesHook,
        ChatContextEnrichmentHook,
        ChatPlannerHook,
        ChatObservabilityHook,
      ],
    },
    ChatService,
  ],
  exports: [ChatService, ChatRepository],
})
export class ChatModule {}
