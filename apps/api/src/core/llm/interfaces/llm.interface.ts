export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string; // Used mainly for tool responses or specific assistant names
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface StreamingChunk {
  delta: Partial<LLMMessage>;
  finishReason: string | null;
  usage?: TokenUsage;
}

export interface ILLMClient {
  /**
   * Generates a single response from the LLM based on the provided messages.
   */
  generate(messages: LLMMessage[], options?: Record<string, unknown>): Promise<{
    message: LLMMessage;
    usage: TokenUsage;
    finishReason: string;
  }>;

  /**
   * Streams a response from the LLM.
   */
  stream(messages: LLMMessage[], options?: Record<string, unknown>): AsyncIterable<StreamingChunk>;
}

