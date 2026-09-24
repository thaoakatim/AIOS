# Memory Module — Phiên bản kỹ thuật cho BE/FE và team phát triển

## 1. Mục tiêu kỹ thuật

Module Memory cung cấp tầng lưu trữ, truy vấn và hồi phục dữ liệu dài hạn dưới dạng key-value, phục vụ cho personalization và context injection cho agent. Mục tiêu là tách logic truy xuất dữ liệu khỏi business logic, đồng thời giữ một contract rõ ràng giữa controller, service, repository và database.

---

## 2. Kiến trúc tổng thể

Module Memory hiện có các lớp chính sau:

- Controller: xử lý HTTP route
- DTO: định nghĩa payload/query từ client
- Service: validate + normalize + business logic
- Repository: truy vấn Prisma
- Entity: map từ Prisma model sang domain model
- Prisma model: MemoryRecord

Flow cơ bản:

```text
HTTP request
  -> Controller
  -> DTO
  -> Service
  -> Repository
  -> Prisma
  -> MemoryRecord
  -> Entity (Memory)
  -> Response
```

---

## 3. Model dữ liệu

### 3.1 Prisma model

Memory được lưu trong bảng `memory_records` với cấu trúc:

```prisma
model MemoryRecord {
  id                   String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  sourceAgentSessionId String?  @db.Uuid
  scope                String   @default("global")
  category             String
  key                  String   @unique
  value                String
  updatedAt            DateTime @updatedAt

  sourceAgentSession AgentSession? @relation(fields: [sourceAgentSessionId], references: [id], onDelete: SetNull)

  @@map("memory_records")
}
```

### 3.2 Domain entity

Entity Memory được định nghĩa trong file `entities/memory.entity.ts`:

```ts
export class Memory {
  id!: string;
  sourceAgentSessionId!: string | null;
  scope!: string;
  category!: string;
  key!: string;
  value!: string;
  updatedAt!: Date;

  static fromPrisma(record: MemoryRecord): Memory {
    const entity = new Memory();
    entity.id = record.id;
    entity.sourceAgentSessionId = record.sourceAgentSessionId;
    entity.scope = record.scope;
    entity.category = record.category;
    entity.key = record.key;
    entity.value = record.value;
    entity.updatedAt = record.updatedAt;
    return entity;
  }
}
```

**Mục đích:** che giấu Prisma model khỏi controller/service và chuẩn hóa dữ liệu domain.

---

## 4. DTO và contract giao tiếp

### 4.1 QueryMemoryDto

Dùng cho GET /memory.

```ts
export class QueryMemoryDto {
  scope?: string;
  category?: string;
  search?: string;
  sourceAgentSessionId?: string;
  limit?: number;
  offset?: number;
}
```

### 4.2 RelevantMemoryQueryDto

Dùng cho GET /memory/relevant.

```ts
export class RelevantMemoryQueryDto {
  query?: string;
  sessionId?: string;
  scope?: string;
  category?: string;
  limit?: number;
}
```

### 4.3 CreateMemoryDto / UpdateMemoryDto

Dùng cho request body khi tạo hoặc cập nhật memory.

---

## 5. Service logic

### 5.1 Validation

Service xử lý validation và normalization trước khi gọi repository:

- normalizeKey
- normalizeValue
- normalizeCategory
- normalizeScope
- normalizePagination
- assertUuid
- resolveSourceSession

Ví dụ:

```ts
private normalizeCategory(category: unknown): string {
  if (typeof category !== 'string') {
    throw new BadRequestException(
      `Trường "category" phải là một trong: ${MEMORY_CATEGORIES.join(', ')}.`,
    );
  }

  const normalized = category.trim().toLowerCase();
  if (!(MEMORY_CATEGORIES as readonly string[]).includes(normalized)) {
    throw new BadRequestException(
      `Category "${category}" không hợp lệ. Cho phép: ${MEMORY_CATEGORIES.join(', ')}.`,
    );
  }
  return normalized;
}
```

