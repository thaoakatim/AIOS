import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { IDecomposedTaskPreview } from '@aios/shared-types';
import { PlanStatus, TaskStatus } from '@aios/shared-types';
import { Prisma, type Plan, type Task, type Workflow } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { PlanEntity } from './entities/plan.entity';
import { TaskEntity } from './entities/task.entity';
import {
  MAX_TASK_DEPTH,
  collectDescendantIds,
  computePlanContentHash,
  computeTaskContentHash,
  getNodeDepth,
  validateReparenting,
} from './utils/planner-tree.util';

interface LockedPlanRow {
  id: string;
  status: string;
  deletedAt: Date | null;
}

export interface CreatePlanData {
  title: string;
  description: string | null;
  workflowId: string | null;
  status: string;
}

export interface UpdatePlanPatch {
  title?: string;
  description?: string | null;
  status?: string;
}

export interface ListPlansParams {
  status?: string;
  search?: string;
  limit: number;
  offset: number;
}

export interface CreateTaskData {
  title: string;
  description: string | null;
  parentTaskId: string | null;
  status: string;
  order?: number;
  dueDate: Date | null;
}

export interface UpdateTaskPatch {
  title?: string;
  description?: string | null;
  parentTaskId?: string | null;
  status?: string;
  order?: number;
  dueDate?: Date | null;
}

export interface ActivePlanWithTasksRecord extends Plan {
  tasks: Task[];
}

export interface CreatePlanWithTreeParams {
  title: string;
  description: string | null;
  workflowId: string | null;
  tasks: IDecomposedTaskPreview[];
}

/**
 * PlannerRepository — tầng duy nhất trong PlannerModule truy cập PrismaService.
 * Bắt buộc truyền `userId: string` và lọc `deletedAt: null` ở mọi thao tác.
 */
