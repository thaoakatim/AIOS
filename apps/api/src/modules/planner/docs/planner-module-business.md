# Planner Module — Tài liệu Nghiệp vụ (Business Specification)

## 1. Mục tiêu của Module

Module **Planner (`modules/planner`)** giúp AIOS đóng vai trò **Personal Chief of Staff**: không chỉ trò chuyện hay tra cứu tài liệu, mà còn quản lý mục tiêu, lộ trình hành động (Roadmap) và phân rã công việc phân cấp cho từng người dùng.

Module phục vụ 2 nhóm nhu cầu:
1. **Quản lý Kế hoạch & Nhiệm vụ cá nhân (Manual & Kanban/Roadmap):**
   - Tạo, xem, cập nhật, lưu trữ (`archived`) hoặc khôi phục (`un-archive`), và xóa mềm kế hoạch (`Plan`) — độc lập hoặc gắn với một `Workflow`.
   - Quản lý cây nhiệm vụ (`Task`) theo quan hệ cha–con (`parentTaskId`) với 4 trạng thái: `todo`, `in_progress`, `blocked`, `done`.
   - Theo dõi tiến độ tổng hợp (`completionRate`, đếm số task theo từng trạng thái).
2. **Tư vấn & Phân rã Mục tiêu bằng AI (`POST /planner/decompose`):**
   - Biến một mục tiêu ngôn ngữ tự nhiên (ví dụ: *"Chuẩn bị demo AIOS Sprint 3 trong 2 tuần"*) thành cấu trúc `Plan` + cây `Task` nhiều tầng có mô tả và hạn hoàn thành dự kiến.
   - Hỗ trợ chế độ xem trước (`dryRun: true`) trước khi lưu vào hệ thống.
   - Tự động cung cấp các Active Plans & Tasks hiện tại vào ngữ cảnh trò chuyện (`ChatModule`) để AI biết người dùng đang cần làm gì.

---

## 2. Quy tắc Nghiệp vụ Bắt buộc

1. **Cô lập quyền sở hữu (`userId`):** Mọi Plan và Task đều thuộc về đúng một người dùng (`@CurrentUser()`). Người dùng A không thể xem, sửa, xóa, hoặc gắn Task/Workflow thuộc về người dùng B.
2. **Trạng thái Kế hoạch (`PlanStatus`):**
   - `active`: Đang thực hiện (mặc định). Được tự động nạp vào `AgentExecutionContext.context.activePlans`.
   - `completed`: Đã hoàn thành.
   - `archived`: Đã lưu trữ. Mọi thao tác tạo/sửa/xóa `Task` bên trong plan `archived` đều bị từ chối (`400 Bad Request`). Tuy nhiên, người dùng vẫn có thể un-archive (`PATCH /planner/plans/:id` chuyển từ `archived` → `active`).
3. **Liên kết `Workflow` 1:1 linh hoạt:**
   - Một `Plan` có thể tạo độc lập (`workflowId = null`) hoặc gắn với tối đa 1 `Workflow`.
   - Một `Workflow` chỉ được gắn tối đa 1 **active** `Plan` tại một thời điểm (đảm bảo bởi Partial Unique Index `WHERE "workflowId" IS NOT NULL AND "deletedAt" IS NULL`). Khi xóa mềm Plan cũ, `Workflow` đó có thể tạo lại Plan mới.
4. **Ràng buộc Cây Nhiệm vụ (`Task` Hierarchy):**
   - `parentTaskId` phải thuộc cùng một `Plan` và chưa bị xóa mềm.
   - Không cho phép tự trỏ chính mình hoặc tạo vòng lặp (cycle).
   - Giới hạn độ sâu tối đa `5` tầng (bao gồm cả chiều cao cây con khi di chuyển nhánh).
5. **Xóa mềm đồng bộ (Tombstone Cascade):**
   - Xóa mềm `Plan` đồng thời xóa mềm toàn bộ `Task` con.
   - Xóa mềm `Task` cha đồng thời xóa mềm toàn bộ cây con/cháu bên dưới, tăng `version` để sẵn sàng E2EE Sync.
