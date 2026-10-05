import { Injectable, Logger } from '@nestjs/common';
import { Ollama } from 'ollama';
import {
  IEmbeddingClient,
  EmbedBatchResult,
} from '../../core/llm/interfaces/embedding.interface';

export interface OllamaEmbeddingAdapterOptions {
  baseUrl?: string;
  model: string;
  /** Kết quả trả về từ Ollama; giữ để adapter tự xác nhận chiều vector. */
  dimensions?: number;
}

/**
 * Adapter Embedding cho Ollama (chạy local, không cần API key).
 *
 * Model mặc định `nomic-embed-text` sinh 768 chiều — khớp cột
 * `embedding vector(768)` của bảng `document_chunks`.
 */
@Injectable()
export class OllamaEmbeddingAdapter implements IEmbeddingClient {
  private readonly client: Ollama;
  readonly model: string;
  readonly dimensions: number;
  private readonly logger = new Logger(OllamaEmbeddingAdapter.name);

  constructor(options: OllamaEmbeddingAdapterOptions) {
    this.client = new Ollama({
      host: options.baseUrl || 'http://localhost:11434',
    });
    this.model = options.model;
    this.dimensions = options.dimensions ?? 768;
  }

  async embed(texts: string[]): Promise<EmbedBatchResult> {
    if (texts.length === 0) {
      return {
        vectors: [],
        usage: { promptTokens: 0, totalTokens: 0 },
        model: this.model,
      };
    }

    const response = await this.client.embed({
      model: this.model,
      input: texts,
    });

    if (response.embeddings.length !== texts.length) {
      throw new Error(
        `Ollama embedding trả về ${response.embeddings.length} vector cho ${texts.length} đoạn văn bản — không khớp.`,
      );
    }

    this.logger.debug(
      `Ollama embedding: ${texts.length} đoạn -> ${response.embeddings.length} vector (${response.embeddings[0]?.length ?? 0} chiều)`,
    );

    return {
      vectors: response.embeddings,
      usage: {
        promptTokens: response.prompt_eval_count ?? 0,
        totalTokens: response.prompt_eval_count ?? 0,
      },
      model: response.model ?? this.model,
    };
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = (await this.embed([text])).vectors;
    return vector;
  }
}
