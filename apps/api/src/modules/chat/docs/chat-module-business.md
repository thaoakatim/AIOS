# Chat Module — Tài Liệu Nghiệp Vụ (Business & Product)

## 1. Mục Tiêu của Module
Chat Module là **cánh cổng tương tác chính (Primary Entrypoint)** của hệ điều hành AIOS (Personal AI Operating System). Lấy kiến trúc **Message-Centric Design** làm trung tâm, mọi hành động suy luận, trích xuất dữ liệu từ tri thức (RAG), truy hồi ký ức cá nhân, hay quan sát tiến trình Agent đều xuất phát từ luồng tin nhắn hội thoại.

Mục tiêu chính:
1. **Trải nghiệm tương tác thời gian thực:** Cung cấp khả năng phản hồi tức thời qua Server-Sent Events (SSE Streaming token-by-token), giảm thời gian chờ đợi phản hồi đầu tiên (Time To First Token - TTFT).
2. **Cá nhân hóa & Trả lời có căn cứ (Grounded Personalization):** Tự động nạp sở thích, thói quen từ `MemoryModule` và tài liệu tri thức cá nhân từ `KnowledgeModule` (RAG) vào câu trả lời của AI.
3. **Bảo mật tuyệt đối (Multi-tenant Ownership & Zero-Trust):** Đảm bảo mỗi người dùng chỉ có thể xem, nhắn tin và truy cập vào các cuộc hội thoại và tài liệu thuộc sở hữu của chính mình.
4. **Minh bạch & Đo lường (Observability):** Tự động ghi nhận chi phí token, thời gian xử lý và lịch sử hoạt động vào `AgentRun` cho từng câu hỏi.

---

## 2. Vấn Đề Mà Module Này Giải Quyết

Trước khi có Chat Module hoàn chỉnh:
- Hệ thống chỉ có các module thành phần riêng lẻ (`Memory`, `Knowledge`, `Auth`) mà thiếu đi cơ chế điều phối thống nhất để tạo ra một câu trả lời hoàn chỉnh.
- Nguy cơ lộ lọt dữ liệu (IDOR) nếu người dùng có thể đoán `conversationId` hoặc đính kèm tài liệu của người khác.
- Lỗi trùng lặp câu hỏi (Double User Message) hoặc mất câu trả lời khi đường truyền mạng bị ngắt.

Chat Module giải quyết triệt để:
- **Tự động hóa toàn bộ vòng đời hội thoại:** Tự tạo cuộc hội thoại mới khi chưa có, trích xuất tiêu đề thông minh từ nội dung câu hỏi đầu tiên.
- **Xác thực quyền sở hữu đa tầng (Zero-Trust):** Kiểm tra quyền sở hữu đối với cả cuộc hội thoại và danh sách tài liệu đính kèm trước khi bắt đầu xử lý.
- **Khả năng tự phục hồi (Graceful Degradation):** Khi kho tri thức hoặc bộ nhớ tạm thời gặp sự cố, AI vẫn phản hồi thông minh dựa trên lịch sử trò chuyện thay vì báo lỗi hệ thống.

---

## 3. Khái Niệm Nghiệp Vụ Cốt Lõi

### 3.1. Conversation (Cuộc hội thoại)
Là một chuỗi các lượt trao đổi qua lại giữa người dùng và AIOS xoay quanh một chủ đề hoặc dự án cụ thể.
- Thuộc quyền sở hữu của 01 người dùng duy nhất (`userId`).
- Có tiêu đề tóm tắt (sinh tự động hoặc người dùng tự đổi).
- Hỗ trợ xóa mềm (Soft-delete / Tombstone) để phục vụ đồng bộ mã hóa đầu cuối (E2EE Sync).

### 3.2. Message (Tin nhắn)
Thực thể trung tâm mang nội dung trao đổi:
- **Role:** `user` (người dùng), `assistant` (AI phản hồi), `system` (chỉ thị hệ thống).
- Kế thừa quyền sở hữu từ cuộc hội thoại chứa nó.
- Có thể đính kèm nhiều tài liệu tri thức (`documentIds`).

### 3.3. AgentRun (Lượt chạy quan sát)
Bản ghi đo lường gắn với từng câu hỏi của người dùng:
- Đo lường thời gian phản hồi (latency tính bằng mili-giây).
- Thống kê chi tiết token (`promptTokens`, `completionTokens`, `totalTokens`).
- Lưu trữ trạng thái: `running` (đang xử lý) → `completed` (hoàn tất), `cancelled` (người dùng ngắt kết nối), hoặc `failed` (lỗi hệ thống).

---

## 4. Giao Thức Tương Tác Phía Client (Frontend / Mobile / Desktop)

### 4.1. Gửi tin nhắn đồng bộ (`POST /chat`)
Dành cho các tác vụ cần câu trả lời trọn gói một lần.
- **Payload:** `{ "conversationId"?: "uuid", "content": "Tóm tắt tài liệu đính kèm", "documentIds"?: ["uuid"] }`
- **Response:**
  ```json
  {
    "conversationId": "22222222-2222-4222-8222-222222222222",
    "userMessageId": "33333333-3333-4333-8333-333333333333",
    "assistantMessage": {
      "id": "44444444-4444-4444-8444-444444444444",
      "role": "assistant",
      "content": "Dưới đây là tóm tắt..."
    },
    "runId": "55555555-5555-4555-8555-555555555555",
    "usage": { "promptTokens": 120, "completionTokens": 45, "totalTokens": 165 }
  }
  ```

### 4.2. Gửi tin nhắn thời gian thực (`POST /chat/stream` qua Server-Sent Events)
Dành cho giao diện chat gõ chữ từng token (typewriter effect).
- **Chuỗi sự kiện SSE:**
  1. `meta`: Gửi ngay khi mở kết nối để Frontend có thể hiển thị cuộc hội thoại và cập nhật sidebar/URL ngay lập tức:
     `data: {"type":"meta","conversationId":"...","userMessageId":"...","runId":"..."}`
  2. `token`: Gửi liên tục từng mảnh văn bản:
     `data: {"type":"token","content":"Xin chào "}`
     `data: {"type":"token","content":"tôi là AIOS"}`
  3. `done`: Báo hiệu hoàn tất lượt trả lời kèm thống kê token:
     `data: {"type":"done","conversationId":"...","messageId":"...","runId":"...","usage":{"promptTokens":100,"completionTokens":30,"totalTokens":130}}`
  4. `error`: Gửi khi có lỗi phát sinh giữa chừng trong quá trình stream:
     `data: {"type":"error","code":"STREAM_FAILED","error":"..."}`
