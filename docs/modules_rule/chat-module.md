# Chat Module — Quy Chuẩn & Nguyên Tắc Phát Triển

## 1. Nguyên Tắc Cốt Lõi (Core Principles)

Mọi lập trình viên và subagent khi phát triển hoặc tích hợp với `ChatModule` bắt buộc tuân thủ 100% các quy định sau:

### Rule 1: Message-Centric Design & Data Ownership
- `Conversation` thuộc quyền sở hữu của `User` (`userId`).
- Quyền sở hữu của `Message`, `MessageDocument`, và `AgentRun` được bảo vệ và kế thừa chặt chẽ thông qua `conversation.userId`.
- Tuyệt đối **không bao giờ** chấp nhận `userId` từ client gửi lên body/query; luôn trích xuất từ `@CurrentUser() user: AuthenticatedUser`.

### Rule 2: Chống Lỗ Hổng IDOR Đa Tầng (Zero-Trust Validation)
- Mọi hàm truy vấn ở `ChatRepository` bắt buộc nhận `userId: string` và lọc `deletedAt: null`.
- Khi đính kèm `documentIds`, bắt buộc kiểm tra sự tồn tại và quyền sở hữu của tất cả các tài liệu đối với `user.id` trước khi lưu vào DB hoặc nạp vào RAG.

### Rule 3: Khởi Tạo Lượt Chat Nguyên Tử (Atomic Transactions)
- Sử dụng `prisma.$transaction` cho toàn bộ quá trình khởi tạo một lượt chat (`Conversation` nếu mới + `User Message` + `AgentRun` + `MessageDocument`).
- Khi xóa cuộc hội thoại, thực hiện Soft-Delete đồng thời `Conversation` và các `Message` con trong `$transaction` và tăng `version` để phục vụ E2EE Sync.

### Rule 4: Bảo Toàn Ngữ Cảnh Bất Biến (Immutable Context Pipeline)
- Không bao giờ trực tiếp thay đổi (mutate) đối tượng `AgentExecutionContext`.
- Mọi thay đổi về Memory, RAG chunks, System rules, hoặc Metadata đều phải đi qua `ContextBuilder.from(ctx)` và trả về đối tượng `readonly` mới.
- Loại trừ `userMessage.id` vừa tạo khỏi `listRecentMessages` để tránh bug Double User Message.

### Rule 5: An Toàn Khi Xử Lý Streaming (SSE Safety)
- Luôn hoàn thành pre-flight validation trước khi gọi `res.setHeader('Content-Type', 'text/event-stream')`.
- Thiết lập đầy đủ các header chống proxy buffering (`X-Accel-Buffering: no`, `Cache-Control: no-cache, no-transform`).
- Lắng nghe `req.on('close')` để abort kịp thời, cập nhật trạng thái `AgentRun` sang `cancelled`.
- Có fallback tính toán token qua `TokenCounterService` khi LLM provider không trả `usage` trong stream.

---

## 2. API Contract Checklist

| Method | Endpoint | Quyền & Auth | Mô Tả |
|---|---|---|---|
| `POST` | `/chat` | Bearer Token / Dev Bypass | Gửi tin nhắn và nhận phản hồi đồng bộ (Unary) |
| `POST` | `/chat/stream` | Bearer Token / Dev Bypass | Gửi tin nhắn và nhận phản hồi SSE thời gian thực |
| `GET` | `/chat/conversations` | Bearer Token / Dev Bypass | Danh sách cuộc hội thoại của người dùng |
| `GET` | `/chat/conversations/:id` | Bearer Token / Dev Bypass | Chi tiết một cuộc hội thoại |
| `GET` | `/chat/conversations/:id/messages` | Bearer Token / Dev Bypass | Danh sách tin nhắn trong cuộc hội thoại |
| `PATCH` | `/chat/conversations/:id` | Bearer Token / Dev Bypass | Đổi tiêu đề cuộc hội thoại |
| `DELETE` | `/chat/conversations/:id` | Bearer Token / Dev Bypass | Xóa mềm cuộc hội thoại (Soft-delete) |
| `GET` | `/chat/runs/:messageId` | Bearer Token / Dev Bypass | Xem thông tin trace & token usage của tin nhắn |
