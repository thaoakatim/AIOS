# Knowledge Module — Tài liệu nghiệp vụ và kỹ thuật

## 1. Mục tiêu của module

Module Knowledge quản lý kho tri thức của hệ thống AIOS. Mục tiêu là giúp agent và chat system có khả năng truy cập, hiểu, và sử dụng các tài liệu nội bộ, dữ liệu doanh nghiệp, kiến thức cá nhân, và tài liệu chuyên môn trong quá trình suy luận.

Nó phục vụ cho 2 nhu cầu chính:

1. Business / product
   - Lưu trữ tài liệu đã upload từ người dùng hoặc hệ thống.
   - Cung cấp khả năng tìm kiếm ngữ nghĩa dựa trên nội dung tài liệu.
   - Cho phép AIOS phản hồi dựa trên nguồn dữ liệu thực, không chỉ suy luận từ lý thuyết.
   - Tăng khả năng grounded answer và độ tin cậy của câu trả lời.

2. Technical / system
   - Tạo pipeline xác định: upload → extract text → split chunk → embedding → index → search → retrieve.
   - Cho phép hệ thống inject context vào prompt trước khi gọi LLM.
   - Tách biệt rõ ràng giữa storage, retrieval, và business logic.
   - Hỗ trợ tracing và reindex khi tài liệu thay đổi hoặc cần làm mới data.

---

## 2. Vấn đề mà module này giải quyết

Không phải mọi câu hỏi của người dùng đều có thể trả lời từ trí nhớ ngắn hạn hay lịch sử hội thoại. Nhiều lúc cần truy cập vào:

- tài liệu PDF, DOCX, Markdown, TXT,
- sơ đồ, quy trình, SOP,
- hồ sơ dự án,
- tài liệu nội bộ của team,
- ghi chú khảo sát, báo cáo kỹ thuật.

Nếu hệ thống không có Knowledge Module, AI sẽ thiếu ngữ cảnh thực tế và thường trả lời theo cách tổng quát, thiếu định hướng. Module này giải quyết bằng cách:

- lưu trữ tài liệu gốc,
- phân tích nội dung,
- tách thành đoạn nhỏ để dễ truy xuất,
- vector hóa từng chunk,
- tìm các chunk phù hợp theo câu hỏi,
- inject các chunk đó vào prompt để LLM trả lời có căn cứ.

---

## 3. Khái niệm chính

### 3.1 Document

Document là tài liệu gốc được người dùng hoặc hệ thống upload. Mỗi document có các trường chính:

- `id`: UUID duy nhất
- `title`: tiêu đề tài liệu
- `fileType`: loại file (pdf, md, txt, docx,...)
- `sourceUrl`: đường dẫn file gốc trong storage
- `status`: trạng thái xử lý
- `createdAt`: thời gian tạo

### 3.2 DocumentChunk

Sau khi trích xuất text, tài liệu được chia nhỏ thành `DocumentChunk`.

Mỗi chunk chứa:

- `id`: UUID
- `documentId`: tài liệu gốc mà chunk thuộc về
- `content`: nội dung text của chunk
- `metadata`: thông tin bổ sung như page, heading, vị trí, ...
- `embedding`: vector nhúng của chunk

### 3.3 MessageDocument

Bảng trung gian giữa `Message` và `Document`:

- `messageId`
- `documentId`

Mục tiêu là gắn tài liệu với cuộc hội thoại hoặc nội dung cụ thể, giúp hệ thống truy nguyên nguồn tài liệu theo message. Đây là cơ chế rất quan trọng cho auditability và chatbot grounded response.

### 3.4 Retrieval-Augmented Generation (RAG)

Đây là nguyên lý cốt lõi của module Knowledge:

- user hỏi câu hỏi,
- hệ thống tạo embedding cho query,
- tìm các chunk có vector gần nhất,
- lấy top K chunks liên quan,
- đưa các chunk này vào prompt của LLM,
- LLM trả lời có ngữ cảnh dựa trên tri thức đã index.

---

## 4. Nghiệp vụ kinh doanh

### 4.1 Upload tài liệu

