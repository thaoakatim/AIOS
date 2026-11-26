import { createHash } from 'node:crypto';
import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  IDecomposedTaskPreview,
  IPlanProgress,
  ITask,
  ITaskTreeNode,
} from '@aios/shared-types';
import { TaskStatus } from '@aios/shared-types';

export const MAX_TASK_DEPTH = 5;
export const MAX_AI_DECOMPOSE_DEPTH = 3;
export const MAX_AI_DECOMPOSE_TASKS = 50;
export const MAX_DUE_DAYS_OFFSET = 3650;

export interface PlanContentHashInput {
  title: string;
  description: string | null;
  status: string;
  workflowId: string | null;
}

export interface TaskContentHashInput {
  title: string;
  description: string | null;
  status: string;
  order: number;
  dueDate: Date | string | null;
  parentTaskId: string | null;
}

export interface BuildTaskTreeResult {
  roots: ITaskTreeNode[];
  orphanIds: string[];
}

export interface ExtractedDecompositionResult {
  title?: string;
  tasks: IDecomposedTaskPreview[];
}

/**
 * Tính SHA-256 canonical contentHash cho Plan.
 * Chỉ hash business content fields — KHÔNG gồm metadata đồng bộ (`deletedAt`, `version`, `updatedAt`).
 */
