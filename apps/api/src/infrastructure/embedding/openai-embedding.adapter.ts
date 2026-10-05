import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import {
  IEmbeddingClient,
  EmbedBatchResult,
} from '../../core/llm/interfaces/embedding.interface';

export interface OpenAIEmbeddingAdapterOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  /** Số chiều vector đầu ra (OpenAI hỗ trợ rút gọn cho dòng text-embedding-3-*). */
  dimensions?: number;
}

/**
 * Adapter Embedding cho OpenAI (và các provider OpenAI-compatible).
 *
 * Ghi chú: `dimensions` chỉ được hỗ trợ cho dòng `text-embedding-3-*`.
 * Adapter tự bỏ tham số nếu model không thuộc dòng đó để tránh lỗi 400.
 */
@Injectable()
export class OpenAIEmbeddingAdapter implements IEmbeddingClient {
  private readonly client: OpenAI;
  readonly model: string;
  readonly dimensions: number;
  private readonly logger = new Logger(OpenAIEmbeddingAdapter.name);

  constructor(options: OpenAIEmbeddingAdapterOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,
    });
    this.model = options.model;
    this.dimensions = options.dimensions ?? 1536;
  }

  async embed(texts: string[]): Promise<EmbedBatchResult> {
    if (texts.length === 0) {
      return {
        vectors: [],
        usage: { promptTokens: 0, totalTokens: 0 },
        model: this.model,
      };
    }

    const supportsDimensions = this.model.startsWith('text-embedding-3');
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
      ...(supportsDimensions && this.dimensions
        ? { dimensions: this.dimensions }
        : {}),
    });

    const vectors = response.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);

    this.logger.debug(
      `OpenAI embedding: ${texts.length} đoạn -> ${vectors.length} vector (${vectors[0]?.length ?? 0} chiều)`,
    );

    return {
      vectors,
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
      model: response.model ?? this.model,
    };
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = (await this.embed([text])).vectors;
    return vector;
  }
}
