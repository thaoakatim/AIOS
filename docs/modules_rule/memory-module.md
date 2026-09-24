# Memory Module — Tài liệu nghiệp vụ và kỹ thuật

## 1. Mục tiêu của module

Module Memory quản lý trí nhớ dài hạn của hệ thống AI/Agent. Mục tiêu là lưu trữ các dữ kiện cá nhân hóa và ngữ cảnh lâu dài về người dùng, agent, hoặc phiên làm việc, để agent có thể tái sử dụng trong các tương tác sau mà không cần hỏi lại từ đầu.

Nó phục vụ cho 2 nhu cầu chính:

1. Business / product
   - Ghi nhớ thông tin về người dùng: sở thích, lịch sử, profile, quy tắc, sự thật quan trọng.
   - Cung cấp ngữ cảnh cho AI để phản hồi tốt hơn theo thời gian.
   - Tăng tính cá nhân hóa mà không cần mỗi lần chat phải hỏi lại.

2. Technical / system
   - Cung cấp một abstraction cho việc lưu, truy vấn, cập nhật và hồi phục memory.
   - Cho phép agent inject thông tin vào context trước khi gọi LLM.
   - Hỗ trợ tracing provenance: biết memory xuất phát từ session nào.

---

## 2. Vấn đề mà module này giải quyết

Trước khi có module Memory, mỗi phiên chat thường là isolated:

- user hỏi: “Tôi thích màu đen”
- session sau hỏi: “Gợi ý màu cho tôi nên dùng”
- AI không nhớ vì không có memory dài hạn

Module Memory giải quyết bằng cách:

- lưu trữ dưới dạng key-value
- phân loại theo category và scope
- tìm kiếm/truy hồi các memory liên quan
- inject vào prompt/context của agent

---

## 3. Khái niệm chính

### 3.1 MemoryRecord

Memory được lưu trong bảng `memory_records` với các trường chính:

- `id`: UUID duy nhất
- `sourceAgentSessionId`: session nguồn, nullable
- `scope`: phạm vi memory
- `category`: loại memory
- `key`: khóa, đại diện cho tên thông tin
- `value`: giá trị thông tin
- `updatedAt`: thời gian cập nhật gần nhất

### 3.2 Scope

Scope mô tả phạm vi dữ liệu có thể sử dụng:

- `global`: memory dùng chung, ai có thể đọc từ mọi session
- `conversation`: memory chỉ thuộc về một session cụ thể

Ví dụ:

- `global`: “User thích nền tối”, “User làm ở công ty X”
- `conversation`: “Trong cuộc trò chuyện này, user đang thảo luận về dự án A”

### 3.3 Category

Category phân loại memory theo mục đích:

- `profile`: thông tin nhân thân / hồ sơ người dùng
- `preference`: sở thích, ưu tiên
- `fact`: sự thật, thông tin thực tế, sự kiện

Ví dụ:

- `profile`: `location = Hanoi`
- `preference`: `favoriteColor = blue`
- `fact`: `company = AIOS`

### 3.4 Key và Value

Memory theo cấu trúc key-value:

- key: tên thuộc tính
- value: giá trị thực tế

Ví dụ:

```json
{
  "key": "favoriteColor",
  "value": "blue",
  "category": "preference",
  "scope": "global"
}
```

Tại thời điểm inject vào agent context, hệ thống biến đổi thành map như sau:

```json
{
  "favoriteColor": "blue"
}
```

để dễ đưa vào `userProfile`.

---

## 4. Nghiệp vụ kinh doanh

### 4.1 Lưu ký ức mới

Khi agent hoặc user muốn ghi nhớ thông tin mới, hệ thống sẽ:

- validate dữ liệu đầu vào
- chuẩn hóa key/value/category/scope
- kiểm tra trùng key
- tạo mới record nếu chưa tồn tại
- nếu đã có key thì dùng upsert để cập nhật

### 4.2 Upsert theo key

