/**
 * Planner Module — Shared contracts dùng chung cho API & Web/Desktop.
 * Tương ứng bảng Prisma `Plan` và `Task` (apps/api/prisma/schema.prisma).
 */
import { PlanStatus, TaskStatus } from '../enums';
export { PlanStatus, TaskStatus };
export interface IPlan {
    id: string;
    userId?: string;
    workflowId: string | null;
    title: string;
    description: string | null;
    status: string;
    version?: number;
    contentHash?: string | null;
    deletedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}
export interface ITask {
    id: string;
    planId: string;
    parentTaskId: string | null;
    title: string;
    description: string | null;
    status: string;
    order: number;
    dueDate: Date | null;
    version?: number;
    contentHash?: string | null;
    deletedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}
export interface ITaskTreeNode extends ITask {
    subTasks: ITaskTreeNode[];
}
export interface IPlanProgress {
    totalTasks: number;
    todo: number;
    inProgress: number;
    blocked: number;
    done: number;
    /** Phần trăm hoàn thành từ 0 đến 100 (làm tròn 2 chữ số thập phân). */
    completionRate: number;
}
export interface IPlanRoadmap {
    plan: IPlan;
    progress: IPlanProgress;
    tasks: ITaskTreeNode[];
}
export interface IActivePlanTaskSummary {
    id: string;
    title: string;
    status: string;
    dueDate: string | null;
}
export interface IActivePlanContext {
    id: string;
    title: string;
    status: string;
    tasks: IActivePlanTaskSummary[];
}
/**
 * Plain object tương thích `Record<string, unknown>` của
 * `AgentExecutionContext.context.activePlans` và `ContextBuilder.setActivePlans`.
 */
export type IActivePlansSnapshot = {
    plans: IActivePlanContext[];
    totalActivePlans: number;
};
export interface CreatePlanPayload {
    title: string;
    description?: string | null;
    workflowId?: string;
    status?: string;
}
export interface UpdatePlanPayload {
    title?: string;
    description?: string | null;
    status?: string;
}
export interface QueryPlanFilter {
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
}
export interface CreateTaskPayload {
    title: string;
    description?: string | null;
    parentTaskId?: string | null;
    status?: string;
    order?: number;
    dueDate?: string | null;
}
export interface UpdateTaskPayload {
    title?: string;
    description?: string | null;
    parentTaskId?: string | null;
    status?: string;
    order?: number;
    dueDate?: string | null;
}
export interface DecomposeGoalPayload {
    goal: string;
    title?: string;
    workflowId?: string;
    maxDepth?: number;
    dryRun?: boolean;
}
export interface IDecomposedTaskPreview {
    title: string;
    description: string | null;
    dueDate: string | null;
    order: number;
    subTasks: IDecomposedTaskPreview[];
}
export interface DecomposeGoalDryRunResult {
    dryRun: true;
    title: string;
    tasks: IDecomposedTaskPreview[];
}
export interface DecomposeGoalPersistedResult {
    dryRun: false;
    plan: IPlan;
    progress: IPlanProgress;
    tasks: ITaskTreeNode[];
}
export type DecomposeGoalResult = DecomposeGoalDryRunResult | DecomposeGoalPersistedResult;
//# sourceMappingURL=index.d.ts.map