import { Injectable } from '@nestjs/common';
import { ILLMClient } from '../../core/llm/interfaces/llm.interface';
import { OpenAIAdapter } from './openai.adapter';
import { GeminiAdapter } from './gemini.adapter';
import { OllamaAdapter } from './ollama.adapter';
import { LLMProvider } from './llm-provider.enum';

export interface LLMClientOptions {
  provider: LLMProvider;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

@Injectable()
export class LLMClientFactory {
  createClient(options: LLMClientOptions): ILLMClient {
    switch (options.provider) {
      case LLMProvider.OPENAI:
        return new OpenAIAdapter({
          apiKey: options.apiKey || '',
          baseUrl: options.baseUrl,
          model: options.model,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
        });
      case LLMProvider.GEMINI:
        return new GeminiAdapter({
          apiKey: options.apiKey || '',
          model: options.model,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
        });
      case LLMProvider.OLLAMA:
        return new OllamaAdapter({
          baseUrl: options.baseUrl,
          model: options.model,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
        });
      default:
        throw new Error(`Unsupported LLM provider: ${options.provider}`);
    }
  }
}
