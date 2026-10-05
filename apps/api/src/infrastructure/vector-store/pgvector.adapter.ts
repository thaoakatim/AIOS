import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  IVectorStore,
  VectorPoint,
  SearchResult,
} from './vector-store.interface';

/**
 * PgVectorAdapter — hiện thực `IVectorStore` trên chính bảng
 * `document_chunks` của PostgreSQL (đã khai báo trong Prisma schema /
 * migration với cột `embedding vector(768)`).
 *
 * Lưu ý quan trọng về quy ước dữ liệu:
 * - Bảng vật lý là `document_chunks` (do `@@map("document_chunks")` trong
 *   apps/api/prisma/schema.prisma quyết định), KHÔNG phải "DocumentChunk".
 * - Cột thực tế chỉ gồm: id, documentId, content, metadata, embedding.
 *   `chunkIndex` KHÔNG phải cột vật lý -> được lưu trong JSONB `metadata`
 *   (Knowledge Service luôn ghi `metadata.chunkIndex` khi tạo chunk).
 * - Vì adapter nằm trên cùng bảng với Prisma, `upsert` dùng
 *   `INSERT ... ON CONFLICT DO UPDATE`: chunk text được Knowledge Repository
 *   tạo trước, adapter chỉ ghi đè vector.
 */
@Injectable()
export class PgVectorAdapter implements IVectorStore {
  private readonly logger = new Logger(PgVectorAdapter.name);

  constructor(private readonly prisma: PrismaService) {}

  async upsert(collectionName: string, points: VectorPoint[]): Promise<void> {
    if (points.length === 0) return;
    // `payload` là `Record<string, unknown>` -> chuẩn hoá về string trước khi
    // đưa vào SQL, tránh ghi "[object Object]" vào cột TEXT/JSONB.
    const asText = (value: unknown): string =>
      typeof value === 'string' ? value : (JSON.stringify(value) ?? '');

    for (const point of points) {
      await this.prisma.$executeRawUnsafe(
        `
        INSERT INTO "document_chunks" ("id", "documentId", "content", "metadata", "embedding")
        VALUES ($1, $2, $3, $4::jsonb, $5::vector)
        ON CONFLICT ("id") DO UPDATE SET
          "embedding" = EXCLUDED."embedding",
          "content" = EXCLUDED."content",
          "metadata" = EXCLUDED."metadata"
      `,
        point.id,
        asText(point.payload.documentId ?? ''),
        asText(point.payload.content ?? ''),
        JSON.stringify(point.payload.metadata ?? {}),
        this.toVectorLiteral(point.vector),
      );
    }
    this.logger.debug(
      `PgVector upsert ${points.length} chunk vào ${collectionName}`,
    );
  }

  async searchSimilarity(
    collectionName: string,
    vector: number[],
    limit: number,
    filter?: Record<string, unknown>,
  ): Promise<SearchResult[]> {
    // Filter tùy chọn theo documentId (xem `IVectorStore.searchSimilarity`).
    const rawDocumentId = filter?.documentId;
    const documentId =
      typeof rawDocumentId === 'string' && rawDocumentId.length > 0
        ? rawDocumentId
        : null;

    const results = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        content: string;
        documentId: string;
        metadata: Record<string, unknown> | null;
        similarity: number;
      }>
    >(
      `
      SELECT
        "id",
        "content",
        "documentId",
        "metadata",
        1 - ("embedding" <=> $1::vector) AS similarity
      FROM "document_chunks"
      WHERE "embedding" IS NOT NULL
        AND ($2::uuid IS NULL OR "documentId" = $2::uuid)
      ORDER BY "embedding" <=> $1::vector
      LIMIT $3
    `,
      this.toVectorLiteral(vector),
      documentId,
      limit,
    );

    return results.map((row) => ({
      id: row.id,
      score: Number(row.similarity),
      payload: {
        documentId: row.documentId,
        content: row.content,
        metadata: row.metadata ?? {},
      },
    }));
  }

  async delete(collectionName: string, ids: string[]): Promise<void> {
    // `collectionName` không dùng: pgvector lưu chung một bảng cho toàn hệ thống.
    void collectionName;
    if (ids.length === 0) return;
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM "document_chunks" WHERE "id" = ANY($1::uuid[])`,
      ids,
    );
  }

  /**
   * pgvector đã được Prisma migration bật sẵn (`CREATE EXTENSION vector`).
   * Việc còn lại là tạo chỉ mục HNSW để phép tìm kiếm cosine nhanh khi
   * `document_chunks` lớn dần. HNSW được chọn thay vì IVFFlat vì không cần
   * dữ liệu huấn luyện sẵn (index rỗng vẫn tạo được).
   */
  async createCollection(
    collectionName: string,
    vectorSize: number,
  ): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `CREATE EXTENSION IF NOT EXISTS vector`,
    );
    await this.prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "document_chunks_embedding_hnsw_idx"
       ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops)`,
    );
    this.logger.log(
      `PgVector sẵn sàng: collection="${collectionName}" (vector(${vectorSize}), cosine)`,
    );
  }

  async collectionExists(collectionName: string): Promise<boolean> {
    void collectionName;
    const rows = await this.prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'document_chunks'
       ) AS exists`,
    );
    return rows[0]?.exists ?? false;
  }

  async getCollectionInfo(
    collectionName: string,
  ): Promise<{ vectorsCount: number; pointsCount: number } | null> {
    // `collectionName` không dùng: pgvector lưu chung một bảng cho toàn hệ thống.
    void collectionName;
    const rows = await this.prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*) AS count FROM "document_chunks" WHERE "embedding" IS NOT NULL`,
    );
    const count = Number(rows[0]?.count ?? 0);
    return { vectorsCount: count, pointsCount: count };
  }

  /** pgvector nhận literal dạng `[0.1,0.2,...]`. */
  private toVectorLiteral(vector: number[]): string {
    if (vector.length === 0) {
      throw new Error('Vector rỗng — không thể ghi vào pgvector.');
    }
    return `[${vector.join(',')}]`;
  }
}
