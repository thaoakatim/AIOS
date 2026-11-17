import { DocumentChunk, Message } from '@prisma/client';
import { AgentExecutionContext } from './agent-context.interface';
import { ToolDefinition } from '../tools/tool.interface';

/**
 * ContextBuilder — Builder pattern giúp khởi tạo và làm giàu AgentExecutionContext
 * theo nguyên tắc bất biến (Immutable Pipeline).
 *
 * Cho phép tạo mới hoặc clone từ context có sẵn (`ContextBuilder.from(ctx)`)
 * để thêm RAG chunks, memory profile, rules,... mà không làm biến dị context gốc.
 */
export class ContextBuilder {
  private executionId = '';
  private userId = '';
  private sessionId = '';
  private query = '';
  private userProfile: Record<string, unknown> = {};
  private systemRules: string[] = [];
  private activePlans?: Record<string, unknown>;
  private ragChunks?: DocumentChunk[];
  private recentMessages?: Message[];
  private availableTools: ToolDefinition[] = [];
  private metadata: Record<string, unknown> = {};

  constructor(base?: AgentExecutionContext) {
    if (base) {
      this.executionId = base.executionId;
      this.userId = base.userId;
      this.sessionId = base.sessionId;
      this.query = base.query;
      this.userProfile = { ...base.context.userProfile };
      this.systemRules = [...base.context.systemRules];
      this.activePlans = base.context.activePlans
        ? { ...base.context.activePlans }
        : undefined;
      this.ragChunks = base.prefetch?.ragChunks
        ? [...base.prefetch.ragChunks]
        : undefined;
      this.recentMessages = base.prefetch?.recentMessages
        ? [...base.prefetch.recentMessages]
        : undefined;
      this.availableTools = [...base.availableTools];
      this.metadata = { ...base.metadata };
    }
  }

  /** Khởi tạo Builder từ một context hiện có để bổ sung dữ liệu mới. */
  static from(ctx: AgentExecutionContext): ContextBuilder {
    return new ContextBuilder(ctx);
  }

  setExecutionId(executionId: string): this {
    this.executionId = executionId;
    return this;
  }

  setUserId(userId: string): this {
    this.userId = userId;
    return this;
  }

  setSessionId(sessionId: string): this {
    this.sessionId = sessionId;
    return this;
  }

  setQuery(query: string): this {
    this.query = query;
    return this;
  }

  setUserProfile(profile: Record<string, unknown>): this {
    this.userProfile = { ...profile };
    return this;
  }

  mergeUserProfile(profile: Record<string, unknown>): this {
    this.userProfile = { ...this.userProfile, ...profile };
    return this;
  }

  addSystemRule(rule: string): this {
    this.systemRules.push(rule);
    return this;
  }

  setSystemRules(rules: string[]): this {
    this.systemRules = [...rules];
    return this;
  }

  setActivePlans(plans: Record<string, unknown>): this {
    this.activePlans = { ...plans };
    return this;
  }

  setRagChunks(chunks: DocumentChunk[]): this {
    this.ragChunks = [...chunks];
    return this;
  }

  addRagChunks(chunks: DocumentChunk[]): this {
    this.ragChunks = [...(this.ragChunks || []), ...chunks];
    return this;
  }

  setRecentMessages(messages: Message[]): this {
    this.recentMessages = [...messages];
    return this;
  }

  addRecentMessage(message: Message): this {
    this.recentMessages = [...(this.recentMessages || []), message];
    return this;
  }

  setAvailableTools(tools: ToolDefinition[]): this {
    this.availableTools = [...tools];
    return this;
  }

  addAvailableTool(tool: ToolDefinition): this {
    this.availableTools.push(tool);
    return this;
  }

  setMetadata(metadata: Record<string, unknown>): this {
    this.metadata = { ...metadata };
    return this;
  }

  mergeMetadata(metadata: Record<string, unknown>): this {
    this.metadata = { ...this.metadata, ...metadata };
    return this;
  }

  build(): AgentExecutionContext {
    if (!this.userId) {
      throw new Error('ContextBuilder: userId là bắt buộc (Data Ownership).');
    }

    const prefetch =
      this.ragChunks !== undefined || this.recentMessages !== undefined
        ? Object.freeze({
            ragChunks: this.ragChunks ? [...this.ragChunks] : undefined,
            recentMessages: this.recentMessages
              ? [...this.recentMessages]
              : undefined,
          })
        : undefined;

    return Object.freeze({
      executionId: this.executionId,
      userId: this.userId,
      sessionId: this.sessionId,
      query: this.query,
      context: Object.freeze({
        userProfile: Object.freeze({ ...this.userProfile }),
        systemRules: [...this.systemRules],
        activePlans: this.activePlans
          ? Object.freeze({ ...this.activePlans })
          : undefined,
      }),
      prefetch,
      availableTools: [...this.availableTools],
      metadata: Object.freeze({ ...this.metadata }),
    });
  }
}
