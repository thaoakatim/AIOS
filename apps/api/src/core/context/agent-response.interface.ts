import { TokenUsage } from '../llm/interfaces/llm.interface';

export interface AgentResponse {
  content: string;
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage: TokenUsage;
}
