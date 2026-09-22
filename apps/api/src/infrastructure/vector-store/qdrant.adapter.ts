import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/qdrant-js';
import {
  IVectorStore,
  VectorPoint,
  SearchResult,
} from './vector-store.interface';

@Injectable()
export class QdrantAdapter implements IVectorStore, OnModuleInit {
  private readonly client: QdrantClient;
  private readonly logger = new Logger(QdrantAdapter.name);

  constructor(private readonly config: ConfigService) {
    const url = this.config.get('QDRANT_URL') || 'http://localhost:6333';
    const apiKey = this.config.get('QDRANT_API_KEY') || undefined;

    this.client = new QdrantClient({ url, apiKey });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.getCollections();
      this.logger.log('✅ Kết nối Qdrant thành công');
    } catch (error) {
      this.logger.error('❌ Lỗi kết nối Qdrant:', error);
      throw error;
    }
  }

  async upsert(collectionName: string, points: VectorPoint[]): Promise<void> {
    try {
      await this.client.upsert(collectionName, {
        wait: true,
        points: points.map((p) => ({
          id: p.id,
          vector: p.vector,
          payload: p.payload,
        })),
      });
    } catch (error) {
      this.logger.error(
        `Qdrant upsert failed for collection ${collectionName}:`,
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
      const results = await this.client.query(collectionName, {
        query: vector,
        limit,
        filter: filter ? this.buildFilter(filter) : undefined,
        with_payload: true,
      });

      return results.points.map((r) => ({
        id: r.id.toString(),
        score: r.score,
        payload: r.payload || {},
      }));
    } catch (error) {
      this.logger.error(
        `Qdrant search failed for collection ${collectionName}:`,
        error,
      );
      throw error;
    }
  }

  async delete(collectionName: string, ids: string[]): Promise<void> {
    try {
      await this.client.delete(collectionName, {
        wait: true,
        points: ids,
      });
    } catch (error) {
      this.logger.error(
        `Qdrant delete failed for collection ${collectionName}:`,
        error,
      );
      throw error;
    }
  }

  async createCollection(
    collectionName: string,
    vectorSize: number,
    distance: 'cosine' | 'euclid' | 'dot' = 'cosine',
  ): Promise<void> {
    try {
      const exists = await this.collectionExists(collectionName);
      if (!exists) {
        await this.client.createCollection(collectionName, {
          vectors: { size: vectorSize, distance: this.mapDistance(distance) },
        });
        this.logger.log(`Created Qdrant collection: ${collectionName}`);
      }
    } catch (error) {
      this.logger.error(`Qdrant create collection failed:`, error);
      throw error;
    }
  }

  async collectionExists(collectionName: string): Promise<boolean> {
    try {
      const collections = await this.client.getCollections();
      return collections.collections.some((c) => c.name === collectionName);
    } catch {
      return false;
    }
  }

  async getCollectionInfo(
    collectionName: string,
  ): Promise<{ vectorsCount: number; pointsCount: number } | null> {
    try {
      const info = await this.client.getCollection(collectionName);
      return {
        vectorsCount: info.indexed_vectors_count || info.points_count || 0,
        pointsCount: info.points_count || 0,
      };
    } catch {
      return null;
    }
  }

  private mapDistance(
    distance: 'cosine' | 'euclid' | 'dot',
  ): 'Cosine' | 'Euclid' | 'Dot' {
    switch (distance) {
      case 'cosine':
        return 'Cosine';
      case 'euclid':
        return 'Euclid';
      case 'dot':
        return 'Dot';
    }
  }

  private buildFilter(filter: Record<string, unknown>): any {
    const conditions = Object.entries(filter).map(([key, value]) => ({
      key,
      match: { value },
    }));
    return { must: conditions };
  }
}
