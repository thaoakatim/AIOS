import {
  Message as PrismaMessage,
  MessageDocument,
  AgentRun,
} from '@prisma/client';
import { IMessage, MessageRole } from '@aios/shared-types';
import { ChatAgentRun } from './agent-run.entity';

export interface PrismaMessageWithRelations extends PrismaMessage {
  messageDocuments?: MessageDocument[];
  agentRun?: AgentRun | null;
}

export class ChatMessage implements IMessage {
  id: string;
  conversationId: string;
  agentSessionId?: string | null;
  role: MessageRole;
  content: string;
  version: number;
  contentHash: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  documentIds?: string[];
  agentRun?: ChatAgentRun | null;

  static fromPrisma(record: PrismaMessageWithRelations): ChatMessage {
    const entity = new ChatMessage();
    entity.id = record.id;
    entity.conversationId = record.conversationId;
    entity.agentSessionId = record.agentSessionId;
    entity.role = record.role as MessageRole;
    entity.content = record.content;
    entity.version = record.version;
    entity.contentHash = record.contentHash;
    entity.deletedAt = record.deletedAt;
    entity.createdAt = record.createdAt;

    if (record.messageDocuments && record.messageDocuments.length > 0) {
      entity.documentIds = record.messageDocuments.map((md) => md.documentId);
    }
    if (record.agentRun) {
      entity.agentRun = ChatAgentRun.fromPrisma(record.agentRun);
    }
    return entity;
  }
}
