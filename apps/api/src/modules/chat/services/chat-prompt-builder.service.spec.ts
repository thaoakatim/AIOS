import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TokenCounterService } from '../../../core/llm/services/token-counter.service';
import { ContextBuilder } from '../../../core/context/context-builder';
import { ChatPromptBuilderService } from './chat-prompt-builder.service';

describe('ChatPromptBuilderService', () => {
  let service: ChatPromptBuilderService;
  let tokenCounter: TokenCounterService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatPromptBuilderService,
        TokenCounterService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'LLM_MODEL') return 'gpt-4o-mini';
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<ChatPromptBuilderService>(ChatPromptBuilderService);
    tokenCounter = module.get<TokenCounterService>(TokenCounterService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('builds system message, history messages, and current query message', () => {
    const ctx = new ContextBuilder()
      .setExecutionId('exec-1')
      .setUserId('user-1')
      .setSessionId('conv-1')
      .setQuery('Can you help me?')
      .setSystemRules(['Be helpful', 'Be concise'])
      .setUserProfile({ name: 'Alice', theme: 'dark' })
      .setRagChunks([
        {
          id: 'c1',
          documentId: 'd1',
          content: 'Document info 1',
          metadata: null,
          embeddingModel: null,
          version: 1,
          contentHash: null,
          deletedAt: null,
        },
      ])
      .setRecentMessages([
        {
          id: 'm1',
          conversationId: 'conv-1',
          role: 'user',
          content: 'Previous query',
          version: 1,
          contentHash: null,
          deletedAt: null,
          createdAt: new Date(),
          agentSessionId: null,
        },
        {
          id: 'm2',
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'Previous response',
          version: 1,
          contentHash: null,
          deletedAt: null,
          createdAt: new Date(),
          agentSessionId: null,
        },
      ])
      .build();

    const messages = service.buildMessages(ctx);

    expect(messages.length).toBe(4);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Be helpful');
    expect(messages[0].content).toContain('User Profile & Long-term Memory');
    expect(messages[0].content).toContain('Alice');
    expect(messages[0].content).toContain('Document info 1');

    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toBe('Previous query');

    expect(messages[2].role).toBe('assistant');
    expect(messages[2].content).toBe('Previous response');

    expect(messages[3].role).toBe('user');
    expect(messages[3].content).toBe('Can you help me?');
  });

  it('trims oldest history messages when exceeding context window while preserving system and current query', () => {
    // Mock getModelLimits with a small context window
    jest.spyOn(tokenCounter, 'getModelLimits').mockReturnValue({
      model: 'gpt-4o-mini',
      maxTokens: 100,
      contextWindow: 120, // small limit so trim triggers
    });

    const ctx = new ContextBuilder()
      .setExecutionId('exec-1')
      .setUserId('user-1')
      .setSessionId('conv-1')
      .setQuery('Current question')
      .setSystemRules(['System instruction'])
      .setRecentMessages([
        {
          id: 'm1',
          conversationId: 'conv-1',
          role: 'user',
          content: 'Very old message that should be trimmed first',
          version: 1,
          contentHash: null,
          deletedAt: null,
          createdAt: new Date(),
          agentSessionId: null,
        },
        {
          id: 'm2',
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'Recent response that might be kept',
          version: 1,
          contentHash: null,
          deletedAt: null,
          createdAt: new Date(),
          agentSessionId: null,
        },
      ])
      .build();

    const messages = service.buildMessages(ctx);

    // First message must always be system
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('System instruction');

    // Last message must always be current user query
    expect(messages[messages.length - 1].role).toBe('user');
    expect(messages[messages.length - 1].content).toBe('Current question');
  });

  it('renders Active Plans & Tasks into the system message and enforces token budget', () => {
    const longTaskTitle = 'Implement feature '.repeat(350);
    const ctx = new ContextBuilder()
      .setExecutionId('exec-2')
      .setUserId('user-1')
      .setSessionId('conv-1')
      .setQuery('What are my tasks?')
      .setActivePlans({
        totalActivePlans: 2,
        plans: [
          {
            id: 'p1',
            title: 'Plan Alpha',
            status: 'active',
            tasks: [
              {
                id: 't1',
                title: 'Finish Planner API',
                status: 'in_progress',
                dueDate: '2026-11-30',
              },
            ],
          },
          {
            id: 'p2',
            title: 'Plan Overflow',
            status: 'active',
            tasks: [
              {
                id: 't2',
                title: longTaskTitle,
                status: 'todo',
                dueDate: null,
              },
            ],
          },
        ],
      })
      .build();

    const messages = service.buildMessages(ctx);

    expect(messages[0].content).toContain('## Active Plans & Tasks');
    expect(messages[0].content).toContain('Plan "Plan Alpha" [active]');
    expect(messages[0].content).toContain(
      '[in_progress] Finish Planner API (due: 2026-11-30)',
    );
    expect(messages[0].content).not.toContain('Plan Overflow');
  });
});
