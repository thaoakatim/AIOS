import { Injectable, Logger } from '@nestjs/common';
import {
  GoogleGenerativeAI,
  GenerativeModel,
  GenerationConfig,
} from '@google/generative-ai';
import {
  ILLMClient,
  LLMMessage,
  StreamingChunk,
  TokenUsage,
} from '../../core/llm/interfaces/llm.interface';

export interface GeminiAdapterOptions {
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

@Injectable()
export class GeminiAdapter implements ILLMClient {
  private readonly client: GoogleGenerativeAI;
  private readonly model: GenerativeModel;
  private readonly modelName: string;
  private readonly generationConfig: GenerationConfig;
  private readonly logger = new Logger(GeminiAdapter.name);

  constructor(options: GeminiAdapterOptions) {
    this.client = new GoogleGenerativeAI(options.apiKey);
    this.modelName = options.model;
    this.generationConfig = {
      temperature: options.temperature,
      maxOutputTokens: options.maxTokens,
    };
    this.model = this.client.getGenerativeModel({
      model: options.model,
      generationConfig: this.generationConfig,
    });
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
      const chat = this.model.startChat({
        history: this.mapMessagesToHistory(messages.slice(0, -1)),
        generationConfig: { ...this.generationConfig, ...options },
      });

      const lastMessage = messages[messages.length - 1];
      const result = await chat.sendMessage(lastMessage.content);

      const response = result.response;
      const text = response.text();
      const usage = await this.estimateUsage(messages, text);

      return {
        message: {
          role: 'assistant',
          content: text,
        },
        usage,
        finishReason: 'stop',
      };
    } catch (error) {
      this.logger.error(`Gemini generation failed: ${error.message}`);
      throw error;
    }
  }

  async *stream(
    messages: LLMMessage[],
    options?: Record<string, unknown>,
  ): AsyncIterable<StreamingChunk> {
    try {
      const chat = this.model.startChat({
        history: this.mapMessagesToHistory(messages.slice(0, -1)),
        generationConfig: { ...this.generationConfig, ...options },
      });

      const lastMessage = messages[messages.length - 1];
      const result = await chat.sendMessageStream(lastMessage.content);

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          yield {
            delta: { content: text },
            finishReason: null,
          };
        }
      }

      const usage = await this.estimateUsage(messages, '');
      yield {
        delta: {},
        finishReason: 'stop',
        usage,
      };
    } catch (error) {
      this.logger.error(`Gemini streaming failed: ${error.message}`);
      throw error;
    }
  }

  private mapMessagesToHistory(
    messages: LLMMessage[],
  ): Array<{ role: string; parts: Array<{ text: string }> }> {
    return messages
      .filter((m) => m.role !== 'tool')
      .map((msg) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      }));
  }

  private async estimateUsage(
    messages: LLMMessage[],
    completion: string,
  ): Promise<TokenUsage> {
    try {
      const totalText = messages.map((m) => m.content).join(' ') + completion;
      const result = await this.model.countTokens(totalText);
      const totalTokens = result.totalTokens;
      const completionTokens = Math.ceil(completion.length / 4);
      return {
        promptTokens: totalTokens - completionTokens,
        completionTokens,
        totalTokens,
      };
    } catch {
      return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    }
  }
}
