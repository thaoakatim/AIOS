# Planner Module — Quy chuẩn & Nguyên tắc Phát triển

Mọi lập trình viên và subagent khi tích hợp hoặc mở rộng `PlannerModule` bắt buộc tuân thủ các quy tắc sau:

1. **Zero-Trust Ownership (`userId`):**
   - Controller luôn inject `@CurrentUser() user: AuthenticatedUser` (non-optional) và không chấp nhận `userId` từ body/query.
   - Mọi phương thức trong `PlannerRepository` bắt buộc nhận `userId: string` (non-optional) và lọc `deletedAt: null`.
2. **Aggregate Locking trong Transaction:**
   - Mọi thao tác ghi hoặc biến đổi cấu trúc cây `Task` phải lấy lock `FOR UPDATE` trên bản ghi `Plan` cha **trước** khi đọc state hiện tại của `Task` nhằm tránh stale read, cycle race condition hoặc ghi vào plan `archived`/`deleted`.
3. **Toàn vẹn Cây Nhiệm vụ (`parentTaskId`):**
   - Không cho phép gắn `parentTaskId` từ Plan khác, self-parent, cycle, hoặc di chuyển subtree khiến `depth(newParent) + 1 + maxSubtreeHeight(task) > 5`.
   - Khi xóa mềm một `Task`, bắt buộc xóa mềm toàn bộ hậu duệ trong cùng `$transaction` và tăng `version`.
4. **Quy ước `contentHash` & E2EE Sync:**
   - `contentHash` luôn được tính sau khi merge state hiện tại + patch trên các business content fields (`title`, `description`, `status`, `order`, `dueDate`, `parentTaskId`, `workflowId`), loại trừ metadata sync (`deletedAt`, `version`, `updatedAt`).
5. **Tách biệt LLM & Context Immutability:**
   - Chỉ gọi LLM thông qua `LLMGatewayService` (không import SDK bên ngoài, không truyền options đặc thù của riêng một provider).
   - Khi nạp Active Plans vào `AgentExecutionContext`, luôn dùng `ContextBuilder.from(ctx).setActivePlans(snapshot)` với `IActivePlansSnapshot` dạng object thuần.
