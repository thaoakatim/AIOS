import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MemoryRecord, Prisma } from '@prisma/client';
import { AgentExecutionContext } from '../../core/context/agent-context.interface';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { CreateMemoryDto } from './dto/create-memory.dto';
import { QueryMemoryDto, RelevantMemoryQueryDto } from './dto/query-memory.dto';
import { UpdateMemoryDto } from './dto/update-memory.dto';
import { Memory, MemoryListResult } from './entities/memory.entity';

/** Danh mục & phạm vi hợp lệ — đồng bộ với Prisma schema + shared-types. */
export const MEMORY_CATEGORIES = ['profile', 'preference', 'fact'] as const;
export const MEMORY_SCOPES = ['global', 'conversation'] as const;

const DEFAULT_SCOPE = 'global';
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;
const DEFAULT_RELEVANT_LIMIT = 20;
const MAX_RECALL_CANDIDATES = 200;

export interface GetRelevantMemoryOptions {
  limit?: number;
  scope?: string;
  category?: string;
  sessionId?: string;
}

/**
 * MemoryService — CRUD ký ức dài hạn + truy hồi liên quan cho Agent.
 *
 * - Lưu trữ: PostgreSQL qua Prisma (`memory_records`), key duy nhất toàn cục.
 * - Provenance: `sourceAgentSessionId` nullable, trỏ tới `agent_sessions`
 *   (null khi user tạo tay qua Dashboard).
 * - `getRelevantMemory(ctx)` là điểm tích hợp chính cho Task 2.3 (Chat Context
 *   Builder): trả về records để merge vào `AgentExecutionContext.context.userProfile`.
 */