Khi người dùng upload tài liệu, hệ thống sẽ:

- validate định dạng file,
- lưu file gốc vào local storage hoặc storage backend,
- tạo record `Document` trong DB,
- đánh dấu `status = pending` hoặc `processing`,
- bắt đầu pipeline ingestion.

### 4.2 Extraction và chunking

Sau khi upload, file được chuyển qua `DocumentProcessorService` để trích xuất text. Text sau đó được chia small chunks bằng `RecursiveTextSplitter`.

Lý do cần chunking:

- giảm kích thước prompt,
- tăng khả năng tìm đúng đoạn văn bản liên quan,
- tránh gửi quá nhiều nội dung không cần thiết cho model,
- thích hợp với vector search.

### 4.3 Embedding và indexing

Mỗi chunk được chuyển thành vector embedding và lưu vào vector store. Việc này cho phép:

- tìm tài liệu theo nghĩa, không chỉ từ khóa,
- trả về top relevant chunks cho câu hỏi của người dùng,
- dễ dùng lại trong nhiều cuộc hội thoại khác nhau.

### 4.4 Search và retrieval

Khi người dùng hỏi một câu liên quan tới file đã upload, hệ thống:

- vector hóa câu hỏi,
- tìm similarity score cao nhất trong vector store,
- trả về top K chunks phù hợp,
- chèn vào context prompt,
- cho model dựa trên ngữ cảnh thực để trả lời.

### 4.5 Gắn tài liệu với message

Một message có thể liên kết với nhiều document, và một document có thể gắn được với nhiều message. Điều này giúp:

- trace source mà câu trả lời dựa trên,
- xác định tài liệu nào đã được dùng cho hội thoại nào,
- tăng khả năng auditability và debug.

### 4.6 Reindex và retry

Nếu tài liệu mới được cập nhật hoặc có lỗi trong quá trình index, hệ thống cho phép chạy lại pipeline với `reindex`. Đây là tính năng quan trọng cho hệ thống sản xuất, nơi cần xử lý dữ liệu thất bại hoặc thay đổi định dạng.

---

## 5. Luồng dữ liệu trong module

### 5.1 Flow upload

```text
Controller -> Service -> Storage -> Repository -> Document record
```

### 5.2 Flow ingestion

```text
Document -> Extract text -> RecursiveTextSplitter -> Embed -> Vector Store -> DB metadata
```

### 5.3 Flow query / search

```text
Query -> Embedding -> Vector similarity search -> Top K chunks -> Inject into prompt -> LLM answer
```

### 5.4 Flow chat-grounded response

```text
User message
  -> Chat/Agent module
  -> KnowledgeService.getRelevantChunks()
  -> Search relevant document chunks
  -> Build RAG context
  -> Send context + prompt to LLM
  -> Return answer with grounded content
```

---

## 6. API contract

### 6.1 POST /knowledge/upload

Upload tài liệu và bắt đầu pipeline ingestion.

Request:

- multipart/form-data
- file: tài liệu
- title: tên tài liệu
- fileType: loại file
- chunkSize: kích thước chunk
- chunkOverlap: sự chồng lấn giữa các chunk
- mode: `sync` hoặc `queue`
- messageIds: danh sách message cần liên kết

Response mẫu:

```json
{
  "document": {
    "id": "uuid",
    "title": "project-spec.pdf",
    "fileType": "pdf",
    "status": "pending"
  },
  "status": "pending",
  "chunkCount": 0,
  "queued": true
}
```

### 6.2 GET /knowledge/search

Tìm kiếm tài liệu theo semantic similarity.

Query params:

- `q` hoặc `query`
- `limit`
- `minScore`
- `documentId`

### 6.3 GET /knowledge/context

Trả về các chunk đã lọc để chèn vào prompt.

Phục vụ cho:

- debug retrieval,
- kiểm tra chất lượng context,
- dựng prompt trong agent.

### 6.4 POST /knowledge/messages/:messageId/documents

Gắn một hoặc nhiều document vào message.

### 6.5 GET /knowledge/:id/chunks

Xem tất cả chunks đã được index của một document.

