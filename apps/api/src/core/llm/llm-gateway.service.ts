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
      (config.get('LLM_PROVIDER') as LLMProvider) || LLMProvider.OPENAI;
    const model = config.get('LLM_MODEL') || 'gpt-4o-mini';
    const apiKey = config.get('LLM_API_KEY');
    const baseUrl = config.get('LLM_BASE_URL');
    const temperature = config.get('LLM_TEMPERATURE')
      ? parseFloat(config.get('LLM_TEMPERATURE')!)
      : 0.7;
    const maxTokens = config.get('LLM_MAX_TOKENS')
      ? parseInt(config.get('LLM_MAX_TOKENS')!, 10)
      : 4096;

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
    const model = this.config.get('LLM_MODEL') || 'gpt-4o-mini';
    const trimmed =
      this.tokenCounter.trimMessagesToFit(messages, model).length <
      messages.length;
    const result = await this.client.generate(messages, options);
    return { ...result, trimmed };
  }
}
