import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IVectorStore } from './vector-store.interface';
import { QdrantAdapter } from './qdrant.adapter';
import { PgVectorAdapter } from './pgvector.adapter';
import { PrismaService } from '../database/prisma.service';

export enum VectorStoreProvider {
  QDRANT = 'qdrant',
  PGVECTOR = 'pgvector',
}

@Injectable()
export class VectorStoreFactory {
  private readonly qdrantAdapter: QdrantAdapter;
  private readonly pgVectorAdapter: PgVectorAdapter;

  constructor(
    private readonly config: ConfigService,
    qdrantAdapter: QdrantAdapter,
    pgVectorAdapter: PgVectorAdapter,
  ) {
    this.qdrantAdapter = qdrantAdapter;
    this.pgVectorAdapter = pgVectorAdapter;
  }

  createStore(): IVectorStore {
    const provider =
      (this.config.get('VECTOR_STORE_PROVIDER') as VectorStoreProvider) ||
      VectorStoreProvider.QDRANT;

    switch (provider) {
      case VectorStoreProvider.QDRANT:
        return this.qdrantAdapter;
      case VectorStoreProvider.PGVECTOR:
        return this.pgVectorAdapter;
      default:
        throw new Error(`Unsupported vector store provider: ${provider}`);
    }
  }
}
