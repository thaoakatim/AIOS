import { Injectable } from '@nestjs/common';
import { encoding_for_model, Tiktoken, TiktokenModel } from 'tiktoken';
import { LLMMessage, TokenUsage } from '../interfaces/llm.interface';

export interface ModelTokenLimits {
  model: string;
  maxTokens: number;
  contextWindow: number;
}

@Injectable()
export class TokenCounterService {
  private readonly modelLimits: Map<string, ModelTokenLimits> = new Map([
    ['gpt-4', { model: 'gpt-4', maxTokens: 4096, contextWindow: 8192 }],
    [
      'gpt-4-turbo',
      { model: 'gpt-4-turbo', maxTokens: 4096, contextWindow: 128000 },
    ],
    ['gpt-4o', { model: 'gpt-4o', maxTokens: 4096, contextWindow: 128000 }],
    [
      'gpt-4o-mini',
      { model: 'gpt-4o-mini', maxTokens: 4096, contextWindow: 128000 },
    ],
    [
      'gpt-3.5-turbo',
      { model: 'gpt-3.5-turbo', maxTokens: 4096, contextWindow: 16385 },
    ],
    [
      'gemini-1.5-pro',
      { model: 'gemini-1.5-pro', maxTokens: 8192, contextWindow: 2000000 },
    ],
    [
      'gemini-1.5-flash',
      { model: 'gemini-1.5-flash', maxTokens: 8192, contextWindow: 1000000 },
    ],
    [
      'gemini-2.0-flash',
      { model: 'gemini-2.0-flash', maxTokens: 8192, contextWindow: 1000000 },
    ],
    ['llama3', { model: 'llama3', maxTokens: 4096, contextWindow: 8192 }],
    ['llama3.1', { model: 'llama3.1', maxTokens: 4096, contextWindow: 128000 }],
    ['mistral', { model: 'mistral', maxTokens: 4096, contextWindow: 32768 }],
    ['qwen2.5', { model: 'qwen2.5', maxTokens: 4096, contextWindow: 32768 }],
  ]);

  private readonly encoders: Map<string, Tiktoken> = new Map();

  private getEncoder(model: string): Tiktoken {
    if (!this.encoders.has(model)) {
      try {
        const encoder = encoding_for_model(model as TiktokenModel);
        this.encoders.set(model, encoder);
      } catch {
        const encoder = encoding_for_model('gpt-4');
        this.encoders.set(model, encoder);
      }
    }
    return this.encoders.get(model)!;
  }

  countTokens(text: string, model: string): number {
    const encoder = this.getEncoder(model);
    return encoder.encode(text).length;
  }

  countMessageTokens(message: LLMMessage, model: string): number {
    let tokens = 0;
    tokens += this.countTokens(message.role, model);
    tokens += this.countTokens(message.content, model);
    if (message.name) {
      tokens += this.countTokens(message.name, model);
    }
    if (message.toolCalls) {
      for (const tc of message.toolCalls) {
        tokens += this.countTokens(tc.function.name, model);
        tokens += this.countTokens(tc.function.arguments, model);
      }
    }
    return tokens + 3;
  }

  countMessagesTokens(messages: LLMMessage[], model: string): number {
    return messages.reduce(
      (sum, msg) => sum + this.countMessageTokens(msg, model),
      0,
    );
  }

  getModelLimits(model: string): ModelTokenLimits {
    for (const [key, limits] of this.modelLimits) {
      if (model.includes(key)) {
        return limits;
      }
    }
    return { model, maxTokens: 4096, contextWindow: 8192 };
  }

  estimateCost(
    usage: TokenUsage,
    model: string,
  ): { inputCost: number; outputCost: number; totalCost: number } {
    const pricing: Record<string, { input: number; output: number }> = {
      'gpt-4': { input: 0.03, output: 0.06 },
      'gpt-4-turbo': { input: 0.01, output: 0.03 },
      'gpt-4o': { input: 0.005, output: 0.015 },
      'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
      'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
      'gemini-1.5-pro': { input: 0.0035, output: 0.0105 },
      'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
    };

    const modelKey =
      Object.keys(pricing).find((k) => model.includes(k)) || 'gpt-4o-mini';
    const { input, output } = pricing[modelKey];

    return {
      inputCost: (usage.promptTokens / 1_000_000) * input,
      outputCost: (usage.completionTokens / 1_000_000) * output,
      totalCost:
        (usage.promptTokens / 1_000_000) * input +
        (usage.completionTokens / 1_000_000) * output,
    };
  }

  canFitInContext(
    messages: LLMMessage[],
    model: string,
    reserveTokens = 1000,
  ): boolean {
    const limits = this.getModelLimits(model);
    const usedTokens = this.countMessagesTokens(messages, model);
    return usedTokens + reserveTokens <= limits.contextWindow;
  }

  trimMessagesToFit(
    messages: LLMMessage[],
    model: string,
    reserveTokens = 1000,
  ): LLMMessage[] {
    const limits = this.getModelLimits(model);
    const maxTokens = limits.contextWindow - reserveTokens;
    let currentTokens = this.countMessagesTokens(messages, model);

    if (currentTokens <= maxTokens) {
      return messages;
    }

    const result = [...messages];
    while (currentTokens > maxTokens && result.length > 1) {
      const removed = result.shift();
      if (removed) {
        currentTokens -= this.countMessageTokens(removed, model);
      }
    }
    return result;
  }
}