export function computePlanContentHash(input: PlanContentHashInput): string {
  const canonical = JSON.stringify({
    description: input.description ?? null,
    status: input.status,
    title: input.title,
    workflowId: input.workflowId ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Tính SHA-256 canonical contentHash cho Task.
 * Chỉ hash business content fields — KHÔNG gồm metadata đồng bộ (`deletedAt`, `version`, `updatedAt`).
 */
export function computeTaskContentHash(input: TaskContentHashInput): string {
  const normalizedDueDate =
    input.dueDate === null || input.dueDate === undefined
      ? null
      : new Date(input.dueDate).toISOString();

  const canonical = JSON.stringify({
    description: input.description ?? null,
    dueDate: normalizedDueDate,
    order: input.order,
    parentTaskId: input.parentTaskId ?? null,
    status: input.status,
    title: input.title,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Xây dựng cây phân cấp Task theo thuật toán O(N) single-pass.
 * Sắp xếp anh em theo `(order ASC, createdAt ASC, id ASC)`.
 * Hỗ trợ Orphan Recovery: task có `parentTaskId` không tồn tại trong tập active sẽ được đẩy lên root.
 */
export function buildTaskTree(tasks: ITask[]): BuildTaskTreeResult {
  const sorted = [...tasks].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    const timeDiff =
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.id.localeCompare(b.id);
  });

  const nodeMap = new Map<string, ITaskTreeNode>();
  for (const task of sorted) {
    nodeMap.set(task.id, {
      ...task,
      subTasks: [],
    });
  }

  const roots: ITaskTreeNode[] = [];
  const orphanIds: string[] = [];

  for (const task of sorted) {
    const node = nodeMap.get(task.id)!;
    if (!task.parentTaskId) {
      roots.push(node);
      continue;
    }

    if (task.parentTaskId === task.id) {
      orphanIds.push(task.id);
      roots.push(node);
      continue;
    }

    const parent = nodeMap.get(task.parentTaskId);
    if (!parent) {
      orphanIds.push(task.id);
      roots.push(node);
      continue;
    }

    parent.subTasks.push(node);
  }

  return { roots, orphanIds };
}

/**
 * Tổng hợp tiến độ thực hiện của một Plan.
 * Tránh lỗi chia cho 0 khi Plan chưa có task nào (`completionRate = 0`).
 */
export function computePlanProgress(
  tasks: Array<Pick<ITask, 'status'>>,
): IPlanProgress {
  let todo = 0;
  let inProgress = 0;
  let blocked = 0;
  let done = 0;

  for (const task of tasks) {
    if (task.status === String(TaskStatus.IN_PROGRESS)) {
      inProgress += 1;
    } else if (task.status === String(TaskStatus.BLOCKED)) {
      blocked += 1;
    } else if (task.status === String(TaskStatus.DONE)) {
      done += 1;
    } else {
      todo += 1;
    }
  }

  const totalTasks = tasks.length;
  const completionRate =
    totalTasks === 0 ? 0 : Math.round((done / totalTasks) * 10000) / 100;

  return {
    totalTasks,
    todo,
    inProgress,
    blocked,
    done,
    completionRate,
  };
}

/**
 * Tính độ sâu 1-based của một node trong danh sách task của cùng một Plan.
 */
export function getNodeDepth(
  taskMap: Map<string, Pick<ITask, 'id' | 'parentTaskId'>>,
  taskId: string,
): number {
  let depth = 0;
  let currentId: string | null = taskId;
  const visited = new Set<string>();

  while (currentId) {
    if (visited.has(currentId)) {
      throw new BadRequestException(
        'Phát hiện vòng lặp (cycle) trong cấu trúc cây nhiệm vụ.',
      );
    }
    visited.add(currentId);

    const node = taskMap.get(currentId);
    if (!node) break;

    depth += 1;
    currentId = node.parentTaskId;
  }

  return depth;
}

/**
 * Tính chiều cao tối đa của cây con bắt đầu từ `rootTaskId` (node lá có height = 0).
 */
export function getMaxSubtreeHeight(
  tasks: Array<Pick<ITask, 'id' | 'parentTaskId'>>,
  rootTaskId: string,
): number {
  const childrenMap = new Map<string, string[]>();
  for (const task of tasks) {
    if (task.parentTaskId) {
      const siblings = childrenMap.get(task.parentTaskId) ?? [];
      siblings.push(task.id);
      childrenMap.set(task.parentTaskId, siblings);
    }
  }

  let maxHeight = 0;
  const visited = new Set<string>([rootTaskId]);
  const stack: Array<{ id: string; height: number }> = [
    { id: rootTaskId, height: 0 },
  ];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.height > maxHeight) {
      maxHeight = current.height;
    }

    const children = childrenMap.get(current.id) ?? [];
    for (const childId of children) {
      if (!visited.has(childId)) {
        visited.add(childId);
        stack.push({ id: childId, height: current.height + 1 });
      }
    }
  }

  return maxHeight;
}

/**
 * Kiểm tra toàn bộ điều kiện hợp lệ khi gán hoặc thay đổi `parentTaskId`:
 * 1. Không tự tham chiếu chính mình.
 * 2. Task cha phải tồn tại trong cùng Plan.
 * 3. Không tạo vòng lặp (cycle) bằng ancestor walk.
 * 4. Đảm bảo tổng chiều sâu mới `depth(newParent) + 1 + maxSubtreeHeight(task) <= maxDepth`.
 */
export function validateReparenting(
  tasks: Array<Pick<ITask, 'id' | 'parentTaskId'>>,
  taskId: string,
  newParentId: string | null,
  maxDepth: number = MAX_TASK_DEPTH,
): void {
  if (newParentId === null) {
    return;
  }

  if (newParentId === taskId) {
    throw new BadRequestException(
      'Task không thể nhận chính nó làm task cha (self-parent).',
    );
  }

  const taskMap = new Map<string, Pick<ITask, 'id' | 'parentTaskId'>>();
  for (const task of tasks) {
    taskMap.set(task.id, task);
  }

  if (!taskMap.has(newParentId)) {
    throw new BadRequestException(
      'Task cha không tồn tại hoặc không thuộc cùng kế hoạch.',
    );
  }

  // Kiểm tra cycle: đi ngược từ newParentId lên gốc; nếu gặp taskId thì sẽ tạo cycle.
  let cursor: string | null = newParentId;
  const visited = new Set<string>();
  while (cursor) {
    if (cursor === taskId) {
      throw new BadRequestException(
        'Không thể gán task con/cháu làm task cha (tạo vòng lặp cây nhiệm vụ).',
      );
    }
    if (visited.has(cursor)) {
      throw new BadRequestException(
        'Phát hiện cấu trúc cây bị vòng lặp ở nhánh đích.',
      );
    }
    visited.add(cursor);
    cursor = taskMap.get(cursor)?.parentTaskId ?? null;
  }

  const parentDepth = getNodeDepth(taskMap, newParentId);
  const subtreeHeight = getMaxSubtreeHeight(tasks, taskId);
  const resultingDepth = parentDepth + 1 + subtreeHeight;

  if (resultingDepth > maxDepth) {
    throw new BadRequestException(
      `Độ sâu cây nhiệm vụ sau khi di chuyển (${resultingDepth}) vượt quá giới hạn tối đa ${maxDepth} tầng.`,
    );
  }
}

/**
 * Thu thập `rootTaskId` và toàn bộ ID các node con/cháu theo BFS lặp.
 */
export function collectDescendantIds(
  tasks: Array<Pick<ITask, 'id' | 'parentTaskId'>>,
  rootTaskId: string,
): string[] {
  const childrenMap = new Map<string, string[]>();
  for (const task of tasks) {
    if (task.parentTaskId) {
      const siblings = childrenMap.get(task.parentTaskId) ?? [];
      siblings.push(task.id);
      childrenMap.set(task.parentTaskId, siblings);
    }
  }

  const result: string[] = [];
  const visited = new Set<string>([rootTaskId]);
  const queue: string[] = [rootTaskId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    const children = childrenMap.get(current) ?? [];
    for (const childId of children) {
      if (!visited.has(childId)) {
        visited.add(childId);
        queue.push(childId);
      }
    }
  }

  return result;
}

/**
 * Tách và validate JSON đầu ra từ LLM cho tính năng phân rã mục tiêu.
 * Chống markdown fences, lời dẫn thừa, lỗi JSON, độ sâu vượt trần hoặc số lượng task quá lớn.
 */
export function extractAndValidateDecompositionJson(
  rawText: string,
  maxDepth: number = 2,
  maxTasks: number = MAX_AI_DECOMPOSE_TASKS,
  now: Date = new Date(),
): ExtractedDecompositionResult {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    throw new UnprocessableEntityException(
      'LLM trả về kết quả rỗng, không thể phân rã mục tiêu.',
    );
  }

  const jsonSubstring = extractBalancedJsonObject(rawText);
  if (!jsonSubstring) {
    throw new UnprocessableEntityException(
      'Không tìm thấy JSON hợp lệ trong phản hồi của LLM.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSubstring);
  } catch {
    throw new UnprocessableEntityException(
      'Phản hồi JSON từ LLM bị sai cú pháp.',
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UnprocessableEntityException(
      'Cấu trúc JSON từ LLM phải là một object chứa danh sách tasks.',
    );
  }

  const obj = parsed as Record<string, unknown>;
  let planTitle: string | undefined;
  if (obj.title !== undefined && obj.title !== null) {
    if (typeof obj.title !== 'string' || !obj.title.trim()) {
      throw new UnprocessableEntityException(
        'Trường "title" trong phản hồi của LLM không hợp lệ.',
      );
    }
    planTitle = obj.title.trim().slice(0, 200);
  }

  if (!Array.isArray(obj.tasks) || obj.tasks.length === 0) {
    throw new UnprocessableEntityException(
      'LLM phải trả về ít nhất một task trong mảng "tasks".',
    );
  }

  const counter = { count: 0 };
  const tasks = obj.tasks.map((node, index) =>
    validateDecomposedNode(node, index, 1, maxDepth, maxTasks, counter, now),
  );

  return {
    title: planTitle,
    tasks,
  };
}

function validateDecomposedNode(
  raw: unknown,
  order: number,
  depth: number,
  maxDepth: number,
  maxTasks: number,
  counter: { count: number },
  now: Date,
): IDecomposedTaskPreview {
  if (depth > maxDepth) {
    throw new UnprocessableEntityException(
      `Cây nhiệm vụ do LLM sinh ra vượt quá độ sâu tối đa ${maxDepth}.`,
    );
  }

  counter.count += 1;
  if (counter.count > maxTasks) {
    throw new UnprocessableEntityException(
      `Tổng số nhiệm vụ do LLM sinh ra vượt quá giới hạn ${maxTasks}.`,
    );
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new UnprocessableEntityException(
      'Mỗi phần tử task trong phản hồi của LLM phải là một object.',
    );
  }

  const record = raw as Record<string, unknown>;
  if (typeof record.title !== 'string' || !record.title.trim()) {
    throw new UnprocessableEntityException(
      'Mỗi task do LLM sinh ra phải có "title" hợp lệ.',
    );
  }

  const title = record.title.trim();
  if (title.length > 200) {
    throw new UnprocessableEntityException(
      'Tiêu đề task do LLM sinh ra vượt quá 200 ký tự.',
    );
  }

  let description: string | null = null;
  if (record.description !== undefined && record.description !== null) {
    if (typeof record.description !== 'string') {
      throw new UnprocessableEntityException(
        'Trường "description" của task phải là chuỗi ký tự.',
      );
    }
    const trimmedDesc = record.description.trim();
    description = trimmedDesc ? trimmedDesc.slice(0, 2000) : null;
  }

  let dueDate: string | null = null;
  if (record.dueDaysOffset !== undefined && record.dueDaysOffset !== null) {
    if (
      typeof record.dueDaysOffset !== 'number' ||
      !Number.isInteger(record.dueDaysOffset) ||
      record.dueDaysOffset < 0 ||
      record.dueDaysOffset > MAX_DUE_DAYS_OFFSET
    ) {
      throw new UnprocessableEntityException(
        `Trường "dueDaysOffset" phải là số nguyên trong khoảng 0..${MAX_DUE_DAYS_OFFSET}.`,
      );
    }
    dueDate = new Date(
      now.getTime() + record.dueDaysOffset * 86_400_000,
    ).toISOString();
  }

  let subTasks: IDecomposedTaskPreview[] = [];
  if (record.subTasks !== undefined && record.subTasks !== null) {
    if (!Array.isArray(record.subTasks)) {
      throw new UnprocessableEntityException(
        'Trường "subTasks" phải là một mảng.',
      );
    }
    subTasks = record.subTasks.map((child, childIndex) =>
      validateDecomposedNode(
        child,
        childIndex,
        depth + 1,
        maxDepth,
        maxTasks,
        counter,
        now,
      ),
    );
  }

  return {
    title,
    description,
    dueDate,
    order,
    subTasks,
  };
}

function extractBalancedJsonObject(rawText: string): string | null {
  const fencedMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(rawText);
  const candidate = fencedMatch ? fencedMatch[1] : rawText;

  const startIndex = candidate.indexOf('{');
  if (startIndex === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < candidate.length; i += 1) {
    const ch = candidate[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return candidate.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}
