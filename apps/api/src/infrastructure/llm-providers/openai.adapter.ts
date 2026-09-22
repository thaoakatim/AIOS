import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import {
  ILLMClient,
  LLMMessage,
  StreamingChunk,
  TokenUsage,
} from '../../core/llm/interfaces/llm.interface';

export interface OpenAIAdapterOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

@Injectable()
export class OpenAIAdapter implements ILLMClient {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly temperature?: number;
  private readonly maxTokens?: number;
  private readonly logger = new Logger(OpenAIAdapter.name);

  constructor(options: OpenAIAdapterOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,
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
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: this.mapMessages(messages),
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        ...options,
      });

      const choice = completion.choices[0];
      return {
        message: this.mapChoiceToMessage(choice),
        usage: this.mapUsage(completion.usage),
        finishReason: choice.finish_reason || 'stop',
      };
    } catch (error) {
      this.logger.error(`OpenAI generation failed: ${error.message}`);
      throw error;
    }
  }

  async *stream(
    messages: LLMMessage[],
    options?: Record<string, unknown>,
  ): AsyncIterable<StreamingChunk> {
    try {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: this.mapMessages(messages),
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        stream: true,
        ...options,
      });

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (choice?.delta) {
          yield {
            delta: this.mapDeltaToMessage(choice.delta),
            finishReason: choice.finish_reason,
            usage: chunk.usage ? this.mapUsage(chunk.usage) : undefined,
          };
        }
      }
    } catch (error) {
      this.logger.error(`OpenAI streaming failed: ${error.message}`);
      throw error;
    }
  }

  private mapMessages(
    messages: LLMMessage[],
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    return messages.map((msg) => {
      if (msg.role === 'tool') {
        return {
          role: 'tool' as const,
          content: msg.content,
          tool_call_id: msg.toolCalls?.[0]?.id || '',
        };
      }
      if (msg.role === 'assistant' && msg.toolCalls) {
        return {
          role: 'assistant' as const,
          content: msg.content,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: tc.function,
          })),
        };
      }
      return {
        role: msg.role,
        content: msg.content,
        name: msg.name,
      };
    });
  }

  private mapChoiceToMessage(
    choice: OpenAI.Chat.Completions.ChatCompletion.Choice,
  ): LLMMessage {
    return {
      role: choice.message.role || 'assistant',
      content: choice.message.content || '',
      toolCalls: choice.message.tool_calls?.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })),
    };
  }

  private mapDeltaToMessage(
    delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice['delta'],
  ): Partial<LLMMessage> {
    const result: Partial<LLMMessage> = {};
    if (delta.role && delta.role !== 'developer') result.role = delta.role;
    if (delta.content) result.content = delta.content;
    if (delta.tool_calls) {
      result.toolCalls = delta.tool_calls.map((tc) => ({
        id: tc.id || '',
        type: 'function' as const,
        function: {
          name: tc.function?.name || '',
          arguments: tc.function?.arguments || '',
        },
      }));
    }
    return result;
  }

  private mapUsage(
    usage: OpenAI.Completions.CompletionUsage | undefined,
  ): TokenUsage {
    if (!usage) {
      return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    }
    return {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    };
  }
}
