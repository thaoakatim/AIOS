import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ILLMClient,
  LLMMessage,
  StreamingChunk,
  TokenUsage,
} from './interfaces/llm.interface';
import { LLMClientFactory } from '../../infrastructure/llm-providers/llm-client.factory';
import { LLMProvider } from '../../infrastructure/llm-providers/llm-provider.enum';
import { TokenCounterService } from './services/token-counter.service';

export interface LLMGatewayOptions {
  provider: LLMProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

@Injectable()
export class LLMGatewayService implements ILLMClient {
  private readonly client: ILLMClient;
  private readonly logger = new Logger(LLMGatewayService.name);

  constructor(
    private readonly factory: LLMClientFactory,
    private readonly tokenCounter: TokenCounterService,
    private readonly config: ConfigService,
  ) {
    const provider =
      config.get<LLMProvider>('LLM_PROVIDER') || LLMProvider.OPENAI;
    const model = config.get<string>('LLM_MODEL') || 'gpt-4o-mini';
    const apiKey = this.resolveApiKey(provider, config);
    const baseUrl = config.get<string>('LLM_BASE_URL');
    const rawTemp = config.get<string>('LLM_TEMPERATURE');
    const temperature = rawTemp ? parseFloat(rawTemp) : 0.7;
    const rawMaxTokens = config.get<string>('LLM_MAX_TOKENS');
    const maxTokens = rawMaxTokens ? parseInt(rawMaxTokens, 10) : 4096;

    this.client = this.factory.createClient({
      provider,
      model,
      apiKey,
      baseUrl,
      temperature,
      maxTokens,
    });
    this.logger.log(`LLM Gateway initialized with ${provider} - ${model}`);
  }

  async generate(
    messages: LLMMessage[],
    options?: Record<string, unknown>,
  ): Promise<{
    message: LLMMessage;
    usage: TokenUsage;
    finishReason: string;
  }> {
    return this.client.generate(messages, options);
  }

  async *stream(
    messages: LLMMessage[],
    options?: Record<string, unknown>,
  ): AsyncIterable<StreamingChunk> {
    yield* this.client.stream(messages, options);
  }

  getTokenCounter(): TokenCounterService {
    return this.tokenCounter;
  }

  async generateWithContextCheck(
    messages: LLMMessage[],
    options?: Record<string, unknown>,
  ): Promise<{
    message: LLMMessage;
    usage: TokenUsage;
    finishReason: string;
    trimmed: boolean;
  }> {
    const model = this.config.get<string>('LLM_MODEL') || 'gpt-4o-mini';
    const trimmed =
      this.tokenCounter.trimMessagesToFit(messages, model).length <
      messages.length;
    const result = await this.client.generate(messages, options);
    return { ...result, trimmed };
  }

  private resolveApiKey(
    provider: LLMProvider,
    config: ConfigService,
  ): string | undefined {
    const sharedKey = config.get<string>('LLM_API_KEY');
    if (sharedKey) return sharedKey;

    if (provider === LLMProvider.OPENAI) {
      return config.get<string>('OPENAI_API_KEY');
    }
    if (provider === LLMProvider.GEMINI) {
      return config.get<string>('GEMINI_API_KEY');
    }
    return undefined;
  }
}
