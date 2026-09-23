import { Injectable } from '@nestjs/common';
import { MemoryRecord, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * Tham số lọc ở tầng domain — service truyền giá trị đã validate,
 * repository chịu trách nhiệm dịch sang câu truy vấn Prisma.
 */
export interface FindMemoriesParams {
  scope?: string;
  category?: string;
  /** Tìm tương đối (case-insensitive) trên cả `key` và `value`. */
  search?: string;
  /** Lọc theo phiên nguồn (truy vết provenance). */
  sourceAgentSessionId?: string;
  take?: number;
  skip?: number;
}

export interface FindRecallCandidatesParams {
  category?: string;
  scope?: string;
  /** Session hiện tại — lấy global + conversation của chính session này. */
  sessionId?: string;
  take?: number;
}

export interface CreateMemoryRecordData {
  key: string;
  value: string;
  category: string;
  scope: string;
  sourceAgentSessionId: string | null;
}

export interface UpdateMemoryRecordData {
  value?: string;
  category?: string;
  scope?: string;
  /**
   * undefined = giữ nguyên, null = gỡ liên kết provenance,
   * string = gán sang session khác.
   */
  sourceAgentSessionId?: string | null;
}

/**
 * MemoryRepository — điểm duy nhất trong module Memory được phép
 * tương tác với database (qua PrismaService).
 *
 * Quy ước tầng (Clean Architecture / Modular Monolith):
 * Controller -> Service (business logic, validation) -> Repository (DB).
 * Service KHÔNG inject PrismaService và KHÔNG import kiểu truy vấn Prisma.
 */
@Injectable()
export class MemoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: CreateMemoryRecordData): Promise<MemoryRecord> {
    return this.prisma.memoryRecord.create({
      data: {
        key: data.key,
        value: data.value,
        category: data.category,
        scope: data.scope,
        sourceAgentSessionId: data.sourceAgentSessionId,
      },
    });
  }

  findById(id: string): Promise<MemoryRecord | null> {
    return this.prisma.memoryRecord.findUnique({ where: { id } });
  }

  findByKey(key: string): Promise<MemoryRecord | null> {
    return this.prisma.memoryRecord.findUnique({ where: { key } });
  }

  async findManyAndCount(
    params: FindMemoriesParams,
  ): Promise<{ records: MemoryRecord[]; total: number }> {
    const where = this.buildListWhereClause(params);
    const [records, total] = await Promise.all([
      this.prisma.memoryRecord.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: params.take,
        skip: params.skip,
      }),
      this.prisma.memoryRecord.count({ where }),
    ]);
    return { records, total };
  }

  /**
   * Lấy ứng viên cho truy hồi liên quan (recall): giới hạn số lượng,
   * sắp xếp mới nhất trước — việc chấm điểm relevance do Service thực hiện.
   */
  findRecallCandidates(
    params: FindRecallCandidatesParams,
  ): Promise<MemoryRecord[]> {
    return this.prisma.memoryRecord.findMany({
      where: this.buildRecallWhereClause(params),
      orderBy: { updatedAt: 'desc' },
      take: params.take,
    });
  }

  update(id: string, data: UpdateMemoryRecordData): Promise<MemoryRecord> {
    const prismaData: Prisma.MemoryRecordUpdateInput = {};
    if (data.value !== undefined) prismaData.value = data.value;
    if (data.category !== undefined) prismaData.category = data.category;
    if (data.scope !== undefined) prismaData.scope = data.scope;
    if (data.sourceAgentSessionId !== undefined) {
      prismaData.sourceAgentSession =
        data.sourceAgentSessionId === null
          ? { disconnect: true }
          : { connect: { id: data.sourceAgentSessionId } };
    }
    return this.prisma.memoryRecord.update({ where: { id }, data: prismaData });
  }

  deleteById(id: string): Promise<MemoryRecord> {
    return this.prisma.memoryRecord.delete({ where: { id } });
  }

  async agentSessionExists(id: string): Promise<boolean> {
    const session = await this.prisma.agentSession.findUnique({
      where: { id },
      select: { id: true },
    });
    return session !== null;
  }

  // ---------------------------------------------------------- Builders --

  private buildListWhereClause(
    params: FindMemoriesParams,
  ): Prisma.MemoryRecordWhereInput {
    const where: Prisma.MemoryRecordWhereInput = {};
    if (params.scope !== undefined) where.scope = params.scope;
    if (params.category !== undefined) where.category = params.category;
    if (params.sourceAgentSessionId !== undefined) {
      where.sourceAgentSessionId = params.sourceAgentSessionId;
    }
    const search = params.search?.trim();
    if (search) {
      where.OR = [
        { key: { contains: search, mode: 'insensitive' } },
        { value: { contains: search, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  /**
   * Điều kiện truy hồi: khi có sessionId và không ép scope cụ thể,
   * chỉ lấy ký ức global + ký ức conversation thuộc về session hiện tại
   * để tránh rò rỉ ngữ cảnh chéo giữa các phiên.
   */
  private buildRecallWhereClause(
    params: FindRecallCandidatesParams,
  ): Prisma.MemoryRecordWhereInput {
    const where: Prisma.MemoryRecordWhereInput = {};
    if (params.category !== undefined) where.category = params.category;
    if (params.scope !== undefined) {
      where.scope = params.scope;
      if (params.scope === 'conversation' && params.sessionId) {
        where.sourceAgentSessionId = params.sessionId;
      }
      return where;
    }
    if (params.sessionId) {
      where.OR = [
        { scope: 'global' },
        { scope: 'conversation', sourceAgentSessionId: params.sessionId },
      ];
    }
    return where;
  }
}
