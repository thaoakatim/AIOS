import { Injectable, Logger } from '@nestjs/common';
import { Ollama } from 'ollama';
import {
  ILLMClient,
  LLMMessage,
  StreamingChunk,
  TokenUsage,
} from '../../core/llm/interfaces/llm.interface';

export interface OllamaAdapterOptions {
  baseUrl?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

@Injectable()
export class OllamaAdapter implements ILLMClient {
  private readonly client: Ollama;
  private readonly model: string;
  private readonly temperature?: number;
  private readonly maxTokens?: number;
  private readonly logger = new Logger(OllamaAdapter.name);

  constructor(options: OllamaAdapterOptions) {
    this.client = new Ollama({
      host: options.baseUrl || 'http://localhost:11434',
    });
    this.model = options.model;
    this.temperature = options.temperature;
    this.maxTokens = options.maxTokens;
  }

  async generate(
    messages: LLMMessage[],
    options?: Record<string, unknown>,
  ): Promise<{
    message: LLMMessage;
    usage: TokenUsage;
    finishReason: string;
  }> {
    try {
      const response = await this.client.chat({
        model: this.model,
        messages: this.mapMessages(messages),
        options: {
          temperature: this.temperature,
          num_predict: this.maxTokens,
          ...options,
        },
        stream: false,
      });

      return {
        message: {
          role: 'assistant',
          content: response.message.content,
        },
        usage: {
          promptTokens: response.prompt_eval_count || 0,
          completionTokens: response.eval_count || 0,
          totalTokens:
            (response.prompt_eval_count || 0) + (response.eval_count || 0),
        },
        finishReason: response.done ? 'stop' : 'length',
      };
    } catch (error) {
      this.logger.error(`Ollama generation failed: ${error.message}`);
      throw error;
    }
  }

  async *stream(
    messages: LLMMessage[],
    options?: Record<string, unknown>,
  ): AsyncIterable<StreamingChunk> {
    try {
      const stream = await this.client.chat({
        model: this.model,
        messages: this.mapMessages(messages),
        options: {
          temperature: this.temperature,
          num_predict: this.maxTokens,
          ...options,
        },
        stream: true,
      });

      for await (const chunk of stream) {
        if (chunk.message.content) {
          yield {
            delta: { content: chunk.message.content },
            finishReason: null,
          };
        }
        if (chunk.done) {
          yield {
            delta: {},
            finishReason: 'stop',
            usage: {
              promptTokens: chunk.prompt_eval_count || 0,
              completionTokens: chunk.eval_count || 0,
              totalTokens:
                (chunk.prompt_eval_count || 0) + (chunk.eval_count || 0),
            },
          };
        }
      }
    } catch (error) {
      this.logger.error(`Ollama streaming failed: ${error.message}`);
      throw error;
    }
  }

  private mapMessages(
    messages: LLMMessage[],
  ): Array<{ role: string; content: string }> {
    return messages
      .filter((m) => m.role !== 'tool')
      .map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));
  }
}
