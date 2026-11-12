# Memory Module — Tài liệu nghiệp vụ và kỹ thuật

## 1. Mục tiêu của module

Module Memory quản lý trí nhớ dài hạn của hệ thống AI/Agent. Mục tiêu là lưu trữ các dữ kiện cá nhân hóa và ngữ cảnh lâu dài về người dùng, agent, hoặc phiên làm việc, để agent có thể tái sử dụng trong các tương tác sau mà không cần hỏi lại từ đầu.

Nó phục vụ cho 2 nhu cầu chính:

1. **Business / Product:**
   - Ghi nhớ thông tin cá nhân hóa của người dùng: sở thích, profile, quy tắc, dự án, sự thật quan trọng.
   - Cung cấp ngữ cảnh cho AI để phản hồi thông minh và phù hợp hơn theo thời gian.
   - Hỗ trợ cô lập ký ức tuyệt đối theo `userId` và đồng bộ an toàn qua E2EE Sync.

2. **Technical / System:**
   - Cung cấp một abstraction chuẩn cho việc lưu, truy vấn, cập nhật và hồi phục memory.
   - Tích hợp với `AgentExecutionContext` thông qua hook `onBeforePromptBuild` để inject ký ức vào prompt.
   - Hỗ trợ tracing provenance: biết memory xuất phát từ `sourceAgentSessionId` nào.

---

## 2. Vấn đề mà module này giải quyết

Trước khi có module Memory, mỗi phiên chat thường bị cô lập (isolated):
- User nói: *"Tôi thích code TypeScript và ghét dùng dấu chấm phẩy"*
- Phiên làm việc sau: AI không nhớ và tiếp tục viết JavaScript hoặc hỏi lại phong cách code.

Module Memory giải quyết bằng cách:
- Lưu trữ dưới dạng key-value gắn với `userId`.
- Phân loại theo category (`profile`, `preference`, `fact`) và scope (`global`, `conversation`).
- Tìm kiếm và xếp hạng độ liên quan (Relevance Scoring) theo câu hỏi.
- Inject vào prompt của agent một cách tự động.

---

## 3. Khái niệm chính & Lược đồ Dữ liệu

### 3.1 MemoryRecord
Memory được lưu trong bảng `memory_records` với các trường chính:
- `id`: UUID duy nhất
- `userId`: ID người dùng sở hữu ký ức (bắt buộc, FK tham chiếu `users.id`)
- `sourceAgentSessionId`: session nguồn mà AI đã học ký ức này (nullable)
- `scope`: phạm vi memory (`global`, `conversation`)
- `category`: loại memory (`profile`, `preference`, `fact`)
- `key`: tên thuộc tính (khóa định danh)
- `value`: giá trị thông tin
- `version`: số nguyên tăng dần phục vụ E2EE Sync
- `contentHash`: hash SHA-256
- `deletedAt`: thời điểm xóa mềm (Tombstone phục vụ Sync)
- `updatedAt`: thời gian cập nhật

> [!IMPORTANT]
> **Ràng buộc duy nhất (Unique Constraint):**  
> Khóa duy nhất được định nghĩa là `@@unique([userId, key])`. Điều này cho phép nhiều người dùng khác nhau cùng sở hữu key giống nhau (ví dụ: `favoriteColor`), nhưng một người dùng cụ thể không bao giờ bị trùng lặp key.

### 3.2 Phân loại Scope & Category
* **Scope:**
  - `global`: Ký ức dùng chung cho toàn bộ các cuộc hội thoại của người dùng đó.
  - `conversation`: Ký ức chỉ có hiệu lực trong phạm vi một session cụ thể.
* **Category:**
  - `profile`: Thông tin nhân thân (vị trí, nghề nghiệp, công ty).
  - `preference`: Sở thích cá nhân, phong cách viết code, tone giọng ưa thích.
  - `fact`: Sự thật khách quan, sự kiện dự án.

---

## 4. API Contract

Mọi endpoint đều được bảo vệ bởi `AIOSAuthGuard`, tự động lấy `userId` từ `@CurrentUser()`.

### 4.1 POST /memory
Tạo mới một memory:
- **Header:** `Authorization: Bearer <Token>`
- **Body:**
  ```json
  {
    "key": "favoriteLanguage",
    "value": "TypeScript",
    "category": "preference",
    "scope": "global",
    "sourceAgentSessionId": null
  }
  ```

### 4.2 POST /memory/upsert
Upsert theo cặp `(userId, key)`:
- Nếu user chưa có key này: Tạo mới record (`version = 1`).
- Nếu user đã có key: Cập nhật `value`, `category`, tăng `version = version + 1`, reset `deletedAt = null`.

### 4.3 GET /memory
Lấy danh sách ký ức của user (lọc theo `category`, `scope`, `search`, phân trang `limit`, `offset`). Luôn tự động kèm điều kiện `userId = currentUser.id` và `deletedAt IS NULL`.

### 4.4 GET /memory/relevant
Truy hồi các ký ức có điểm liên quan cao nhất với câu hỏi:
- **Query params:** `query`, `sessionId`, `limit`.

### 4.5 GET /memory/context-profile
Tổng hợp memory thành object key-value và đoạn text Markdown chuẩn bị inject vào prompt của LLM.

### 4.6 DELETE /memory/:id
Xóa mềm ký ức: Gán `deletedAt = now()` và tăng `version` (tạo Tombstone cho E2EE Sync).

---

## 5. Quy tắc Nghiệp vụ Cốt lõi

1. **Cô lập Dữ liệu Người dùng (Data Isolation):**
   Tuyệt đối không để rò rỉ ký ức của User A sang User B. Mọi câu lệnh SQL/Prisma đều phải chứa `where: { userId: user.id, deletedAt: null }`.
2. **Bảo tồn Ký ức khi xóa Session:**
   Khi xóa `agent_sessions`, các `memory_records` được học từ session đó vẫn được giữ lại, trường `sourceAgentSessionId` tự động set về `NULL`.
3. **Inject Bất biến vào Chu trình Agent:**
   Phương thức `getRelevantMemory(query, userId)` được gọi trong hook `onBeforePromptBuild` để làm giàu đối tượng `AgentExecutionContext` theo mô hình Functional Pipeline mà không gây mutate trạng thái ngầm.
