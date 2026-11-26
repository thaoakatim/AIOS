# Planner Module — Tài liệu Kỹ thuật (Technical Specification)

## 1. Kiến trúc & Phân tầng

`PlannerModule` tuân thủ nghiêm ngặt kiến trúc 4 tầng của AIOS:
- `PlannerController` (`apps/api/src/modules/planner/planner.controller.ts`): Tiếp nhận HTTP requests, xác thực qua global `AIOSAuthGuard`, trích xuất `@CurrentUser() user: AuthenticatedUser`, parse UUID params qua `new ParseUUIDPipe()`.
- `PlannerService` (`apps/api/src/modules/planner/planner.service.ts`): Validation input tường minh (vì dự án không dùng `class-validator`), kiểm tra quyền sở hữu `Workflow`, điều phối `LLMGatewayService` cho `decomposeGoal`, build cây `Roadmap` và enrich `AgentExecutionContext` bất biến.
- `PlannerRepository` (`apps/api/src/modules/planner/planner.repository.ts`): Nơi duy nhất chạm tới `PrismaService`. Bắt buộc `userId: string` ở mọi hàm, dùng PostgreSQL Aggregate Root Locking (`FOR UPDATE`) trong `prisma.$transaction`.
- `planner-tree.util.ts` (`apps/api/src/modules/planner/utils/planner-tree.util.ts`): Các hàm thuần (`O(N)` tree builder, orphan recovery, cycle & subtree height check, canonical SHA-256 `contentHash`, balanced JSON extraction).

---

## 2. Cơ sở Dữ liệu & Concurrency Locking

### 2.1. Schema (`apps/api/prisma/schema.prisma`)
- `Plan.workflowId`: nullable `String? @db.Uuid` với relation `Workflow? @relation(..., onDelete: SetNull)`.
- **Partial Unique Index** trong SQL migration `20261126163000_make_plan_workflow_optional_and_add_planner_sync_fields`:
  ```sql
  CREATE UNIQUE INDEX "plans_workflowId_active_unique"
  ON "plans"("workflowId")
  WHERE "workflowId" IS NOT NULL AND "deletedAt" IS NULL;
  ```
- Bổ sung `description`, `updatedAt @default(now()) @updatedAt`, `Task.order`, và composite indexes `("userId", "deletedAt")`, `("planId", "deletedAt")`, `("parentTaskId")`.

### 2.2. Lock-Before-Read (`FOR UPDATE`)
Để loại bỏ hoàn toàn race condition tạo cycle, stale read/lost update, hoặc tạo task vào plan đã archive/xóa:
- `createTaskInPlan`, `updatePlan`, `softDeletePlan`: chạy `SELECT "id", "status", "deletedAt" FROM "plans" WHERE "id" = $1::uuid AND "userId" = $2::uuid FOR UPDATE` đầu transaction.
- `updateTaskInPlan`, `softDeleteTaskCascade`: chạy `SELECT p."id", p."status", p."deletedAt" FROM "plans" p INNER JOIN "tasks" t ON t."planId" = p."id" WHERE t."id" = $1::uuid AND p."userId" = $2::uuid FOR UPDATE OF p` **trước** khi đọc bản ghi `Task` hiện tại.

### 2.3. Canonical `contentHash` & Soft-Delete `updateMany`
- `contentHash` = `SHA-256` của canonical JSON chứa **chỉ các business fields** (`Plan`: `title`, `description`, `status`, `workflowId`; `Task`: `title`, `description`, `status`, `order`, `dueDate`, `parentTaskId`), **không** gồm `deletedAt`, `version`, `updatedAt`.
- Mọi thao tác `update` merge state hiện tại với patch rồi mới tính lại `contentHash`.
- Mọi thao tác soft-delete (`updateMany`) chỉ set `deletedAt = now` và `version: { increment: 1 }`, giữ nguyên đúng `contentHash`.

---

## 3. API Endpoints

| Method | Endpoint | Mô tả |
|---|---|---|
| `POST` | `/planner/decompose` | Phân rã mục tiêu bằng LLM (`dryRun: true` để preview, `false` để lưu `$transaction`) |
| `POST` | `/planner/plans` | Tạo Plan mới (độc lập hoặc gắn `workflowId`) |
| `GET` | `/planner/plans` | Danh sách Plan phân trang (`status`, `search`, `limit`, `offset`) |
| `GET` | `/planner/plans/:id` | Chi tiết Plan |
| `GET` | `/planner/plans/:id/roadmap` | Cây Task phân cấp (`ITaskTreeNode[]`) + thống kê `IPlanProgress` |
| `PATCH` | `/planner/plans/:id` | Cập nhật Plan (cho phép `archived` → `active`) |
| `DELETE` | `/planner/plans/:id` | Xóa mềm Plan & toàn bộ Task con |
| `POST` | `/planner/plans/:planId/tasks` | Tạo Task / Sub-task (`parentTaskId`, auto `order = max + 1`) |
| `GET` | `/planner/plans/:planId/tasks` | Danh sách phẳng Task của Plan |
| `PATCH` | `/planner/tasks/:taskId` | Cập nhật Task (kiểm tra cycle & `depth + subtreeHeight <= 5`) |
| `DELETE` | `/planner/tasks/:taskId` | Xóa mềm Task & toàn bộ cây con/cháu |

---

## 4. Tích hợp với `ChatModule` & `AgentExecutionContext`

- `PlannerService.enrichContext(ctx)` dùng `ContextBuilder.from(ctx).setActivePlans(snapshot)` (dữ liệu dạng plain object `IActivePlansSnapshot` để tương thích spread trong `ContextBuilder`).
- `ChatPlannerHook` (`apps/api/src/modules/chat/hooks/chat-planner.hook.ts`) được đăng ký vào `CHAT_HOOK_REGISTRY` với cơ chế Graceful Degradation.
- `ChatPromptBuilderService` render `## Active Plans & Tasks` kèm giới hạn ngân sách `600` tokens.