### 5.2 Upsert

Upsert dựa trên key:

```ts
async upsert(dto: CreateMemoryDto): Promise<{ data: Memory; created: boolean }> {
  const key = this.normalizeKey(dto.key);
  const existing = await this.memoryRepository.findByKey(key);

  if (!existing) {
    const created = await this.create(dto);
    return { data: created, created: true };
  }

  const updated = await this.update(existing.id, {
    value: dto.value,
    category: dto.category,
    scope: dto.scope ?? undefined,
    sourceAgentSessionId: dto.sourceAgentSessionId,
  });
  return { data: updated, created: false };
}
```

### 5.3 Query list

```ts
async findAll(filter: QueryMemoryDto = {}): Promise<MemoryListResult> {
  if (filter.scope !== undefined) this.normalizeScope(filter.scope);
  if (filter.category !== undefined) this.normalizeCategory(filter.category);
  if (filter.sourceAgentSessionId !== undefined) {
    this.assertUuid(filter.sourceAgentSessionId, 'sourceAgentSessionId');
  }

  const { limit, offset } = this.normalizePagination(filter.limit, filter.offset);

  const { records, total } = await this.memoryRepository.findManyAndCount({
    scope: filter.scope === undefined ? undefined : this.normalizeScope(filter.scope),
    category: filter.category === undefined ? undefined : this.normalizeCategory(filter.category),
    search: filter.search,
    sourceAgentSessionId: filter.sourceAgentSessionId,
    take: limit,
    skip: offset,
  });

  return { data: Memory.fromPrismaMany(records), total };
}
```

---

## 6. Repository contract

### 6.1 Interface cho query

```ts
export interface FindMemoriesParams {
  scope?: string;
  category?: string;
  search?: string;
  sourceAgentSessionId?: string;
  take?: number;
  skip?: number;
}
```

### 6.2 Interface cho create/update

```ts
export interface CreateMemoryRecordData {
  key: string;
  value: string;
  category: string;
  scope: string;
  sourceAgentSessionId: string | null;
}

export interface UpdateMemoryRecordData {
  value?: string;
  category?: string;
  scope?: string;
  sourceAgentSessionId?: string | null;
}
```

**Lợi ích:** tách rõ contract giữa service và repository, không để service phụ thuộc Prisma model trực tiếp.

---

## 7. Repository logic

### 7.1 buildListWhereClause

```ts
private buildListWhereClause(params: FindMemoriesParams): Prisma.MemoryRecordWhereInput {
  const where: Prisma.MemoryRecordWhereInput = {};

  if (params.scope !== undefined) where.scope = params.scope;
  if (params.category !== undefined) where.category = params.category;
  if (params.sourceAgentSessionId !== undefined) {
    where.sourceAgentSessionId = params.sourceAgentSessionId;
  }

  const search = params.search?.trim();
  if (search) {
    where.OR = [
      { key: { contains: search, mode: 'insensitive' } },
      { value: { contains: search, mode: 'insensitive' } },
    ];
  }

  return where;
}
```

### 7.2 buildRecallWhereClause

```ts
private buildRecallWhereClause(params: FindRecallCandidatesParams): Prisma.MemoryRecordWhereInput {
  const where: Prisma.MemoryRecordWhereInput = {};

  if (params.category !== undefined) where.category = params.category;
  if (params.scope !== undefined) {
    where.scope = params.scope;
    if (params.scope === 'conversation' && params.sessionId) {
      where.sourceAgentSessionId = params.sessionId;
    }
    return where;
  }

  if (params.sessionId) {
    where.OR = [
      { scope: 'global' },
      { scope: 'conversation', sourceAgentSessionId: params.sessionId },
    ];
  }

  return where;
}
```

**Ý nghĩa:** chặn memory của session khác tràn sang kết quả recall của session hiện tại.

---

## 8. Recall và relevance score

Service có logic đánh giá mức độ liên quan giữa query và memory.

