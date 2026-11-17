import { HookRegistry } from './hook-registry';
import { AIOSHookHandler } from './aios-hook.interface';
import { ContextBuilder } from '../context/context-builder';
import { AgentExecutionContext } from '../context/agent-context.interface';
import { AgentResponse } from '../context/agent-response.interface';

describe('HookRegistry', () => {
  let registry: HookRegistry;
  let baseCtx: AgentExecutionContext;

  beforeEach(() => {
    registry = new HookRegistry();
    baseCtx = new ContextBuilder()
      .setExecutionId('exec-1')
      .setUserId('user-1')
      .setSessionId('sess-1')
      .setQuery('test query')
      .setUserProfile({ initial: 'value' })
      .build();
  });

  it('runs onBeforePromptBuild through immutable pipeline in sequence', async () => {
    const hook1: AIOSHookHandler = {
      async onBeforePromptBuild(ctx) {
        await Promise.resolve();
        return ContextBuilder.from(ctx)
          .mergeUserProfile({ hook1: 'processed' })
          .addSystemRule('Rule from Hook 1')
          .build();
      },
    };

    const hook2: AIOSHookHandler = {
      async onBeforePromptBuild(ctx) {
        await Promise.resolve();
        return ContextBuilder.from(ctx)
          .mergeUserProfile({ hook2: 'processed' })
          .addSystemRule('Rule from Hook 2')
          .build();
      },
    };

    const noopHook: AIOSHookHandler = {
      // Does not implement onBeforePromptBuild
      async onAfterToolExecution() {
        await Promise.resolve();
      },
    };

    registry.registerHook(hook1);
    registry.registerHook(noopHook);
    registry.registerHook(hook2);

    const finalCtx = await registry.runBeforePromptBuild(baseCtx);

    // Verify original context is untouched
    expect(baseCtx.context.userProfile).toEqual({ initial: 'value' });
    expect(baseCtx.context.systemRules).toEqual([]);

    // Verify final context has accumulated changes from both hooks
    expect(finalCtx.context.userProfile).toEqual({
      initial: 'value',
      hook1: 'processed',
      hook2: 'processed',
    });
    expect(finalCtx.context.systemRules).toEqual([
      'Rule from Hook 1',
      'Rule from Hook 2',
    ]);
  });

  it('executeBeforePromptBuild delegates to runBeforePromptBuild', async () => {
    const hook: AIOSHookHandler = {
      async onBeforePromptBuild(ctx) {
        await Promise.resolve();
        return ContextBuilder.from(ctx).addSystemRule('Enriched').build();
      },
    };
    registry.registerHook(hook);

    const result = await registry.executeBeforePromptBuild(baseCtx);
    expect(result.context.systemRules).toContain('Enriched');
  });

  it('executeBeforeToolExecution returns true when all approve, false when one rejects', async () => {
    const approveMock = jest.fn().mockResolvedValue(true);
    const rejectMock = jest.fn().mockResolvedValue(false);

    const approvingHook: AIOSHookHandler = {
      onBeforeToolExecution: approveMock,
    };
    const rejectingHook: AIOSHookHandler = {
      onBeforeToolExecution: rejectMock,
    };

    registry.registerHook(approvingHook);

    let allowed = await registry.executeBeforeToolExecution(
      'search',
      { q: 'hello' },
      baseCtx,
    );
    expect(allowed).toBe(true);
    expect(approveMock).toHaveBeenCalledWith('search', { q: 'hello' }, baseCtx);

    registry.registerHook(rejectingHook);
    allowed = await registry.executeBeforeToolExecution(
      'search',
      { q: 'hello' },
      baseCtx,
    );
    expect(allowed).toBe(false);
  });

  it('executeAfterToolExecution notifies registered hooks', async () => {
    const afterToolMock = jest.fn().mockResolvedValue(undefined);
    const hook: AIOSHookHandler = {
      onAfterToolExecution: afterToolMock,
    };
    registry.registerHook(hook);

    await registry.executeAfterToolExecution(
      'calculator',
      { result: 42 },
      baseCtx,
    );

    expect(afterToolMock).toHaveBeenCalledWith(
      'calculator',
      { result: 42 },
      baseCtx,
    );
  });

  it('executeAfterCompletion notifies registered hooks', async () => {
    const afterCompletionMock = jest.fn().mockResolvedValue(undefined);
    const hook: AIOSHookHandler = {
      onAfterCompletion: afterCompletionMock,
    };
    registry.registerHook(hook);

    const response: AgentResponse = {
      content: 'Answer from AIOS',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    };

    await registry.executeAfterCompletion(response, baseCtx);

    expect(afterCompletionMock).toHaveBeenCalledWith(response, baseCtx);
  });
});
