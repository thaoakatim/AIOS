import { Injectable } from '@nestjs/common';
import { IEmbeddingClient } from '../../core/llm/interfaces/embedding.interface';
import { LLMProvider } from '../llm-providers/llm-provider.enum';
import { OpenAIEmbeddingAdapter } from './openai-embedding.adapter';
import { GeminiEmbeddingAdapter } from './gemini-embedding.adapter';
import { OllamaEmbeddingAdapter } from './ollama-embedding.adapter';

export interface EmbeddingClientOptions {
  provider: LLMProvider;
  model: string;
  dimensions?: number;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * EmbeddingClientFactory — tương xứng với `LLMClientFactory` nhưng cho vector.
 *
 * Adapter được khởi tạo bằng options thay vì DI vì client embedding không cần
 * phụ thuộc vào connection sống (khác `QdrantAdapter` cần connect khi boot).
 * Vì vậy chỉ có một instance dùng chung: `EmbeddingGatewayService` giữ client
 * đã tạo và tái sử dụng cho mọi lần gọi.
 */
@Injectable()
export class EmbeddingClientFactory {
  createClient(options: EmbeddingClientOptions): IEmbeddingClient {
    switch (options.provider) {
      case LLMProvider.OPENAI:
        return new OpenAIEmbeddingAdapter({
          apiKey: options.apiKey || '',
          baseUrl: options.baseUrl,
          model: options.model,
          dimensions: options.dimensions,
        });
      case LLMProvider.GEMINI:
        return new GeminiEmbeddingAdapter({
          apiKey: options.apiKey || '',
          model: options.model,
        });
      case LLMProvider.OLLAMA:
        return new OllamaEmbeddingAdapter({
          baseUrl: options.baseUrl,
          model: options.model,
          dimensions: options.dimensions,
        });
      default:
        throw new Error(
          `Unsupported embedding provider: ${String(options.provider)}`,
        );
    }
  }
}
