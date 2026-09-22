export interface VectorPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export interface SearchResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

export interface IVectorStore {
  /**
   * Upsert vectors into the store
   */
  upsert(collectionName: string, points: VectorPoint[]): Promise<void>;

  /**
   * Search for similar vectors
   */
  searchSimilarity(
    collectionName: string,
    vector: number[],
    limit: number,
    filter?: Record<string, unknown>,
  ): Promise<SearchResult[]>;

  /**
   * Delete vectors by IDs
   */
  delete(collectionName: string, ids: string[]): Promise<void>;

  /**
   * Create collection if not exists
   */
  createCollection(
    collectionName: string,
    vectorSize: number,
    distance?: 'cosine' | 'euclid' | 'dot',
  ): Promise<void>;

  /**
   * Check if collection exists
   */
  collectionExists(collectionName: string): Promise<boolean>;

  /**
   * Get collection info
   */
  getCollectionInfo(
    collectionName: string,
  ): Promise<{ vectorsCount: number; pointsCount: number } | null>;
}
