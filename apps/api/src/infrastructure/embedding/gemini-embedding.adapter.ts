import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  IEmbeddingClient,
  EmbedBatchResult,
} from '../../core/llm/interfaces/embedding.interface';

export interface GeminiEmbeddingAdapterOptions {
  apiKey: string;
  model: string;
}

/**
 * Adapter Embedding cho Google Gemini.
 *
 * `text-embedding-004` sinh vector 768 chiều — khớp cột
 * `embedding vector(768)` của bảng `document_chunks`.
 * Gemini không hỗ trợ `dimensions`, nên số chiều được khai báo cố định 768
 * (đổi model sang dòng khác thì phải sửa hằng số này và migration DB).
 */
const GEMINI_EMBEDDING_DIMENSIONS = 768;

/** Gemini giới hạn số input cho một lần gọi batch. */
const GEMINI_MAX_BATCH_SIZE = 100;

@Injectable()
export class GeminiEmbeddingAdapter implements IEmbeddingClient {
  private readonly client: GoogleGenerativeAI;
  readonly model: string;
  private readonly logger = new Logger(GeminiEmbeddingAdapter.name);

  constructor(options: GeminiEmbeddingAdapterOptions) {
    this.client = new GoogleGenerativeAI(options.apiKey);
    this.model = options.model;
  }

  get dimensions(): number {
    return GEMINI_EMBEDDING_DIMENSIONS;
  }

  async embed(texts: string[]): Promise<EmbedBatchResult> {
    if (texts.length === 0) {
      return {
        vectors: [],
        usage: { promptTokens: 0, totalTokens: 0 },
        model: this.model,
      };
    }

    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += GEMINI_MAX_BATCH_SIZE) {
      const batch = texts.slice(i, i + GEMINI_MAX_BATCH_SIZE);
      const response = await this.client
        .getGenerativeModel({ model: this.model })
        .batchEmbedContents({
          requests: batch.map((text) => ({
            content: { role: 'user', parts: [{ text }] },
          })),
        });

      vectors.push(...response.embeddings.map((item) => item.values));
    }

    this.logger.debug(
      `Gemini embedding: ${texts.length} đoạn -> ${vectors.length} vector (${vectors[0]?.length ?? 0} chiều)`,
    );

    return {
      vectors,
      usage: { promptTokens: 0, totalTokens: 0 },
      model: this.model,
    };
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = (await this.embed([text])).vectors;
    return vector;
  }
}