```ts
private scoreRelevance(query: string, record: MemoryRecord): number {
  const queryTokens = this.tokenize(query);
  if (queryTokens.length === 0) return 0;

  const keyTokens = new Set(this.tokenize(record.key));
  const valueTokens = new Set(this.tokenize(record.value));
  const categoryToken = record.category.toLowerCase();

  let score = 0;
  for (const token of queryTokens) {
    if (keyTokens.has(token)) score += 3;
    if (valueTokens.has(token)) score += 1;
    if (categoryToken === token) score += 1;
  }

  if (record.scope === 'global') score += 0.1;
  return score;
}
```

Phương pháp hiện tại là heuristic keyword-overlap, phù hợp cho phase đầu trước khi có vector DB hoặc embedding.

---

## 9. Context injection cho Agent

Service cung cấp các helper:

- buildUserProfile(records)
- formatMemoryForPrompt(records)
- enrichContext(ctx, records)
- injectIntoContext(ctx, options)

Ví dụ:

```ts
buildUserProfile(records: Memory[]): Record<string, unknown> {
  const profile: Record<string, unknown> = {};
  for (const record of records) {
    profile[record.key] = record.value;
  }
  return profile;
}
```

Như vậy, memory được map thành userProfile dạng:

```json
{
  "favoriteColor": "blue",
  "location": "Hanoi"
}
```

Sau đó có thể được merge vào `AgentExecutionContext.context.userProfile`.

---

## 10. Controller route list

### 10.1 POST /memory

Tạo mới memory

### 10.2 POST /memory/upsert

Upsert theo key

### 10.3 GET /memory

Tìm và lọc memory

### 10.4 GET /memory/relevant

Recall memory liên quan

### 10.5 GET /memory/context-profile

Lấy profile + prompt section cho AI context

### 10.6 GET /memory/key/:key

Tìm theo key

### 10.7 GET /memory/:id

Tìm theo id

### 10.8 PATCH /memory/:id

Update memory

### 10.9 DELETE /memory/:id

Xóa memory

---

## 11. Frontend integration guidance

### 11.1 Render memory board

Frontend nên gọi:

```http
GET /memory?scope=global&limit=20
```

và hiển thị các field:

- key
- value
- category
- scope
- updatedAt

### 11.2 Create a memory item

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

### 11.3 Query relevant memory

```ts
const res = await fetch('/memory/relevant?query=người dùng thích màu gì&limit=5');
const data = await res.json();
```

### 11.4 Context profile

```ts
const res = await fetch('/memory/context-profile?query=người dùng ở đâu&sessionId=uuid&limit=10');
const data = await res.json();
```

Frontend có thể dùng `userProfile` để render personalized state hoặc debug panel.

---

## 12. Rủi ro và lưu ý kỹ thuật

### 12.1 Dữ liệu không nên lưu như tài liệu

Memory module không phải repository document, không dùng cho lưu trữ tài liệu lớn, chunking hay embedding document.

### 12.2 Key uniqueness

`key` được đánh dấu unique trong database. Đây là ràng buộc quan trọng cho upsert.

### 12.3 Session privacy

Conversation-scoped memory phải được lọc đúng theo `sourceAgentSessionId` để không bị lẫn giữa các session.

### 12.4 recall là heuristic, không phải vector search

Hiện tại logic dựa trên keyword overlap. Khi hệ thống phát triển, có thể thay bằng vector similarity hoặc semantic retrieval.

---

## 13. Kết luận

Memory Module là layer trung tâm cho personalization và long-term context của agent. Nó nằm giữa UI / API và database, cung cấp cách lưu, tìm, recall và inject memory một cách có cấu trúc và an toàn.

Về mặt kiến trúc, nó thể hiện rõ:

- Controller chỉ nhận request
- Service xử lý business logic
- Repository xử lý Prisma
- Entity chuẩn hóa dữ liệu domain

Về mặt nghiệp vụ, nó làm cho AI có khả năng “nhớ” như một người trợ lý đáng tin cậy.