@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------- CRUD --

  async create(dto: CreateMemoryDto): Promise<Memory> {
    const key = this.normalizeKey(dto.key);
    const value = this.normalizeValue(dto.value);
    const category = this.normalizeCategory(dto.category);
    const scope = this.normalizeScope(dto.scope ?? DEFAULT_SCOPE);
    const sourceAgentSessionId = await this.resolveSourceSession(
      dto.sourceAgentSessionId,
    );

    const existing = await this.prisma.memoryRecord.findUnique({
      where: { key },
    });
    if (existing) {
      throw new ConflictException(
        `Memory với key "${key}" đã tồn tại. Dùng PATCH /memory/${existing.id} hoặc POST /memory/upsert để cập nhật.`,
      );
    }

    const created = await this.prisma.memoryRecord.create({
      data: { key, value, category, scope, sourceAgentSessionId },
    });
    this.logger.log(`Tạo memory mới: key="${key}" category="${category}"`);
    return Memory.fromPrisma(created);
  }

  /**
   * Upsert theo `key` — API "ghi nhớ"幂等 cho Agent tự học:
   * key chưa có thì tạo mới, đã có thì cập nhật value/category/scope/source.
   */
  async upsert(
    dto: CreateMemoryDto,
  ): Promise<{ data: Memory; created: boolean }> {
    const key = this.normalizeKey(dto.key);
    const existing = await this.prisma.memoryRecord.findUnique({
      where: { key },
    });
    if (!existing) {
      const created = await this.create(dto);
      return { data: created, created: true };
    }
    const updated = await this.update(existing.id, {
      value: dto.value,
      category: dto.category,
      scope: dto.scope ?? undefined,
      sourceAgentSessionId: dto.sourceAgentSessionId,
    });
    return { data: updated, created: false };
  }

  async findAll(filter: QueryMemoryDto = {}): Promise<MemoryListResult> {
    const where = this.buildWhereClause(filter);
    const { limit, offset } = this.normalizePagination(
      filter.limit,
      filter.offset,
    );

    const [records, total] = await Promise.all([
      this.prisma.memoryRecord.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.memoryRecord.count({ where }),
    ]);

    return { data: Memory.fromPrismaMany(records), total };
  }

  async findOne(id: string): Promise<Memory> {
    this.assertUuid(id, 'id');
    const record = await this.prisma.memoryRecord.findUnique({
      where: { id },
    });
    if (!record) {
      throw new NotFoundException(`Không tìm thấy memory với id "${id}".`);
    }
    return Memory.fromPrisma(record);
  }

  async findByKey(key: string): Promise<Memory> {
    const normalized = this.normalizeKey(key);
    const record = await this.prisma.memoryRecord.findUnique({
      where: { key: normalized },
    });
    if (!record) {
      throw new NotFoundException(
        `Không tìm thấy memory với key "${normalized}".`,
      );
    }
    return Memory.fromPrisma(record);
  }

  async update(id: string, dto: UpdateMemoryDto): Promise<Memory> {
    this.assertUuid(id, 'id');
    const existing = await this.prisma.memoryRecord.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Không tìm thấy memory với id "${id}".`);
    }

    const data: Prisma.MemoryRecordUpdateInput = {};
    if (dto.value !== undefined) data.value = this.normalizeValue(dto.value);
    if (dto.category !== undefined)
      data.category = this.normalizeCategory(dto.category);
    if (dto.scope !== undefined) data.scope = this.normalizeScope(dto.scope);
    if (dto.sourceAgentSessionId !== undefined) {
      const resolved = await this.resolveSourceSession(
        dto.sourceAgentSessionId,
      );
      data.sourceAgentSession =
        resolved === null
          ? { disconnect: true }
          : { connect: { id: resolved } };
    }

    if (Object.keys(data).length === 0) {
      return Memory.fromPrisma(existing);
    }

    const updated = await this.prisma.memoryRecord.update({
      where: { id },
      data,
    });
    return Memory.fromPrisma(updated);
  }

  async remove(id: string): Promise<Memory> {
    this.assertUuid(id, 'id');
    const existing = await this.prisma.memoryRecord.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Không tìm thấy memory với id "${id}".`);
    }
    const deleted = await this.prisma.memoryRecord.delete({
      where: { id },
    });
    this.logger.log(`Xóa memory: key="${deleted.key}" id="${id}"`);
    return Memory.fromPrisma(deleted);
  }

  // --------------------------------------- Truy hồi liên quan (Recall) --

  /**
   * Truy hồi ký ức liên quan tới một câu truy vấn bằng chấm điểm
   * trùng khớp từ khóa (token overlap) trên `key + value + category`.
   * Nhẹ, không phụ thuộc vector DB — đủ cho Phase 3 trước khi có embedding.
   */
  async recall(
    query: string,
    options: GetRelevantMemoryOptions = {},
  ): Promise<Memory[]> {
    const limit = this.normalizeRelevantLimit(options.limit);
    const where = this.buildRecallWhereClause(options);

    const candidates = await this.prisma.memoryRecord.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: MAX_RECALL_CANDIDATES,
    });

    const trimmed = (query ?? '').trim();
    if (!trimmed) {
      return Memory.fromPrismaMany(candidates.slice(0, limit));
    }

    const scored = candidates
      .map((record) => ({
        record,
        score: this.scoreRelevance(trimmed, record),
      }))
      // Giữ lại bản ghi có ít nhất 1 từ khóa trùng, hoặc category trùng tên.
      .filter(({ score }) => score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.record.updatedAt.getTime() - a.record.updatedAt.getTime();
      })
      .slice(0, limit)
      .map(({ record }) => record);

    // Fallback: query quá mới lạ, không trùng từ khóa nào — trả về
    // ký ức mới nhất để agent vẫn có bối cảnh cá nhân hóa.
    const result =
      scored.length > 0 ? scored : candidates.slice(0, Math.min(limit, 5));
    return Memory.fromPrismaMany(result);
  }

  /**
   * Điểm tích hợp chính cho Chat Module (Task 2.3) và Agent ReAct Engine.
   * Nhận `AgentExecutionContext` (hoặc query string + options) và trả về
   * các MemoryRecord liên quan nhất để inject vào `context.userProfile`.
   *
   * @example
   * const memories = await memoryService.getRelevantMemory(ctx);
   * const enriched = memoryService.enrichContext(ctx, memories);
   */
  async getRelevantMemory(
    ctxOrQuery: AgentExecutionContext | string,
    options: GetRelevantMemoryOptions = {},
  ): Promise<Memory[]> {
    if (typeof ctxOrQuery === 'string') {
      return this.recall(ctxOrQuery, options);
    }
    const merged: GetRelevantMemoryOptions = {
      sessionId: ctxOrQuery.sessionId ?? options.sessionId,
      scope: options.scope,
      category: options.category,
      limit: options.limit,
    };
    return this.recall(ctxOrQuery.query ?? '', merged);
  }

  /** DTO tiện lợi cho `GET /memory/relevant` (query params). */
  async getRelevantMemoryByQuery(
    queryDto: RelevantMemoryQueryDto,
  ): Promise<Memory[]> {
    return this.recall(queryDto.query ?? '', {
      sessionId: queryDto.sessionId,
      scope: queryDto.scope,
      category: queryDto.category,
      limit: queryDto.limit,
    });
  }

  // --------------------------------- Inject vào AgentExecutionContext --

  /**
   * Chuyển records thành `userProfile` map (key -> value) để nạp vào
   * `AgentExecutionContext.context.userProfile`.
   */
  buildUserProfile(records: Memory[]): Record<string, unknown> {
    const profile: Record<string, unknown> = {};
    for (const record of records) {
      profile[record.key] = record.value;
    }
    return profile;
  }

  /**
   * Render records thành đoạn prompt cho System Prompt / Context Builder.
   * Chat Module (Task 2.3) ghép chuỗi này vào prompt gửi LLM.
   */
  formatMemoryForPrompt(records: Memory[]): string {
    if (records.length === 0) return '';
    const lines = records.map(
      (record) => `- (${record.category}) ${record.key}: ${record.value}`,
    );
    return `## Long-term Memory\n${lines.join('\n')}`;
  }

  /**
   * Trả về context MỚI (immutable copy) đã merge userProfile từ memory.
   * Không mutate `ctx` gốc — tuân thủ AgentExecutionContext readonly.
   */
  enrichContext(
    ctx: AgentExecutionContext,
    records: Memory[],
  ): AgentExecutionContext {
    const memoryProfile = this.buildUserProfile(records);
    return {
      ...ctx,
      context: {
        ...ctx.context,
        userProfile: {
          ...ctx.context.userProfile,
          ...memoryProfile,
        },
      },
    };
  }

  /**
   * Pipeline 1 bước cho Chat Context Builder: truy hồi + enrich.
   * Trả về cả context mới và records đã dùng (để log/trace).
   */
  async injectIntoContext(
    ctx: AgentExecutionContext,
    options: GetRelevantMemoryOptions = {},
  ): Promise<{ context: AgentExecutionContext; memories: Memory[] }> {
    const memories = await this.getRelevantMemory(ctx, options);
    return { context: this.enrichContext(ctx, memories), memories };
  }

  // ---------------------------------------------------------- Helpers --

  private buildWhereClause(
    filter: QueryMemoryDto,
  ): Prisma.MemoryRecordWhereInput {
    const where: Prisma.MemoryRecordWhereInput = {};
    if (filter.scope !== undefined) {
      where.scope = this.normalizeScope(filter.scope);
    }
    if (filter.category !== undefined) {
      where.category = this.normalizeCategory(filter.category);
    }
    if (filter.sourceAgentSessionId !== undefined) {
      this.assertUuid(filter.sourceAgentSessionId, 'sourceAgentSessionId');
      where.sourceAgentSessionId = filter.sourceAgentSessionId;
    }
    const search = filter.search?.trim();
    if (search) {
      where.OR = [
        { key: { contains: search, mode: 'insensitive' } },
        { value: { contains: search, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  /**
   * Điều kiện truy hồi: ưu tiên ký ức global + ký ức conversation
   * thuộc về session hiện tại. Ký ức conversation của session khác
   * bị loại để tránh rò rỉ ngữ cảnh chéo.
   */
  private buildRecallWhereClause(
    options: GetRelevantMemoryOptions,
  ): Prisma.MemoryRecordWhereInput {
    const where: Prisma.MemoryRecordWhereInput = {};
    if (options.category !== undefined) {
      where.category = this.normalizeCategory(options.category);
    }
    if (options.scope !== undefined) {
      const scope = this.normalizeScope(options.scope);
      where.scope = scope;
      if (scope === 'conversation' && options.sessionId) {
        this.assertUuid(options.sessionId, 'sessionId');
        where.sourceAgentSessionId = options.sessionId;
      }
      return where;
    }
    if (options.sessionId) {
      this.assertUuid(options.sessionId, 'sessionId');
      where.OR = [
        { scope: DEFAULT_SCOPE },
        {
          scope: 'conversation',
          sourceAgentSessionId: options.sessionId,
        },
      ];
      return where;
    }
    return where;
  }

  /** Chấm điểm trùng khớp từ khóa: key khớp nặng hơn value, category nhẹ. */
  private scoreRelevance(query: string, record: MemoryRecord): number {
    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) return 0;
    const keyTokens = new Set(this.tokenize(record.key));
    const valueTokens = new Set(this.tokenize(record.value));
    const categoryToken = record.category.toLowerCase();

    let score = 0;
    for (const token of queryTokens) {
      if (keyTokens.has(token)) score += 3;
      if (valueTokens.has(token)) score += 1;
      if (categoryToken === token) score += 1;
      // Khớp tiền tố (vd: query "lập trình" khớp value chứa "lập trình viên").
      if (!keyTokens.has(token) && !valueTokens.has(token)) {
        for (const vt of valueTokens) {
          if (vt.startsWith(token) || token.startsWith(vt)) {
            score += 0.5;
            break;
          }
        }
      }
    }
    // Ưu tiên nhẹ ký ức global (dùng chung mọi phiên).
    if (record.scope === DEFAULT_SCOPE) score += 0.1;
    return score;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[\s,;:.!?()[\]{}"'“”‘’/\\|<>@#%^&*+=~`\-_]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
  }

  private normalizeKey(key: unknown): string {
    if (typeof key !== 'string' || !key.trim()) {
      throw new BadRequestException(
        'Trường "key" là bắt buộc và không được rỗng.',
      );
    }
    return key.trim();
  }

  private normalizeValue(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(
        'Trường "value" là bắt buộc và không được rỗng.',
      );
    }
    return value.trim();
  }

  private normalizeCategory(category: unknown): string {
    if (typeof category !== 'string') {
      throw new BadRequestException(
        `Trường "category" phải là một trong: ${MEMORY_CATEGORIES.join(', ')}.`,
      );
    }
    const normalized = category.trim().toLowerCase();
    if (!(MEMORY_CATEGORIES as readonly string[]).includes(normalized)) {
      throw new BadRequestException(
        `Category "${category}" không hợp lệ. Cho phép: ${MEMORY_CATEGORIES.join(', ')}.`,
      );
    }
    return normalized;
  }

  private normalizeScope(scope: unknown): string {
    if (typeof scope !== 'string') {
      throw new BadRequestException(
        `Trường "scope" phải là một trong: ${MEMORY_SCOPES.join(', ')}.`,
      );
    }
    const normalized = scope.trim().toLowerCase();
    if (!(MEMORY_SCOPES as readonly string[]).includes(normalized)) {
      throw new BadRequestException(
        `Scope "${scope}" không hợp lệ. Cho phép: ${MEMORY_SCOPES.join(', ')}.`,
      );
    }
    return normalized;
  }

  private normalizePagination(
    limit?: number,
    offset?: number,
  ): { limit: number; offset: number } {
    const parsedLimit = Number(limit);
    const parsedOffset = Number(offset);
    return {
      limit: Number.isFinite(parsedLimit)
        ? Math.min(Math.max(Math.floor(parsedLimit), 1), MAX_LIST_LIMIT)
        : DEFAULT_LIST_LIMIT,
      offset:
        Number.isFinite(parsedOffset) && parsedOffset >= 0
          ? Math.floor(parsedOffset)
          : 0,
    };
  }

  private normalizeRelevantLimit(limit?: number): number {
    const parsed = Number(limit);
    if (!Number.isFinite(parsed)) return DEFAULT_RELEVANT_LIMIT;
    return Math.min(Math.max(Math.floor(parsed), 1), MAX_LIST_LIMIT);
  }

  /**
   * Chuẩn hóa provenance: null/undefined/""/"null" -> null (tạo tay);
   * ngược lại phải là UUID của AgentSession đã tồn tại.
   */
  private async resolveSourceSession(
    sourceAgentSessionId: string | null | undefined,
  ): Promise<string | null> {
    if (
      sourceAgentSessionId === undefined ||
      sourceAgentSessionId === null ||
      (typeof sourceAgentSessionId === 'string' &&
        ['', 'null', 'undefined'].includes(sourceAgentSessionId.trim()))
    ) {
      return null;
    }
    if (typeof sourceAgentSessionId !== 'string') {
      throw new BadRequestException(
        'Trường "sourceAgentSessionId" phải là UUID hoặc null.',
      );
    }
    const normalized = sourceAgentSessionId.trim();
    this.assertUuid(normalized, 'sourceAgentSessionId');
    const session = await this.prisma.agentSession.findUnique({
      where: { id: normalized },
      select: { id: true },
    });
    if (!session) {
      throw new NotFoundException(
        `Không tìm thấy AgentSession với id "${normalized}" (provenance).`,
      );
    }
    return normalized;
  }

  private assertUuid(value: string, field: string): void {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(value)) {
      throw new BadRequestException(
        `Trường "${field}" phải là UUID hợp lệ. Nhận được: "${value}".`,
      );
    }
  }
}
