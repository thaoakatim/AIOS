import { MessageRole } from '../enums';

export interface IConversation {
  id: string;
  userId?: string;
  title: string | null;
  version?: number;
  contentHash?: string | null;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IMessage {
  id: string;
  conversationId: string;
  agentSessionId?: string | null;
  role: MessageRole;
  content: string;
  version?: number;
  contentHash?: string | null;
  deletedAt?: Date | null;
  createdAt: Date;
}

export interface SendMessageDto {
  conversationId?: string;
  content: string;
  documentIds?: string[];
}

export interface ChatTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatStreamMetaEvent {
  type: 'meta';
  conversationId: string;
  userMessageId: string;
  runId: string;
}

export interface ChatStreamTokenEvent {
  type: 'token';
  content: string;
}

export interface ChatStreamDoneEvent {
  type: 'done';
  conversationId: string;
  messageId: string;
  runId: string;
  usage: ChatTokenUsage;
}

export interface ChatStreamErrorEvent {
  type: 'error';
  code: string;
  error: string;
}

export type ChatStreamEvent =
  | ChatStreamMetaEvent
  | ChatStreamTokenEvent
  | ChatStreamDoneEvent
  | ChatStreamErrorEvent;

export interface ChatResponseDto {
  conversationId: string;
  userMessageId: string;
  assistantMessage: IMessage;
  runId: string;
  usage: ChatTokenUsage;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
