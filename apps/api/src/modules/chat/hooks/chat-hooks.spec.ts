import { Test, TestingModule } from '@nestjs/testing';
import { AgentExecutionContext } from '../../../core/context/agent-context.interface';
import { ContextBuilder } from '../../../core/context/context-builder';
import { MemoryService } from '../../memory/memory.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { PlannerService } from '../../planner/planner.service';
import { ChatRepository } from '../chat.repository';
import { ChatSystemRulesHook } from './chat-system-rules.hook';
import { ChatContextEnrichmentHook } from './chat-context-enrichment.hook';
import { ChatPlannerHook } from './chat-planner.hook';
import { ChatObservabilityHook } from './chat-observability.hook';

describe('Chat Hooks', () => {
  let systemRulesHook: ChatSystemRulesHook;
  let enrichmentHook: ChatContextEnrichmentHook;
  let plannerHook: ChatPlannerHook;
  let observabilityHook: ChatObservabilityHook;

  let memoryService: {
    getRelevantMemory: jest.Mock;
    buildUserProfile: jest.Mock;
  };
  let knowledgeService: {
    getRelevantChunks: jest.Mock;
  };
  let plannerService: {
    enrichContext: jest.Mock;
  };
  let chatRepository: {
    updateAgentRun: jest.Mock;
  };

  let baseCtx: AgentExecutionContext;

  beforeEach(async () => {
    memoryService = {
      getRelevantMemory: jest.fn(),
      buildUserProfile: jest.fn(),
    };
    knowledgeService = {
      getRelevantChunks: jest.fn(),
    };
    plannerService = {
      enrichContext: jest.fn(),
    };
    chatRepository = {
      updateAgentRun: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatSystemRulesHook,
        ChatContextEnrichmentHook,
        ChatPlannerHook,
        ChatObservabilityHook,
        { provide: MemoryService, useValue: memoryService },
        { provide: KnowledgeService, useValue: knowledgeService },
        { provide: PlannerService, useValue: plannerService },
        { provide: ChatRepository, useValue: chatRepository },
      ],
    }).compile();

    systemRulesHook = module.get<ChatSystemRulesHook>(ChatSystemRulesHook);
    enrichmentHook = module.get<ChatContextEnrichmentHook>(
      ChatContextEnrichmentHook,
    );
    plannerHook = module.get<ChatPlannerHook>(ChatPlannerHook);
    observabilityHook = module.get<ChatObservabilityHook>(
      ChatObservabilityHook,
    );

    baseCtx = new ContextBuilder()
      .setExecutionId('exec-1')
      .setUserId('user-1')
      .setSessionId('conv-1')
      .setQuery('What is AIOS?')
      .setMetadata({
        runId: 'run-1',
        startTimeMs: Date.now() - 500,
        documentIds: ['doc-1'],
      })
      .build();
  });

  describe('ChatSystemRulesHook', () => {
    it('adds default system rules and maintains immutability', async () => {
      const result = await systemRulesHook.onBeforePromptBuild(baseCtx);

      expect(baseCtx.context.systemRules).toEqual([]);
      expect(result.context.systemRules.length).toBeGreaterThan(0);
      expect(result.context.systemRules[0]).toContain('AIOS');
    });

    it('adds Grounded Citations rule when RAG chunks are present', async () => {
      const ctxWithChunks = ContextBuilder.from(baseCtx)
        .setRagChunks([
          {
            id: 'chunk-1',
            documentId: 'doc-1',
            content: 'AIOS Architecture',
            metadata: null,
            embeddingModel: null,
            version: 1,
            contentHash: null,
            deletedAt: null,
          },
        ])
        .build();

      const result = await systemRulesHook.onBeforePromptBuild(ctxWithChunks);
      const joinedRules = result.context.systemRules.join(' ');
      expect(joinedRules).toContain('Cite your sources accurately');
    });
  });

  describe('ChatContextEnrichmentHook', () => {
    it('enriches memory and knowledge in parallel via Promise.allSettled', async () => {
      memoryService.getRelevantMemory.mockResolvedValue([
        { key: 'pref_lang', value: 'TypeScript' },
      ]);
      memoryService.buildUserProfile.mockReturnValue({
        pref_lang: 'TypeScript',
      });

      knowledgeService.getRelevantChunks.mockResolvedValue([
        {
          chunkId: 'chunk-1',
          documentId: 'doc-1',
          content: 'Relevant chunk content',
          metadata: { startOffset: 0 },
        },
      ]);

      const result = await enrichmentHook.onBeforePromptBuild(baseCtx);

      expect(memoryService.getRelevantMemory).toHaveBeenCalledWith(baseCtx);
      expect(knowledgeService.getRelevantChunks).toHaveBeenCalledWith(baseCtx, {
        documentIds: ['doc-1'],
      });

      expect(result.context.userProfile).toEqual({ pref_lang: 'TypeScript' });
      expect(result.prefetch?.ragChunks).toHaveLength(1);
      expect(result.prefetch?.ragChunks?.[0].content).toBe(
        'Relevant chunk content',
      );
    });

    it('handles graceful degradation when memory service throws an error', async () => {
      memoryService.getRelevantMemory.mockRejectedValue(
        new Error('Memory database timeout'),
      );
      knowledgeService.getRelevantChunks.mockResolvedValue([]);

      const result = await enrichmentHook.onBeforePromptBuild(baseCtx);

      // Context is still valid and not crashed
      expect(result).toBeDefined();
      expect(result.context.userProfile).toEqual({});
      const warnings = result.metadata.warnings as string[];
      expect(warnings).toBeDefined();
      expect(warnings[0]).toContain('MemoryService recall failed');
    });

    it('handles graceful degradation when knowledge service throws an error', async () => {
      memoryService.getRelevantMemory.mockResolvedValue([]);
      memoryService.buildUserProfile.mockReturnValue({});
      knowledgeService.getRelevantChunks.mockRejectedValue(
        new Error('Qdrant/Vector store unavailable'),
      );

      const result = await enrichmentHook.onBeforePromptBuild(baseCtx);

      expect(result).toBeDefined();
      expect(result.prefetch?.ragChunks).toBeUndefined();
      const warnings = result.metadata.warnings as string[];
      expect(warnings).toBeDefined();
      expect(warnings[0]).toContain(
        'KnowledgeService getRelevantChunks failed',
      );
    });
  });

  describe('ChatObservabilityHook', () => {
    it('calculates latency and updates AgentRun on completion', async () => {
      chatRepository.updateAgentRun.mockResolvedValue({});

      await observabilityHook.onAfterCompletion(
        {
          content: 'AIOS is a personal AI operating system.',
          usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
        },
        baseCtx,
      );

      expect(chatRepository.updateAgentRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          status: 'completed',
          totalTokens: 70,
          traceLogs: expect.objectContaining({
            executionId: 'exec-1',
            usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
          }),
        }),
      );
    });

    it('catches and suppresses repository errors without rethrowing', async () => {
      chatRepository.updateAgentRun.mockRejectedValue(
        new Error('DB write failed'),
      );

      await expect(
        observabilityHook.onAfterCompletion(
          {
            content: 'Response',
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          },
          baseCtx,
        ),
      ).resolves.not.toThrow();
    });
  });

  describe('ChatPlannerHook', () => {
    it('enriches context with active plans via PlannerService', async () => {
      const enriched = ContextBuilder.from(baseCtx)
        .setActivePlans({
          totalActivePlans: 1,
          plans: [{ id: 'p1', title: 'Sprint 3', status: 'active', tasks: [] }],
        })
        .build();
      plannerService.enrichContext.mockResolvedValue(enriched);

      const result = await plannerHook.onBeforePromptBuild(baseCtx);

      expect(plannerService.enrichContext).toHaveBeenCalledWith(baseCtx);
      expect(result.context.activePlans).toEqual({
        totalActivePlans: 1,
        plans: [{ id: 'p1', title: 'Sprint 3', status: 'active', tasks: [] }],
      });
    });

    it('handles graceful degradation when PlannerService throws an error', async () => {
      plannerService.enrichContext.mockRejectedValue(new Error('DB offline'));

      const result = await plannerHook.onBeforePromptBuild(baseCtx);

      expect(result).toBeDefined();
      expect(result.context.activePlans).toBeUndefined();
      const warnings = result.metadata.warnings as string[];
      expect(warnings[0]).toContain('PlannerService enrichContext failed');
    });
  });
});