Điểm đặc biệt trong dự án là `upsert` theo `key`.

Cách hiểu:

- key là identity của memory
- nếu key chưa tồn tại → tạo mới
- nếu key đã tồn tại → cập nhật value/category/scope/sourceAgentSessionId

Ví dụ:

```json
{
  "key": "favoriteLanguage",
  "value": "TypeScript",
  "category": "preference",
  "scope": "global"
}
```

Nếu gọi upsert nhiều lần với cùng key thì chỉ giữ 1 bản ghi, giá trị mới sẽ ghi đè giá trị cũ.

### 4.3 Tìm kiếm và lọc

Hệ thống hỗ trợ query theo:

- `scope`
- `category`
- `search`: tìm tương đối trong cả `key` và `value`, không phân biệt hoa/thường
- `sourceAgentSessionId`: lọc theo session nguồn
- phân trang: `limit`, `offset`

Ví dụ các câu hỏi người dùng/agent có thể hỏi:

- “Hiển thị memory của user thuộc global và preference”
- “Tìm ký ức có chứa từ ‘hanoi’”
- “Chỉ lấy memory từ session hiện tại”

### 4.4 Truy hồi liên quan (Recall)

Module có chức năng `recall(query, options)` để tìm memory liên quan đến câu hỏi hiện tại của user.

Đây là phần quan trọng cho AI context building:

- lấy danh sách memory candidate
- chấm điểm theo từ khóa của query và record
- ưu tiên memory có khớp key/value/category
- trả về danh sách memory “phù hợp nhất”

Ví dụ:

- query: “User thích món ăn gì?”
- memory: `favoriteFood = sushi`
- điểm số cao vì key/value có overlap với query

### 4.5 Inject vào context của agent

Sau khi recall, hệ thống có thể tạo ra `userProfile` và `promptSection` để đưa vào prompt của LLM.

Ví dụ:

```json
{
  "userProfile": {
    "favoriteColor": "blue",
    "location": "Hanoi",
    "favoriteFood": "sushi"
  },
  "promptSection": "## Long-term Memory\n- (preference) favoriteColor: blue\n- (profile) location: Hanoi"
}
```

Điều này cho phép agent phản hồi theo ngữ cảnh cá nhân hóa mà không cần hỏi lại mỗi lần.

---

## 5. Luồng dữ liệu trong module

### 5.1 Flow tạo memory

```text
Controller -> Service -> Repository -> Prisma -> MemoryRecord
```

### 5.2 Flow query memory

```text
HTTP Request
  -> Controller
  -> DTO
  -> Service validation/normalization
  -> Repository build Prisma where-clause
  -> Prisma findMany/count
  -> Service map to Memory entity
  -> HTTP Response
```

### 5.3 Flow recall cho AI context

```text
User query
  -> Service.recall()
  -> Repository.findRecallCandidates()
  -> score relevance
  -> top memories
  -> buildUserProfile()
  -> formatMemoryForPrompt()
  -> inject into AgentExecutionContext
```

---

## 6. API contract

### 6.1 POST /memory

Tạo memory mới.

Request body:

```json
{
  "key": "favoriteColor",
  "value": "blue",
  "category": "preference",
  "scope": "global",
  "sourceAgentSessionId": "5b5ec4c8-..."
}
```

Response:

```json
{
  "id": "...",
  "key": "favoriteColor",
  "value": "blue",
  "category": "preference",
  "scope": "global",
  "sourceAgentSessionId": "5b5ec4c8-...",
  "updatedAt": "2026-09-24T00:00:00.000Z"
}
```

### 6.2 POST /memory/upsert

Idempotent upsert theo key.

Mục đích:
- Agent gọi mà không cần biết key đã tồn tại chưa
- giúp “ghi nhớ” có tính lặp lại

### 6.3 GET /memory

Lấy danh sách memory với lọc phân trang.

Query params:

