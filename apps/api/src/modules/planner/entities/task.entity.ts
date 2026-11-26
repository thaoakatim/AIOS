import type { ITask } from '@aios/shared-types';
import type { Task } from '@prisma/client';

/**
 * Domain entity đại diện cho một Task (hỗ trợ cây phân cấp parentTaskId).
 */
export class TaskEntity implements ITask {
  id!: string;
  planId!: string;
  parentTaskId!: string | null;
  title!: string;
  description!: string | null;
  status!: string;
  order!: number;
  dueDate!: Date | null;
  version!: number;
  contentHash!: string | null;
  deletedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;

  static fromPrisma(record: Task): TaskEntity {
    const entity = new TaskEntity();
    entity.id = record.id;
    entity.planId = record.planId;
    entity.parentTaskId = record.parentTaskId;
    entity.title = record.title;
    entity.description = record.description;
    entity.status = record.status;
    entity.order = record.order;
    entity.dueDate = record.dueDate;
    entity.version = record.version;
    entity.contentHash = record.contentHash;
    entity.deletedAt = record.deletedAt;
    entity.createdAt = record.createdAt;
    entity.updatedAt = record.updatedAt;
    return entity;
  }

  static fromPrismaMany(records: Task[]): TaskEntity[] {
    return records.map((record) => TaskEntity.fromPrisma(record));
  }
}
