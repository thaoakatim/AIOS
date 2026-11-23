# Chat Module — Tài Liệu Kỹ Thuật (Architecture & Implementation)

## 1. Mục Tiêu Kỹ Thuật
Cung cấp hạ tầng xử lý hội thoại theo chuẩn **Clean Architecture**, cô lập hoàn toàn giữa controller, service, repository và core contract. Đảm bảo tính bất biến (Immutable Pipeline), chống lỗi rò rỉ dữ liệu (Anti-IDOR), xử lý giao dịch cơ sở dữ liệu nguyên tử (`$transaction`), và stream token an toàn qua Server-Sent Events với khả năng hủy kết nối qua `AbortSignal`.

---

## 2. Kiến Trúc Tầng & Phân Tách Trách Nhiệm

```text
HTTP Client (REST / SSE)
       │
       ▼
[ChatController] (Routing, SSE Headers, AbortController, @CurrentUser)
       │
       ▼
[ChatService] (Turn Orchestration, IDOR Validation, Budgeting, Fallback)
   ├── [ChatPromptBuilderService] (Context -> LLMMessage[], Token Trimming)
   ├── [LLMGatewayService] (Unified LLM Client: Unary & Stream)
   ├── [CHAT_HOOK_REGISTRY] (Lifecycle Hooks)
   │     ├── [ChatSystemRulesHook]
   │     ├── [ChatContextEnrichmentHook] (Parallel I/O Prefetch)
   │     └── [ChatObservabilityHook] (AgentRun Trace & Metrics)
   └── [ChatRepository] (Prisma DB Transaction, Ownership Isolation)
```

---

## 3. Lược Đồ Dữ Liệu & Ràng Buộc Cơ Sở Dữ Liệu (Prisma)

### 3.1. `Conversation`
- `id`: UUID Primary Key.
- `userId`: UUID, Foreign Key trỏ tới `users.id`.
- `title`: String nullable, tối đa 80 ký tự khi sinh tự động.
- `version`: Int default 1, tăng dần mỗi khi cập nhật hoặc xóa mềm (E2EE Sync).
- `deletedAt`: DateTime nullable (Tombstone).

### 3.2. `Message`
- `id`: UUID Primary Key.
- `conversationId`: UUID, Foreign Key trỏ tới `conversations.id`.
- `role`: 'user' | 'assistant' | 'system' | 'tool'.
- `content`: String, văn bản tin nhắn.
- `version`, `deletedAt`: Phục vụ đồng bộ.
- Ràng buộc sở hữu: Kế thừa thông qua `conversation.userId`.

### 3.3. `AgentRun` (Quan hệ 1:1 với Message)
- `id`: UUID Primary Key (`runId`).
- `messageId`: UUID unique, Foreign Key tới `messages.id`.
- `status`: 'running' | 'completed' | 'failed' | 'cancelled'.
- `totalTokens`: Int nullable.
- `traceLogs`: JSON chứa:
  ```json
  {
    "executionId": "uuid",
    "latencyMs": 450,
    "usage": { "promptTokens": 100, "completionTokens": 35, "totalTokens": 135 },
    "ragChunksCount": 3,
    "memoryKeysCount": 2,
    "warnings": []
  }
  ```

---

## 4. Các Giải Pháp Kỹ Thuật Quan Trọng

### 4.1. Khởi tạo Turn nguyên tử (`$transaction`)
Mọi thao tác tạo hội thoại (nếu mới) + lưu tin nhắn người dùng + tạo `AgentRun` + liên kết `MessageDocument` đều được thực thi bên trong `prisma.$transaction`. Nếu có bất kỳ bước nào thất bại, toàn bộ thao tác sẽ rollback hoàn toàn để không tạo dữ liệu rác.

### 4.2. Khắc phục lỗi Double User Message
Khi lấy lịch sử tin nhắn gần nhất (`listRecentMessages`), repository bắt buộc lọc điều kiện:
`where: { id: { not: excludeMessageId }, conversationId, deletedAt: null }`
giúp tránh việc tin nhắn vừa gửi bị lặp lại trong cả lịch sử lẫn câu hỏi hiện tại.

### 4.3. Pre-flight Validation trước khi mở SSE Headers
Trong `POST /chat/stream`:
1. `prepareChatTurn(dto, user)` chạy trước tiên để validate cú pháp, kiểm tra `conversationId` và xác thực quyền sở hữu `documentIds`.
2. Nếu có lỗi (400 hoặc 404), NestJS sẽ trả về response JSON lỗi HTTP chuẩn.
3. Chỉ sau khi pre-flight thành công, controller mới đặt header `Content-Type: text/event-stream; charset=utf-8` và `res.flushHeaders()`.

### 4.4. Xử lý ngắt kết nối an toàn (`AbortController`)
Khi người dùng đóng tab trình duyệt hoặc hủy request, sự kiện `req.on('close')` sẽ kích hoạt `abortController.abort()`. Vòng lặp stream sẽ thoát ngay lập tức và cập nhật trạng thái `AgentRun` sang `cancelled`.

### 4.5. Parallel I/O Prefetch & Deterministic Merge
`ChatContextEnrichmentHook` thực thi song song:
`Promise.allSettled([this.memoryService.getRelevantMemory(ctx), this.knowledgeService.getRelevantChunks(ctx, { documentIds })])`
giúp giảm 40–50% thời gian chờ trước khi gửi prompt sang LLM Gateway, đồng thời đảm bảo nguyên tắc bất biến bằng cách chỉ tạo bản sao context mới qua `ContextBuilder.from(ctx)`.