- `scope`
- `category`
- `search`
- `sourceAgentSessionId`
- `limit`
- `offset`

Ví dụ:

```http
GET /memory?scope=global&category=preference&search=blue&limit=20&offset=0
```

Response:

```json
{
  "data": [
    {
      "id": "...",
      "key": "favoriteColor",
      "value": "blue",
      "category": "preference",
      "scope": "global",
      "updatedAt": "2026-09-24T00:00:00.000Z"
    }
  ],
  "total": 1
}
```

### 6.4 GET /memory/relevant

Truy hồi memory liên quan.

Query params:

- `query`
- `sessionId`
- `scope`
- `category`
- `limit`

Ví dụ:

```http
GET /memory/relevant?query=người dùng thích màu gì&sessionId=uuid&limit=10
```

### 6.5 GET /memory/context-profile

Trả về:

- `userProfile`: map key -> value
- `promptSection`: text chuẩn bị chèn vào prompt
- `memories`: danh sách memory gốc

Dùng cho AI context builder hoặc UI debug.

### 6.6 GET /memory/key/:key

Tìm memory theo key.

### 6.7 GET /memory/:id

Lấy memory theo id.

### 6.8 PATCH /memory/:id

Cập nhật record.

### 6.9 DELETE /memory/:id

Xóa record.

---

## 7. Logic validation và business rules

### 7.1 Key

- bắt buộc
- không được rỗng
- trim whitespace

### 7.2 Value

- bắt buộc
- không được rỗng
- trim whitespace

### 7.3 Category

Chỉ cho phép:

- `profile`
- `preference`
- `fact`

### 7.4 Scope

Chỉ cho phép:

- `global`
- `conversation`

### 7.5 Session provenance

`sourceAgentSessionId` là optional, nhưng nếu có thì phải là UUID hợp lệ và phải tồn tại trong `agent_sessions`.

Nếu null hoặc undefined → memory được coi như tạo tay từ dashboard / manual input.

### 7.6 Pagination

- `limit` mặc định: 50
- tối đa: 100
- `offset` mặc định: 0

### 7.7 Recall

- `limit` mặc định: 20
- tối đa: 100
- chỉ lấy candidates phù hợp với session nếu ở scope conversation

---

## 8. Cấu trúc code hiện tại

### 8.1 Controller

- `memory.controller.ts`
- chịu trách nhiệm nhận request HTTP
- map query params vào DTO

### 8.2 DTO

- `dto/create-memory.dto.ts`
- `dto/query-memory.dto.ts`
- `dto/update-memory.dto.ts`

Chịu trách nhiệm định nghĩa input API cho request.

### 8.3 Service

- `memory.service.ts`
- chứa business logic: validate, normalize, recall, build profile, inject context

### 8.4 Repository

- `memory.repository.ts`
- chỉ tương tác với Prisma
- xây dựng `where`, `orderBy`, `take`, `skip`

### 8.5 Entity

- `entities/memory.entity.ts`
- mảnh domain từ prisma model
- chuẩn hóa raw DB object thành entity dùng trong app

### 8.6 Prisma model

`MemoryRecord` trong `schema.prisma`

---

## 9. Mối quan hệ với AgentSession

Memory có trường `sourceAgentSessionId`, cho biết:

- memory này được AI học trong phiên nào
- có thể trace provenance
- session hiện tại có thể đọc memory của chính nó và memory global

Trong `buildRecallWhereClause`:

- nếu không có scope được chỉ định và có `sessionId`
- hệ thống sẽ lấy:
  - tất cả `global`
  - tất cả `conversation` thuộc session hiện tại

Mục tiêu là tránh rò rỉ context giữa các session khác nhau.

---

## 10. Tầm quan trọng với frontend

Team frontend cần biết các điểm sau:

### 10.1 Khi render Memory Board

Frontend sẽ gọi:

```http
GET /memory?scope=global&category=preference&limit=20
```

và hiển thị các field:

- `key`
- `value`
- `category`
- `scope`
- `updatedAt`

