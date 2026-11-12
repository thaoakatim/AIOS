# Knowledge Module — Tài liệu nghiệp vụ và kỹ thuật

## 1. Mục tiêu của module

Module Knowledge quản lý kho tri thức của hệ thống AIOS. Mục tiêu là giúp agent và chat system có khả năng truy cập, hiểu, và sử dụng các tài liệu nội bộ, dữ liệu doanh nghiệp, kiến thức cá nhân, và tài liệu chuyên môn trong quá trình suy luận.

Nó phục vụ cho 2 nhu cầu chính:

1. **Business / Product:**
   - Lưu trữ tài liệu đã upload từ người dùng hoặc hệ thống (phân tách theo `userId`).
   - Cung cấp khả năng tìm kiếm ngữ nghĩa dựa trên nội dung tài liệu (Semantic Search).
   - Cho phép AIOS phản hồi dựa trên nguồn dữ liệu thực, không chỉ suy luận từ lý thuyết (Grounded Answers).
   - Hỗ trợ đồng bộ đa thiết bị an toàn qua mã hóa đầu-cuối (E2EE Sync) và tối ưu chi phí với Smart Vector Sync.

2. **Technical / System:**
   - Tạo pipeline xác định: `Upload` → `Extract text` → `Split chunk` → `Embedding` → `Index (pgvector)` → `Search` → `Retrieve`.
   - Cho phép hệ thống inject context vào `AgentExecutionContext` trước khi gọi LLM thông qua Immutable Hook Pipeline.
   - Sử dụng **PGlite (WASM Embedded Postgres) + extension `pgvector`** chạy nhúng trong tiến trình NestJS trên Desktop (Zero-Daemon, không cần Qdrant binary).
   - Trừu tượng hóa hàng đợi chạy ngầm qua `IJobQueue` (`PgLiteQueueAdapter` trên Desktop, `BullMQ` trên Docker Dev).

---

## 2. Vấn đề mà module này giải quyết

Không phải mọi câu hỏi của người dùng đều có thể trả lời từ trí nhớ ngắn hạn hay lịch sử hội thoại. Nhiều lúc cần truy cập vào:
- Tài liệu PDF, DOCX, Markdown, TXT
- Sơ đồ, quy trình, SOP, ghi chú dự án
- Báo cáo kỹ thuật và hồ sơ nghiên cứu

Nếu hệ thống không có Knowledge Module, AI sẽ thiếu ngữ cảnh thực tế và thường trả lời theo cách tổng quát. Module này giải quyết bằng cách:
- Lưu trữ tài liệu gốc an toàn trong thư mục `userData` theo profile người dùng.
- Phân tích và chia nhỏ thành các `DocumentChunk` có vị trí rõ ràng.
- Vector hóa từng chunk và lưu vào `pgvector` (768 chiều).
- Tìm các chunk phù hợp nhất theo `userId` của câu hỏi và inject vào prompt.

---

## 3. Khái niệm chính & Lược đồ Dữ liệu

### 3.1 Document
Document là tài liệu gốc được người dùng upload. Mỗi document có các trường:
- `id`: UUID duy nhất
- `userId`: ID chủ sở hữu (bắt buộc, ánh xạ từ Keycloak)
- `title`: tiêu đề tài liệu
- `fileType`: loại file (`pdf`, `md`, `txt`, `docx`,...)
- `sourceUrl`: đường dẫn file gốc trong `userData/profile`
- `status`: trạng thái xử lý (`pending`, `processing`, `indexed`, `failed`)
- `embeddingModel`: model nhúng đã sử dụng (phục vụ Smart Vector Sync)
- `version`: số nguyên tăng dần phục vụ E2EE Sync
- `contentHash`: mã SHA-256 hash của file/nội dung
- `deletedAt`: thời điểm xóa mềm (Tombstone cho Sync)
- `createdAt`: thời gian tạo

### 3.2 DocumentChunk
Sau khi trích xuất text, tài liệu được chia nhỏ thành `DocumentChunk`:
- `id`: UUID
- `documentId`: tài liệu gốc mà chunk thuộc về
- `content`: nội dung text của chunk
- `metadata`: thông tin bổ sung (`startOffset`, `endOffset`, page number)
- `embedding`: vector nhúng của chunk (`vector(768)`)
- `embeddingModel`: model nhúng
- `version` & `deletedAt`: phục vụ đồng bộ

### 3.3 MessageDocument
Bảng trung gian liên kết M:N giữa `Message` và `Document`:
- `messageId`
- `documentId`

Giúp hệ thống truy nguyên nguồn tài liệu theo message, phục vụ auditability và trích dẫn grounded response.

### 3.4 Smart Vector Sync
Cơ chế tối ưu khi đồng bộ RAG sang thiết bị mới:
- Client nén mảng nhị phân `Float32Array` vector kèm `embeddingModel` và mã hóa E2EE gửi lên Cloud Sync.
- Thiết bị thứ hai sau khi giải mã sẽ nạp thẳng mảng vector vào `pgvector` local mà không mất chi phí gọi lại API Embedding.

---

## 4. API Contract

Mọi endpoint đều được bảo vệ bởi `AIOSAuthGuard`, tự động lấy `userId` từ token của `@CurrentUser()`.

### 4.1 POST /knowledge/upload
Upload tài liệu và bắt đầu pipeline ingestion:
- **Header:** `Authorization: Bearer <Token>`
- **Body (Multipart):** `file`, `title`, `fileType`, `chunkSize`, `chunkOverlap`, `mode` (`sync` | `queue`), `messageIds`.
- **Response:**
  ```json
  {
    "document": {
      "id": "uuid",
      "userId": "user-uuid",
      "title": "architecture.pdf",
      "status": "pending",
      "version": 1
    },
    "queued": true
  }
  ```

### 4.2 GET /knowledge/search
Tìm kiếm tài liệu ngữ nghĩa:
- **Query params:** `query` (hoặc `q`), `limit`, `minScore`, `documentId`.
- **Logic:** Tự động lọc `userId = currentUser.id` và `deletedAt IS NULL`.

### 4.3 GET /knowledge/context
Lấy context chunk đã format sẵn sàng chèn vào prompt:
- **Query params:** `query`, `limit`.

### 4.4 POST /knowledge/messages/:messageId/documents
Gắn một hoặc nhiều document vào message (Idempotent).

### 4.5 GET /knowledge
Lấy danh sách document của user hiện tại (hỗ trợ phân trang và filter `status`, `fileType`).

### 4.6 DELETE /knowledge/:id
Xóa mềm tài liệu: Gán `deletedAt = now()` và tăng `version` (tạo Tombstone đồng bộ).

---

## 5. Quy tắc Nghiệp vụ & Toàn vẹn Dữ liệu

1. **Ownership Enforcement:** Không bao giờ cho phép người dùng tìm kiếm hoặc đọc tài liệu của `userId` khác. Mọi truy vấn Prisma Repository đều phải bắt buộc:
   ```typescript
   where: { userId: user.id, deletedAt: null }
   ```
2. **Hạ tầng Desktop Zero-Daemon:** Bản Desktop chạy trực tiếp extension `pgvector` bên trong PGlite WASM (`@electric-sql/pglite`), không mở daemon mạng, lưu toàn bộ DB vào thư mục `userData`.
3. **Queue Abstraction (`IJobQueue`):** Không phụ thuộc cứng vào BullMQ/Redis trên Desktop. Tiến trình nền chạy qua `PgLiteQueueAdapter` lưu trạng thái job trong bảng của PGlite.
