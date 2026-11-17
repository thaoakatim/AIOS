import { ContextBuilder } from './context-builder';
import { AgentExecutionContext } from './agent-context.interface';
import { DocumentChunk, Message } from '@prisma/client';
import { ToolDefinition } from '../tools/tool.interface';

describe('ContextBuilder', () => {
  it('throws an error if userId is missing when building', () => {
    const builder = new ContextBuilder()
      .setExecutionId('exec-1')
      .setSessionId('sess-1')
      .setQuery('test query');

    expect(() => builder.build()).toThrow(
      'ContextBuilder: userId là bắt buộc (Data Ownership).',
    );
  });

  it('builds a complete AgentExecutionContext with frozen properties', () => {
    const chunk: DocumentChunk = {
      id: 'chunk-1',
      documentId: 'doc-1',
      content: 'chunk content',
      embeddingModel: null,
      version: 1,
      contentHash: null,
      deletedAt: null,
      metadata: { page: 1 },
    };

    const message: Message = {
      id: 'msg-1',
      conversationId: 'conv-1',
      agentSessionId: null,
      role: 'user',
      content: 'Hello AIOS',
      version: 1,
      contentHash: null,
      deletedAt: null,
      createdAt: new Date(),
    };

    const tool: ToolDefinition = {
      name: 'calculator',
      description: 'Calculates math expressions',
      parameters: { type: 'object', properties: {} },
    };

    const ctx = new ContextBuilder()
      .setExecutionId('exec-100')
      .setUserId('user-uuid-123')
      .setSessionId('sess-100')
      .setQuery('What is the weather?')
      .setUserProfile({ name: 'Alice', theme: 'dark' })
      .addSystemRule('Always respond politely')
      .setActivePlans({ planId: 'plan-1' })
      .setRagChunks([chunk])
      .setRecentMessages([message])
      .setAvailableTools([tool])
      .setMetadata({ source: 'web' })
      .build();

    expect(ctx.executionId).toBe('exec-100');
    expect(ctx.userId).toBe('user-uuid-123');
    expect(ctx.sessionId).toBe('sess-100');
    expect(ctx.query).toBe('What is the weather?');
    expect(ctx.context.userProfile).toEqual({ name: 'Alice', theme: 'dark' });
    expect(ctx.context.systemRules).toContain('Always respond politely');
    expect(ctx.context.activePlans).toEqual({ planId: 'plan-1' });
    expect(ctx.prefetch?.ragChunks).toHaveLength(1);
    expect(ctx.prefetch?.recentMessages).toHaveLength(1);
    expect(ctx.availableTools).toHaveLength(1);
    expect(ctx.metadata).toEqual({ source: 'web' });

    // Verify immutability (Object.freeze)
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(ctx.context)).toBe(true);
    expect(Object.isFrozen(ctx.context.userProfile)).toBe(true);
    expect(Object.isFrozen(ctx.metadata)).toBe(true);
  });

  it('clones immutably via ContextBuilder.from without mutating original context', () => {
    const originalCtx: AgentExecutionContext = new ContextBuilder()
      .setExecutionId('exec-1')
      .setUserId('user-origin')
      .setSessionId('sess-1')
      .setQuery('query 1')
      .setUserProfile({ role: 'admin' })
      .setSystemRules(['rule 1'])
      .setMetadata({ step: 1 })
      .build();

    const enrichedCtx = ContextBuilder.from(originalCtx)
      .mergeUserProfile({ location: 'Hanoi' })
      .addSystemRule('rule 2')
      .mergeMetadata({ step: 2 })
      .build();

    // Original context remains unchanged
    expect(originalCtx.context.userProfile).toEqual({ role: 'admin' });
    expect(originalCtx.context.systemRules).toEqual(['rule 1']);
    expect(originalCtx.metadata).toEqual({ step: 1 });

    // Enriched context contains merged changes
    expect(enrichedCtx.userId).toBe('user-origin');
    expect(enrichedCtx.context.userProfile).toEqual({
      role: 'admin',
      location: 'Hanoi',
    });
    expect(enrichedCtx.context.systemRules).toEqual(['rule 1', 'rule 2']);
    expect(enrichedCtx.metadata).toEqual({ step: 2 });
  });

  it('supports addRagChunks and addRecentMessage dynamically', () => {
    const chunk1: DocumentChunk = {
      id: 'c-1',
      documentId: 'd-1',
      content: 'chunk 1',
      embeddingModel: null,
      version: 1,
      contentHash: null,
      deletedAt: null,
      metadata: null,
    };
    const chunk2: DocumentChunk = {
      id: 'c-2',
      documentId: 'd-1',
      content: 'chunk 2',
      embeddingModel: null,
      version: 1,
      contentHash: null,
      deletedAt: null,
      metadata: null,
    };

    const ctx = new ContextBuilder()
      .setUserId('u-1')
      .addRagChunks([chunk1])
      .addRagChunks([chunk2])
      .build();

    expect(ctx.prefetch?.ragChunks).toHaveLength(2);
    expect(ctx.prefetch?.ragChunks?.[0].id).toBe('c-1');
    expect(ctx.prefetch?.ragChunks?.[1].id).toBe('c-2');
  });
});