### 10.2 Khi tạo memory từ UI

Form cần gửi dữ liệu theo DTO:

```json
{
  "key": "favoriteColor",
  "value": "blue",
  "category": "preference",
  "scope": "global",
  "sourceAgentSessionId": null
}
```

### 10.3 Khi dùng memory như context trong chatbot

Frontend hoặc backend có thể yêu cầu:

```http
GET /memory/context-profile?query=người dùng thích màu gì&sessionId=uuid&limit=10
```

và nhận về:

```json
{
  "userProfile": {
    "favoriteColor": "blue"
  },
  "promptSection": "## Long-term Memory\n- (preference) favoriteColor: blue",
  "memories": []
}
```

### 10.4 Khi cần search

Frontend có thể dùng filter tìm kiếm theo `search`:

```http
GET /memory?search=hanoi
```

### 10.5 Khi cần update / delete

Các hành động thường là:

- patch memory theo `id`
- delete memory theo `id`

---

## 11. Ví dụ thực tế cho frontend

### 11.1 Tạo một memory mới

```ts
await fetch('/memory', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    key: 'favoriteColor',
    value: 'blue',
    category: 'preference',
    scope: 'global',
    sourceAgentSessionId: null,
  }),
});
```

### 11.2 Tìm memory liên quan

```ts
const res = await fetch('/memory/relevant?query=người dùng thích màu gì&limit=5');
const data = await res.json();
```

### 11.3 Lọc memory trên board

```ts
const res = await fetch('/memory?scope=global&category=profile&search=hanoi&limit=20&offset=0');
const data = await res.json();
```

---

## 12. Những lưu ý quan trọng

### 12.1 Không dùng memory như document storage

Memory module không phải là nơi lưu tất cả dữ liệu doanh nghiệp hoặc tài liệu. Nó tập trung vào:

- thông tin cá nhân hóa
- sự thật lâu dài
- preference và profile

### 12.2 Tính idempotent của upsert

Khi dùng key, nền tảng phải đảm bảo không tạo duplicate.

### 12.3 Session privacy

Conversation-scoped memory không được leak sang session khác.

### 12.4 Hệ thống ưu tiên recall bằng relevance score

Nghiệp vụ không chỉ đơn giản là `search` bằng SQL. Nó còn cần rank dựa trên match strength để chọn memory phù hợp nhất.

---

## 13. Tóm tắt ngắn gọn

Module Memory là cơ chế lưu trữ và truy hồi trí nhớ dài hạn cho agent. Nó cho phép hệ thống:

- nhớ preference/profile/fact của user
- query theo scope/category/search
- recall memory liên quan theo câu hỏi hiện tại
- inject memory vào prompt/agent context
- trace memory có được từ session nào

Đây là foundation để app AI trở nên cá nhân hóa, nhất quán và không cần hỏi lại cùng một thông tin nhiều lần.

---

## 14. Bản tóm tắt cho frontend

Nếu frontend muốn triển khai:

- dùng endpoint `/memory` cho list/create/update/delete
- dùng `/memory/relevant` hoặc `/memory/context-profile` cho chatbot context
- lưu `category` và `scope` như enum rõ ràng
- hiển thị `key`/`value` trong table hoặc card UI
- luôn gửi `sourceAgentSessionId` nếu dữ liệu thuộc một session cụ thể
- nếu không chắc, mặc định `scope=global` và `category=profile` hoặc `preference`

---

## 15. Kết luận

Module Memory không chỉ là CRUD đơn giản. Nó là layer tái sử dụng cho trải nghiệm AI cá nhân hóa, cho agent hiểu user đang ở đâu, thích gì, và cần nhớ điều gì trong các phiên tiếp theo. Với tư cách kỹ thuật, nó là một phần quan trọng của memory layer, và với tư cách nghiệp vụ, nó là nền tảng cho trải nghiệm “AI biết bạn hơn”.