### 6.6 POST /knowledge/:id/reindex

Chạy lại pipeline indexing cho một document.

### 6.7 GET /knowledge

Lấy danh sách document với filter theo:

- status
- fileType
- search
- limit
- offset

---

## 7. Logic validation và business rules

### 7.1 File validation

- file phải tồn tại
- kích thước hợp lệ
- mime type được hỗ trợ
- không chấp nhận file rỗng

Các định dạng thường hỗ trợ:

- PDF
- DOCX
- DOC
- TXT
- Markdown

### 7.2 Status validation

Document có trạng thái chính:

- `pending`
- `processing`
- `indexed`
- `failed`

### 7.3 Chunking rule

- chunk không nên quá lớn hoặc quá nhỏ
- có overlap giữa các chunk để giữ ngữ cảnh,
- nên ưu tiên cắt ở văn đoạn, câu, xuống dòng thay vì cắt lẻ từng ký tự.

### 7.4 Retrieval rule

- chỉ lấy top K chunks liên quan nhất,
- có thể lọc theo `minScore`,
- không trả về quá nhiều chunk để tránh prompt quá dài.

### 7.5 Message linkage rule

- nếu message không tồn tại thì reject,
- nếu document đã gắn sẵn thì idempotent,
- xóa link khi cần thì dùng `detach` riêng.

### 7.6 Reindex policy

- tài liệu cũ có thể được reindex khi model hoặc chunk strategy thay đổi,
- nếu file gốc bị mất ở storage, system phải báo lỗi rõ ràng và dừng pipeline.

---

## 8. Cấu trúc code hiện tại

### 8.1 Controller

- `knowledge.controller.ts`
- chịu trách nhiệm nhận request API,
- parse kiểu dữ liệu đầu vào,
- gọi service tương ứng.

### 8.2 DTO

- `dto/create-knowledge.dto.ts`
- `dto/query-knowledge.dto.ts`
- `dto/update-knowledge.dto.ts`

Chịu trách nhiệm validate dữ liệu request và định nghĩa schema đầu vào rõ ràng.

### 8.3 Service

- `knowledge.service.ts`
- điều phối toàn bộ pipeline RAG,
- thực hiện validation, upload, extraction, chunking, embedding, indexing, retrieval.

### 8.4 Repository

- `knowledge.repository.ts`
- truy cập Prisma và quản lý các bảng database liên quan đến knowledge.

### 8.5 Worker

- `knowledge.ingestion.worker.ts`
- xử lý background job bằng BullMQ,
- chạy indexing ở nền khi `queue` mode bật.

### 8.6 Utility / service

- `services/recursive-text-splitter.ts`
- chứa thuật toán tách đoạn văn bản theo nguyên tắc đệ quy,
- giúp giữ ngữ nghĩa và giảm tỉ lệ cắt mất context.

### 8.7 Prisma model

KIẾN TRÚC dữ liệu gốc được định nghĩa trong `schema.prisma` với các model:

- `Document`
- `DocumentChunk`
- `MessageDocument`

---

## 9. Mối quan hệ với các module khác

### 9.1 Với Chat module

Knowledge module cung cấp “tri thức thực” cho chat layer. Khi người dùng hỏi, Chat module hoặc agent có thể lấy relevant chunks từ Knowledge để bổ sung vào prompt.

### 9.2 Với Memory module

Memory module lưu dữ liệu cá nhân về user như profile, preference, fact. Knowledge module lưu dữ liệu tài liệu và tri thức dạng văn bản. Hai module bổ sung cho nhau:

- Memory: “AI biết tôi là ai”
- Knowledge: “AI biết tôi đã đọc / đã lưu cái gì”

### 9.3 Với Planner / Workflow

Khi cần hoạt động theo SOP hoặc tài liệu nghiệp vụ, Knowledge module cung cấp nguồn tri thức để lên kế hoạch hoặc ra quyết định.

### 9.4 Với Agents module

Knowledge module hỗ trợ agent trong các flow RAG, giúp agent dùng tài liệu làm nguồn tham khảo khi xử lý task phức tạp.

---

## 10. Tầm quan trọng với frontend

