import { Injectable } from '@nestjs/common';
import { Document, DocumentChunk, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/** Tham số lọc danh sách tài liệu — service truyền giá trị đã validate. */
export interface FindDocumentsParams {
  status?: string;
  fileType?: string;
  /** Tìm tương đối (case-insensitive) trên `title`. */
  search?: string;
  take?: number;
  skip?: number;
}

/** Chunk sắp lưu — `embedding` do IVectorStore ghi, không qua Prisma. */
export interface CreateChunkData {
  id: string;
  documentId: string;
  content: string;
  metadata: Prisma.InputJsonValue;
}

export interface LinkDocumentsParams {
  messageId: string;
  documentIds: string[];
}

/**
 * KnowledgeRepository — điểm duy nhất trong module Knowledge được phép
 * tương tác với database (qua PrismaService).
 *
 * Quy ước tầng (Clean Architecture / Modular Monolith):
 * Controller -> Service (business logic, validation) -> Repository (DB).
 * Service KHÔNG inject PrismaService và KHÔNG import kiểu truy vấn Prisma.
 *
 * Ba bảng phục vụ RAG:
 * - `documents`        : metadata tài liệu gốc
 * - `document_chunks`  : nội dung chunk (vector nằm ở đây khi dùng pgvector)
 * - `message_documents`: bảng nối M:N giữa Message và Document (Task 2.2)
 */
@Injectable()
export class KnowledgeRepository {
  constructor(private readonly prisma: PrismaService) {}

  // --------------------------------------------------------- Document --

  createDocument(data: {
    title: string;
    fileType: string | null;
    sourceUrl: string | null;
    status: string;
  }): Promise<Document> {
    return this.prisma.document.create({
      data: {
        title: data.title,
        fileType: data.fileType,
        sourceUrl: data.sourceUrl,
        status: data.status,
      },
    });
  }

  findDocumentById(
    id: string,
  ): Promise<(Document & { _count: { chunks: number } }) | null> {
    return this.prisma.document.findUnique({
      where: { id },
      include: { _count: { select: { chunks: true } } },
    });
  }

  async findDocumentsAndCount(params: FindDocumentsParams): Promise<{
    records: Array<Document & { _count: { chunks: number } }>;
    total: number;
  }> {
    const where = this.buildDocumentWhereClause(params);
    const [records, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: params.take,
        skip: params.skip,
        include: { _count: { select: { chunks: true } } },
      }),
      this.prisma.document.count({ where }),
    ]);
    return { records, total };
  }

  updateDocument(
    id: string,
    data: { title?: string; status?: string },
  ): Promise<Document> {
    const prismaData: Prisma.DocumentUpdateInput = {};
    if (data.title !== undefined) prismaData.title = data.title;
    if (data.status !== undefined) prismaData.status = data.status;
    return this.prisma.document.update({ where: { id }, data: prismaData });
  }

  deleteDocument(id: string): Promise<Document> {
    return this.prisma.document.delete({ where: { id } });
  }

  /** Đếm tài liệu theo trạng thái — dùng cho Dashboard/Health check. */
  async countDocumentsByStatus(): Promise<Record<string, number>> {
    const grouped = await this.prisma.document.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    return grouped.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = row._count._all;
      return acc;
    }, {});
  }

  // ---------------------------------------------------- DocumentChunk --

  /**
   * Ghi hàng loạt chunk cho một tài liệu (ghi đè chunk cũ).
   *
   * `embedding` là kiểu pgvector `Unsupported` nên Prisma không sinh field cho
   * nó — vector được `IVectorStore` ghi sau (PgVectorAdapter dùng
   * `INSERT ... ON CONFLICT DO UPDATE` trên chính bảng này).
   */
  async replaceChunks(
    documentId: string,
    chunks: CreateChunkData[],
  ): Promise<DocumentChunk[]> {
    await this.prisma.documentChunk.deleteMany({ where: { documentId } });
    if (chunks.length === 0) return [];
    return this.prisma.documentChunk
      .createMany({
        data: chunks.map((chunk) => ({
          id: chunk.id,
          documentId: chunk.documentId,
          content: chunk.content,
          metadata: chunk.metadata,
        })),
        // Prisma trả về bản ghi vừa tạo -> giữ luôn id để gắn vector.
        // (createMany không hỗ trợ `include`, nên đọc lại theo id.)
      })
      .then(() =>
        this.prisma.documentChunk.findMany({
          where: { id: { in: chunks.map((chunk) => chunk.id) } },
          orderBy: { id: 'asc' },
        }),
      );
  }

  findChunksByDocumentId(documentId: string): Promise<DocumentChunk[]> {
    return this.prisma.documentChunk.findMany({
      where: { documentId },
      orderBy: { id: 'asc' },
    });
  }

  /** Chunk của nhiều tài liệu — dùng để hydrate kết quả vector search. */
  findChunksByIds(ids: string[]): Promise<DocumentChunk[]> {
    return this.prisma.documentChunk.findMany({
      where: { id: { in: ids } },
    });
  }

  countChunks(documentId: string): Promise<number> {
    return this.prisma.documentChunk.count({ where: { documentId } });
  }

  findDocumentsByIds(ids: string[]): Promise<Document[]> {
    return this.prisma.document.findMany({ where: { id: { in: ids } } });
  }

  // --------------------------------------------------- MessageDocument --

  /**
   * Gắn nhiều tài liệu vào một Message (bảng nối M:N).
   * Dùng `skipDuplicates` để thao tác idempotent — gọi lại nhiều lần vẫn
   * không sinh lỗi trùng khóa chính `@@id([messageId, documentId])`.
   */
  linkDocumentsToMessage(params: LinkDocumentsParams): Promise<{
    count: number;
  }> {
    if (params.documentIds.length === 0) {
      return Promise.resolve({ count: 0 });
    }
    return this.prisma.messageDocument.createMany({
      data: params.documentIds.map((documentId) => ({
        messageId: params.messageId,
        documentId,
      })),
      skipDuplicates: true,
    });
  }

  unlinkDocumentFromMessage(
    messageId: string,
    documentId: string,
  ): Promise<{ count: number }> {
    return this.prisma.messageDocument.deleteMany({
      where: { messageId, documentId },
    });
  }

  listDocumentsForMessage(
    messageId: string,
  ): Promise<Array<Document & { _count: { chunks: number } }>> {
    return this.prisma.document.findMany({
      where: { messageDocuments: { some: { messageId } } },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { chunks: true } } },
    });
  }

  listMessagesForDocument(documentId: string): Promise<string[]> {
    return this.prisma.messageDocument
      .findMany({
        where: { documentId },
        select: { messageId: true },
      })
      .then((rows) => rows.map((row) => row.messageId));
  }

  /** Kiểm tra Message có tồn tại — dùng để validate M:N trước khi insert. */
  async messageExists(messageId: string): Promise<boolean> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true },
    });
    return message !== null;
  }

  /** Trả về các id tài liệu đã gắn với message (dùng để validate idempotency). */
  async existingLinkedDocumentIds(
    messageId: string,
    documentIds: string[],
  ): Promise<string[]> {
    if (documentIds.length === 0) return [];
    const rows = await this.prisma.messageDocument.findMany({
      where: { messageId, documentId: { in: documentIds } },
      select: { documentId: true },
    });
    return rows.map((row) => row.documentId);
  }

  // ---------------------------------------------------------- Builders --

  private buildDocumentWhereClause(
    params: FindDocumentsParams,
  ): Prisma.DocumentWhereInput {
    const where: Prisma.DocumentWhereInput = {};
    if (params.status !== undefined) where.status = params.status;
    if (params.fileType !== undefined) where.fileType = params.fileType;
    const search = params.search?.trim();
    if (search) {
      where.title = { contains: search, mode: 'insensitive' };
    }
    return where;
  }
}
