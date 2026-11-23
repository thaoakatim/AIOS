import { AgentRun as PrismaAgentRun } from '@prisma/client';

export class ChatAgentRun {
  id: string;
  messageId: string;
  status: string;
  totalTokens: number | null;
  traceLogs: Record<string, unknown> | null;
  createdAt: Date;

  static fromPrisma(record: PrismaAgentRun): ChatAgentRun {
    const entity = new ChatAgentRun();
    entity.id = record.id;
    entity.messageId = record.messageId;
    entity.status = record.status;
    entity.totalTokens = record.totalTokens;
    entity.traceLogs = (record.traceLogs as Record<string, unknown>) ?? null;
    entity.createdAt = record.createdAt;
    return entity;
  }
}
