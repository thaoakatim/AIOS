import type { IPlan } from '@aios/shared-types';
import type { Plan } from '@prisma/client';

/**
 * Domain entity đại diện cho một Plan trong hệ thống AIOS.
 */
export class PlanEntity implements IPlan {
  id!: string;
  userId!: string;
  workflowId!: string | null;
  title!: string;
  description!: string | null;
  status!: string;
  version!: number;
  contentHash!: string | null;
  deletedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;

  static fromPrisma(record: Plan): PlanEntity {
    const entity = new PlanEntity();
    entity.id = record.id;
    entity.userId = record.userId;
    entity.workflowId = record.workflowId;
    entity.title = record.title;
    entity.description = record.description;
    entity.status = record.status;
    entity.version = record.version;
    entity.contentHash = record.contentHash;
    entity.deletedAt = record.deletedAt;
    entity.createdAt = record.createdAt;
    entity.updatedAt = record.updatedAt;
    return entity;
  }

  static fromPrismaMany(records: Plan[]): PlanEntity[] {
    return records.map((record) => PlanEntity.fromPrisma(record));
  }
}