Frontend cần biết các điểm sau:

### 10.1 Khi upload tài liệu

UI phải gửi file qua multipart form-data với route `POST /knowledge/upload`.

### 10.2 Khi hiển thị danh sách tài liệu

Call:

```http
GET /knowledge?status=indexed&limit=20
```

### 10.3 Khi xem chunks / debug retrieval

Call:

```http
GET /knowledge/:id/chunks
```

### 10.4 Khi thực hiện tìm kiếm tri thức

Call:

```http
GET /knowledge/search?q=...&limit=5
```

### 10.5 Khi chèn context vào prompt

Call:

```http
GET /knowledge/context?query=...
```

---

## 11. Ví dụ thực tế cho frontend

### 11.1 Upload tài liệu

```ts
const formData = new FormData();
formData.append('file', file);
formData.append('title', file.name);
formData.append('mode', 'queue');

await fetch('/knowledge/upload', {
  method: 'POST',
  body: formData,
});
```

### 11.2 Tìm kiếm semantic

```ts
const res = await fetch('/knowledge/search?q=AIOS architecture&limit=5');
const data = await res.json();
```

### 11.3 Gắn document với message

```ts
await fetch('/knowledge/messages/message-uuid/documents', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    documentIds: ['doc-1', 'doc-2'],
  }),
});
```

---

## 12. Những lưu ý quan trọng

### 12.1 Không nhầm lẫn với Memory

Knowledge module không phải là Memory module. Memory lưu trữ preference/profile dài hạn, còn Knowledge module lưu trữ tri thức dạng tài liệu, nội dung, báo cáo, và văn bản nguồn cho RAG.

### 12.2 Search là semantic search, không chỉ keyword match

Vector search cho phép tìm mặt nghĩa, không chỉ khớp chính xác một đoạn từ khóa.

### 12.3 Không nên cho prompt quá dài

Việc lấy quá nhiều chunk khiến prompt dài và làm giảm hiệu suất LLM. Nên giới hạn top K và chỉ lấy chunks có điểm phù hợp cao.

### 12.4 Dữ liệu cần theo dõi trạng thái

Tài liệu có trạng thái `pending`, `processing`, `indexed`, `failed`. UI và operator cần theo dõi trạng thái này để đưa ra trải nghiệm tốt hơn.

### 12.5 Reindex là cần thiết khi schema / model thay đổi

Nếu mô hình embedding hoặc chunk strategy thay đổi, cần chạy lại ingestion để dữ liệu mới đồng bộ với chuẩn mới.

---

## 13. Tóm tắt ngắn gọn

Module Knowledge là thành phần trí thức của AIOS. Nó cho phép hệ thống:

- nhận tài liệu từ người dùng,
- trích xuất nội dung,
- chia làm chunk,
- vector hóa,
- truy xuất theo nghĩa,
- đưa context vào prompt,
- trả lời dựa trên tri thức thực tế.

Đây là nền tảng giúp AIOS trở nên có căn cứ, tin cậy hơn, và phù hợp hơn với các công việc cần làm dựa trên dữ liệu doanh nghiệp hoặc tài liệu cá nhân.

---

## 14. Bản tóm tắt cho frontend

Nếu frontend muốn làm việc với Knowledge module, cần hiểu các thao tác cốt lõi:

- upload file qua `/knowledge/upload`
- list document qua `/knowledge`
- search semantic qua `/knowledge/search`
- lấy context qua `/knowledge/context`
- gắn document vào message qua `/knowledge/messages/:messageId/documents`
- reindex qua `/knowledge/:id/reindex`

---

## 15. Kết luận

Module Knowledge không chỉ là một bộ lưu trữ tài liệu. Nó là engine cho Retrieval-Augmented Generation, là cách AIOS “đọc được” và “tra cứu được” các tri thức từ file, dữ liệu, báo cáo, SOP và nội dung dự án. Với việc tích hợp đúng cách, AIOS có thể trở thành hệ thống không chỉ nói tốt, mà còn làm việc dựa trên nguồn tài liệu thực, đáng tin cậy và dễ kiểm chứng.
