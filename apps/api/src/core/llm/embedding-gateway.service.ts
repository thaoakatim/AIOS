import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LLMProvider } from '../../infrastructure/llm-providers/llm-provider.enum';
import { EmbeddingClientFactory } from '../../infrastructure/embedding/embedding-client.factory';
import {
  IEmbeddingClient,
  EmbedBatchResult,
} from './interfaces/embedding.interface';

/**
 * EmbeddingGatewayService — cổng giao tiếp Embedding đa nhà cung cấp.
 *
 * Đối xứng với `LLMGatewayService` (sinh văn bản): đây là cổng cho
 * sinh VECTOR (Knowledge Module — RAG). Adapter provider được chọn qua
 * `EMBEDDING_PROVIDER`, có fallback về `LLM_PROVIDER` để không bắt người dùng
 * khai báo cả hai khi chỉ dùng một hạ tầng (ví dụ Ollama).
 *
 * Model mặc định theo provider — CHỌN CỐ Ý đều sinh 768 chiều để khớp cột
 * `embedding vector(768)` của bảng `document_chunks` (apps/api/prisma/schema.prisma):
 * - openai -> text-embedding-3-small (dùng tham số `dimensions=768`)
 * - gemini -> text-embedding-004 (768)
 * - ollama -> nomic-embed-text (768)
 */
export const DEFAULT_EMBEDDING_DIMENSIONS = 768;

export const DEFAULT_EMBEDDING_MODELS: Record<LLMProvider, string> = {
  [LLMProvider.OPENAI]: 'text-embedding-3-small',
  [LLMProvider.GEMINI]: 'text-embedding-004',
  [LLMProvider.OLLAMA]: 'nomic-embed-text',
};

/** Số văn bản gửi đi mỗi request — tránh vượt rate limit của provider. */
const DEFAULT_BATCH_SIZE = 32;

@Injectable()
export class EmbeddingGatewayService {
  private readonly client: IEmbeddingClient;
  private readonly provider: LLMProvider;
  private readonly batchSize: number;

  constructor(
    private readonly config: ConfigService,
    private readonly factory: EmbeddingClientFactory,
  ) {
    this.provider =
      (this.config.get<string>('EMBEDDING_PROVIDER') as LLMProvider) ||
      (this.config.get<string>('LLM_PROVIDER') as LLMProvider) ||
      LLMProvider.OLLAMA;

    const model =
      this.config.get<string>('EMBEDDING_MODEL') ||
      DEFAULT_EMBEDDING_MODELS[this.provider];

    const dimensions =
      Number(this.config.get<string>('EMBEDDING_DIMENSIONS')) ||
      DEFAULT_EMBEDDING_DIMENSIONS;

    this.batchSize = Math.max(
      1,
      Number(this.config.get<string>('EMBEDDING_BATCH_SIZE')) ||
        DEFAULT_BATCH_SIZE,
    );

    this.client = this.factory.createClient({
      provider: this.provider,
      model,
      dimensions,
      apiKey: this.config.get<string>('EMBEDDING_API_KEY'),
      baseUrl:
        this.config.get<string>('EMBEDDING_BASE_URL') ||
        this.config.get<string>('LLM_BASE_URL'),
    });
  }

  getProvider(): LLMProvider {
    return this.provider;
  }

  getModel(): string {
    return this.client.model;
  }

  getDimensions(): number {
    return this.client.dimensions;
  }

  /**
   * Sinh vector cho nhiều văn bản, tự động chia batch theo `EMBEDDING_BATCH_SIZE`.
   * @returns vector theo đúng thứ tự `texts` đầu vào.
   */
  async embedDocuments(texts: string[]): Promise<number[][]> {
    const normalized = texts.map((text) => (text ?? '').trim());
    if (normalized.length === 0) return [];

    const vectors: number[][] = [];
    for (let i = 0; i < normalized.length; i += this.batchSize) {
      const batch = normalized.slice(i, i + this.batchSize);
      const result: EmbedBatchResult = await this.client.embed(batch);
      vectors.push(...result.vectors);
    }

    if (vectors.length !== normalized.length) {
      throw new Error(
        `Embedding trả về ${vectors.length} vector cho ${normalized.length} đoạn văn bản — dữ liệu không khớp, từ chối ghi vector store.`,
      );
    }
    return vectors;
  }

  /** Sinh vector cho một câu truy vấn Semantic Search. */
  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embedDocuments([text]);
    if (!vector) {
      throw new Error(
        'Embedding service không trả về vector cho câu truy vấn.',
      );
    }
    return vector;
  }
}