@Injectable()
export class PlannerRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------ Aggregate Root Locks --

  private async lockPlanForUpdate(
    tx: Prisma.TransactionClient,
    planId: string,
    userId: string,
  ): Promise<LockedPlanRow | null> {
    const rows = await tx.$queryRaw<LockedPlanRow[]>`
      SELECT "id", "status", "deletedAt"
      FROM "plans"
      WHERE "id" = ${planId}::uuid AND "userId" = ${userId}::uuid
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  private async lockPlanByTaskIdForUpdate(
    tx: Prisma.TransactionClient,
    taskId: string,
    userId: string,
  ): Promise<LockedPlanRow | null> {
    const rows = await tx.$queryRaw<LockedPlanRow[]>`
      SELECT p."id", p."status", p."deletedAt"
      FROM "plans" p
      INNER JOIN "tasks" t ON t."planId" = p."id"
      WHERE t."id" = ${taskId}::uuid AND p."userId" = ${userId}::uuid
      FOR UPDATE OF p
    `;
    return rows[0] ?? null;
  }

  // ----------------------------------------------------------- Plan CRUD --

  async createPlan(userId: string, data: CreatePlanData): Promise<PlanEntity> {
    const contentHash = computePlanContentHash({
      title: data.title,
      description: data.description,
      status: data.status,
      workflowId: data.workflowId,
    });

    try {
      const created = await this.prisma.plan.create({
        data: {
          userId,
          workflowId: data.workflowId,
          title: data.title,
          description: data.description,
          status: data.status,
          version: 1,
          contentHash,
        },
      });
      return PlanEntity.fromPrisma(created);
    } catch (error) {
      this.rethrowKnownPrismaError(error);
      throw error;
    }
  }

  async findPlanById(id: string, userId: string): Promise<PlanEntity | null> {
    const record = await this.prisma.plan.findFirst({
      where: {
        id,
        userId,
        deletedAt: null,
      },
    });
    return record ? PlanEntity.fromPrisma(record) : null;
  }

  async findActivePlanByWorkflowId(
    workflowId: string,
    userId: string,
  ): Promise<PlanEntity | null> {
    const record = await this.prisma.plan.findFirst({
      where: {
        workflowId,
        userId,
        deletedAt: null,
      },
    });
    return record ? PlanEntity.fromPrisma(record) : null;
  }

  async findWorkflowById(
    workflowId: string,
    userId: string,
  ): Promise<Workflow | null> {
    return this.prisma.workflow.findFirst({
      where: {
        id: workflowId,
        userId,
        deletedAt: null,
      },
    });
  }

  async listPlans(
    userId: string,
    params: ListPlansParams,
  ): Promise<{ items: PlanEntity[]; total: number }> {
    const where: Prisma.PlanWhereInput = {
      userId,
      deletedAt: null,
    };

    if (params.status !== undefined) {
      where.status = params.status;
    }

    const search = params.search?.trim();
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [records, total] = await Promise.all([
      this.prisma.plan.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        take: params.limit,
        skip: params.offset,
      }),
      this.prisma.plan.count({ where }),
    ]);

    return {
      items: PlanEntity.fromPrismaMany(records),
      total,
    };
  }

  async listActivePlansWithTasks(
    userId: string,
    options: { maxPlans: number; maxTasksPerPlan: number },
  ): Promise<ActivePlanWithTasksRecord[]> {
    return this.prisma.plan.findMany({
      where: {
        userId,
        status: PlanStatus.ACTIVE,
        deletedAt: null,
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: options.maxPlans,
      include: {
        tasks: {
          where: {
            deletedAt: null,
            status: { not: TaskStatus.DONE },
          },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          take: options.maxTasksPerPlan,
        },
      },
    });
  }

  async updatePlan(
    id: string,
    userId: string,
    patch: UpdatePlanPatch,
  ): Promise<PlanEntity | null> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockPlanForUpdate(tx, id, userId);
      if (!locked || locked.deletedAt !== null) {
        return null;
      }

      const current = await tx.plan.findFirst({
        where: { id, userId, deletedAt: null },
      });
      if (!current) {
        return null;
      }

      const nextTitle = patch.title ?? current.title;
      const nextDescription =
        patch.description !== undefined
          ? patch.description
          : current.description;
      const nextStatus = patch.status ?? current.status;

      const contentHash = computePlanContentHash({
        title: nextTitle,
        description: nextDescription,
        status: nextStatus,
        workflowId: current.workflowId,
      });

      const updated = await tx.plan.update({
        where: { id },
        data: {
          title: nextTitle,
          description: nextDescription,
          status: nextStatus,
          contentHash,
          version: { increment: 1 },
        },
      });

      return PlanEntity.fromPrisma(updated);
    });
  }

  async softDeletePlan(id: string, userId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockPlanForUpdate(tx, id, userId);
      if (!locked || locked.deletedAt !== null) {
        return false;
      }

      const now = new Date();
      await tx.plan.update({
        where: { id },
        data: {
          deletedAt: now,
          version: { increment: 1 },
        },
      });

      await tx.task.updateMany({
        where: {
          planId: id,
          deletedAt: null,
        },
        data: {
          deletedAt: now,
          version: { increment: 1 },
        },
      });

      return true;
    });
  }

  // ----------------------------------------------------------- Task CRUD --

  async createTaskInPlan(
    userId: string,
    planId: string,
    data: CreateTaskData,
  ): Promise<TaskEntity> {
    return this.prisma.$transaction(async (tx) => {
      const lockedPlan = await this.lockPlanForUpdate(tx, planId, userId);
      if (!lockedPlan || lockedPlan.deletedAt !== null) {
        throw new NotFoundException(
          `Không tìm thấy kế hoạch với id "${planId}".`,
        );
      }

      if (lockedPlan.status === String(PlanStatus.ARCHIVED)) {
        throw new BadRequestException(
          'Không thể thêm nhiệm vụ vào kế hoạch đã lưu trữ (archived).',
        );
      }

      if (data.parentTaskId) {
        const activeTasks = await tx.task.findMany({
          where: { planId, deletedAt: null },
          select: { id: true, parentTaskId: true },
        });
        const taskMap = new Map(activeTasks.map((t) => [t.id, t]));
        if (!taskMap.has(data.parentTaskId)) {
          throw new BadRequestException(
            'Task cha không tồn tại hoặc không thuộc cùng kế hoạch.',
          );
        }
        const parentDepth = getNodeDepth(taskMap, data.parentTaskId);
        if (parentDepth + 1 > MAX_TASK_DEPTH) {
          throw new BadRequestException(
            `Độ sâu cây nhiệm vụ vượt quá giới hạn tối đa ${MAX_TASK_DEPTH} tầng.`,
          );
        }
      }

      let order = data.order;
      if (order === undefined) {
        const aggregate = await tx.task.aggregate({
          where: {
            planId,
            parentTaskId: data.parentTaskId,
            deletedAt: null,
          },
          _max: { order: true },
        });
        order = (aggregate._max.order ?? -1) + 1;
      }

      const contentHash = computeTaskContentHash({
        title: data.title,
        description: data.description,
        status: data.status,
        order,
        dueDate: data.dueDate,
        parentTaskId: data.parentTaskId,
      });

      const created = await tx.task.create({
        data: {
          planId,
          parentTaskId: data.parentTaskId,
          title: data.title,
          description: data.description,
          status: data.status,
          order,
          dueDate: data.dueDate,
          version: 1,
          contentHash,
        },
      });

      return TaskEntity.fromPrisma(created);
    });
  }

  async findTaskById(
    taskId: string,
    userId: string,
  ): Promise<TaskEntity | null> {
    const record = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        deletedAt: null,
        plan: {
          userId,
          deletedAt: null,
        },
      },
    });
    return record ? TaskEntity.fromPrisma(record) : null;
  }

  async listTasksByPlan(
    planId: string,
    userId: string,
  ): Promise<TaskEntity[] | null> {
    const plan = await this.findPlanById(planId, userId);
    if (!plan) {
      return null;
    }

    const records = await this.prisma.task.findMany({
      where: {
        planId,
        deletedAt: null,
      },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });

    return TaskEntity.fromPrismaMany(records);
  }

  async updateTaskInPlan(
    userId: string,
    taskId: string,
    patch: UpdateTaskPatch,
  ): Promise<TaskEntity | null> {
    return this.prisma.$transaction(async (tx) => {
      // Lock Aggregate Root TRƯỚC khi đọc task để chống stale read / lost update.
      const lockedPlan = await this.lockPlanByTaskIdForUpdate(
        tx,
        taskId,
        userId,
      );
      if (!lockedPlan || lockedPlan.deletedAt !== null) {
        return null;
      }

      const currentTask = await tx.task.findFirst({
        where: {
          id: taskId,
          planId: lockedPlan.id,
          deletedAt: null,
        },
      });
      if (!currentTask) {
        return null;
      }

      if (lockedPlan.status === String(PlanStatus.ARCHIVED)) {
        throw new BadRequestException(
          'Không thể chỉnh sửa nhiệm vụ trong kế hoạch đã lưu trữ (archived).',
        );
      }

      const nextParentTaskId =
        patch.parentTaskId !== undefined
          ? patch.parentTaskId
          : currentTask.parentTaskId;

      if (nextParentTaskId !== currentTask.parentTaskId) {
        const activeTasks = await tx.task.findMany({
          where: { planId: lockedPlan.id, deletedAt: null },
          select: { id: true, parentTaskId: true },
        });
        validateReparenting(
          activeTasks,
          taskId,
          nextParentTaskId,
          MAX_TASK_DEPTH,
        );
      }

      const nextTitle = patch.title ?? currentTask.title;
      const nextDescription =
        patch.description !== undefined
          ? patch.description
          : currentTask.description;
      const nextStatus = patch.status ?? currentTask.status;
      const nextOrder =
        patch.order !== undefined ? patch.order : currentTask.order;
      const nextDueDate =
        patch.dueDate !== undefined ? patch.dueDate : currentTask.dueDate;

      const contentHash = computeTaskContentHash({
        title: nextTitle,
        description: nextDescription,
        status: nextStatus,
        order: nextOrder,
        dueDate: nextDueDate,
        parentTaskId: nextParentTaskId,
      });

      const updated = await tx.task.update({
        where: { id: taskId },
        data: {
          title: nextTitle,
          description: nextDescription,
          status: nextStatus,
          order: nextOrder,
          dueDate: nextDueDate,
          parentTaskId: nextParentTaskId,
          contentHash,
          version: { increment: 1 },
        },
      });

      return TaskEntity.fromPrisma(updated);
    });
  }

  async softDeleteTaskCascade(
    userId: string,
    taskId: string,
  ): Promise<{ deletedId: string; deletedCount: number } | null> {
    return this.prisma.$transaction(async (tx) => {
      // Lock Aggregate Root TRƯỚC khi đọc task và toàn bộ cây con.
      const lockedPlan = await this.lockPlanByTaskIdForUpdate(
        tx,
        taskId,
        userId,
      );
      if (!lockedPlan || lockedPlan.deletedAt !== null) {
        return null;
      }

      const currentTask = await tx.task.findFirst({
        where: {
          id: taskId,
          planId: lockedPlan.id,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!currentTask) {
        return null;
      }

      if (lockedPlan.status === String(PlanStatus.ARCHIVED)) {
        throw new BadRequestException(
          'Không thể xóa nhiệm vụ trong kế hoạch đã lưu trữ (archived).',
        );
      }

      const activeTasks = await tx.task.findMany({
        where: { planId: lockedPlan.id, deletedAt: null },
        select: { id: true, parentTaskId: true },
      });

      const idsToDelete = collectDescendantIds(activeTasks, taskId);
      const now = new Date();

      const result = await tx.task.updateMany({
        where: {
          id: { in: idsToDelete },
          planId: lockedPlan.id,
          deletedAt: null,
        },
        data: {
          deletedAt: now,
          version: { increment: 1 },
        },
      });

      return {
        deletedId: taskId,
        deletedCount: result.count,
      };
    });
  }

  // ---------------------------------------- Transactional Tree Creation --

  async createPlanWithTaskTree(
    userId: string,
    params: CreatePlanWithTreeParams,
  ): Promise<{ plan: PlanEntity; tasks: TaskEntity[] }> {
    const planContentHash = computePlanContentHash({
      title: params.title,
      description: params.description,
      status: PlanStatus.ACTIVE,
      workflowId: params.workflowId,
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const planRecord = await tx.plan.create({
          data: {
            userId,
            workflowId: params.workflowId,
            title: params.title,
            description: params.description,
            status: PlanStatus.ACTIVE,
            version: 1,
            contentHash: planContentHash,
          },
        });

        const createdTasks: Task[] = [];
        const insertNodes = async (
          nodes: IDecomposedTaskPreview[],
          parentTaskId: string | null,
        ): Promise<void> => {
          for (const node of nodes) {
            const dueDate = node.dueDate ? new Date(node.dueDate) : null;
            const contentHash = computeTaskContentHash({
              title: node.title,
              description: node.description,
              status: TaskStatus.TODO,
              order: node.order,
              dueDate,
              parentTaskId,
            });

            const taskRecord = await tx.task.create({
              data: {
                planId: planRecord.id,
                parentTaskId,
                title: node.title,
                description: node.description,
                status: TaskStatus.TODO,
                order: node.order,
                dueDate,
                version: 1,
                contentHash,
              },
            });

            createdTasks.push(taskRecord);

            if (node.subTasks.length > 0) {
              await insertNodes(node.subTasks, taskRecord.id);
            }
          }
        };

        await insertNodes(params.tasks, null);

        return {
          plan: PlanEntity.fromPrisma(planRecord),
          tasks: TaskEntity.fromPrismaMany(createdTasks),
        };
      });
    } catch (error) {
      this.rethrowKnownPrismaError(error);
      throw error;
    }
  }

  private rethrowKnownPrismaError(error: unknown): void {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException(
          'Workflow này đã được liên kết với một kế hoạch đang hoạt động.',
        );
      }
      if (error.code === 'P2003') {
        throw new NotFoundException(
          'Workflow tham chiếu không tồn tại hoặc không hợp lệ.',
        );
      }
    }
  }
}
