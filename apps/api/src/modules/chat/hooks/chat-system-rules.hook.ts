import { Injectable } from '@nestjs/common';
import { AgentExecutionContext } from '../../../core/context/agent-context.interface';
import { ContextBuilder } from '../../../core/context/context-builder';
import { AIOSHookHandler } from '../../../core/hooks/aios-hook.interface';

@Injectable()
export class ChatSystemRulesHook implements AIOSHookHandler {
  async onBeforePromptBuild(
    ctx: AgentExecutionContext,
  ): Promise<AgentExecutionContext> {
    const builder = ContextBuilder.from(ctx);

    builder.addSystemRule(
      'You are AIOS (Personal AI Operating System), a helpful, highly capable, and concise AI assistant.',
    );
    builder.addSystemRule(
      'Always maintain factual accuracy, respect user preferences, and adhere strictly to grounded knowledge.',
    );

    if (ctx.prefetch?.ragChunks && ctx.prefetch.ragChunks.length > 0) {
      builder.addSystemRule(
        'Retrieved knowledge documents are provided. Cite your sources accurately and do not invent facts outside the retrieved context.',
      );
    }

    return builder.build();
  }
}
