import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  IVectorStore,
  VectorPoint,
  SearchResult,
} from './vector-store.interface';

@Injectable()
export class PgVectorAdapter implements IVectorStore {
  private readonly logger = new Logger(PgVectorAdapter.name);

  constructor(private readonly prisma: PrismaService) {}

  async upsert(collectionName: string, points: VectorPoint[]): Promise<void> {
    try {
      for (const p of points) {
        await this.prisma.$executeRawUnsafe(
          `
          INSERT INTO "DocumentChunk" (id, "documentId", content, embedding, "chunkIndex", metadata, "createdAt", "updatedAt")
          VALUES ($1, $2, $3, $4::vector, $5, $6, NOW(), NOW())
          ON CONFLICT (id) DO UPDATE SET
            embedding = EXCLUDED.embedding,
            content = EXCLUDED.content,
            metadata = EXCLUDED.metadata,
            "updatedAt" = NOW()
        `,
          p.id,
          p.payload.documentId,
          p.payload.content,
          `[${p.vector.join(',')}]`,
          p.payload.chunkIndex,
          JSON.stringify(p.payload.metadata as any),
        );
      }
    } catch (error) {
      this.logger.error(
        `PgVector upsert failed for collection ${collectionName}:`,
        error,
      );
      throw error;
    }
  }

  async searchSimilarity(
    collectionName: string,
    vector: number[],
    limit: number,
    filter?: Record<string, unknown>,
  ): Promise<SearchResult[]> {
    try {
      const vectorLiteral = `[${vector.join(',')}]`;

      let whereClause = '';
      const params: any[] = [vectorLiteral, limit];

      if (filter?.documentId) {
        whereClause = 'AND "documentId" = $3';
        params.push(filter.documentId);
      }

      const results = await this.prisma.$queryRawUnsafe<
        Array<{
          id: string;
          content: string;
          documentId: string;
          chunkIndex: number;
          metadata: any;
          similarity: number;
        }>
      >(
        `
        SELECT 
          id,
          content,
          "documentId",
          "chunkIndex",
          metadata,
          1 - (embedding <=> $1::vector) as similarity
        FROM "DocumentChunk"
        WHERE 1=1 ${whereClause}
        ORDER BY embedding <=> $1::vector
        LIMIT $2
      `,
        ...params,
      );

      return results.map((r) => ({
        id: r.id,
        score: r.similarity,
        payload: {
          documentId: r.documentId,
          content: r.content,
          chunkIndex: r.chunkIndex,
          metadata: r.metadata,
        },
      }));
    } catch (error) {
      this.logger.error(
        `PgVector search failed for collection ${collectionName}:`,
        error,
      );
      throw error;
    }
  }

  async delete(collectionName: string, ids: string[]): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM "DocumentChunk" WHERE id = ANY($1)`,
        ids,
      );
    } catch (error) {
      this.logger.error(
        `PgVector delete failed for collection ${collectionName}:`,
        error,
      );
      throw error;
    }
  }

  async createCollection(
    collectionName: string,
    vectorSize: number,
  ): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(`
        CREATE EXTENSION IF NOT EXISTS vector;
      `);

      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "DocumentChunk" (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          "documentId" UUID NOT NULL REFERENCES "Document"(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
          embedding vector(${vectorSize}),
          "chunkIndex" INTEGER NOT NULL,
          metadata JSONB,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await this.prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_idx" 
        ON "DocumentChunk" USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100);
      `);

      this.logger.log(`PgVector collection (table) ready: ${collectionName}`);
    } catch (error) {
      this.logger.error(`PgVector create collection failed:`, error);
      throw error;
    }
  }

  async collectionExists(collectionName: string): Promise<boolean> {
    try {
      const result = await this.prisma.$queryRawUnsafe<{ exists: boolean }[]>(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'DocumentChunk'
        ) as exists`,
      );
      return result[0]?.exists ?? false;
    } catch {
      return false;
    }
  }

  async getCollectionInfo(
    collectionName: string,
  ): Promise<{ vectorsCount: number; pointsCount: number } | null> {
    try {
      const result = await this.prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*) as count FROM "DocumentChunk"`,
      );
      const count = Number(result[0]?.count || 0);
      return { vectorsCount: count, pointsCount: count };
    } catch {
      return null;
    }
  }
}
