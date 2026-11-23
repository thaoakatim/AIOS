import { Conversation as PrismaConversation } from '@prisma/client';
import { IConversation } from '@aios/shared-types';

export class ChatConversation implements IConversation {
  id: string;
  userId: string;
  title: string | null;
  version: number;
  contentHash: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;

  static fromPrisma(record: PrismaConversation): ChatConversation {
    const entity = new ChatConversation();
    entity.id = record.id;
    entity.userId = record.userId;
    entity.title = record.title;
    entity.version = record.version;
    entity.contentHash = record.contentHash;
    entity.deletedAt = record.deletedAt;
    entity.createdAt = record.createdAt;
    entity.updatedAt = record.updatedAt;
    return entity;
  }
}
