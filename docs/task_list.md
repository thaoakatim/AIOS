# 📋 AIOS Master Implementation Tasklist

Dự án **AIOS (Personal AI Operating System)** được thiết kế theo **Clean Architecture & Modular Monolith**, lấy **`Message` làm trung tâm điều phối (Message-Centric Design)**. 

* **Product Topology:** Gồm Web App, Electron Desktop App và NestJS Local Companion dùng chung business API.
* **Local Data Engine:** Sử dụng **PGlite (WASM Embedded Postgres) + bundled `pgvector`** (Zero-Daemon trên Desktop).
* **Identity & Sync:** Keycloak xử lý identity; Sync API chỉ lưu ciphertext (Sync Envelopes - E2EE).
* **Tài liệu tham khảo:** [docs/architecture.md](file:///Users/thaonh21/AIOS/docs/architecture.md) và [docs/plan/architecture-web-desktop-local-companion.md](file:///Users/thaonh21/AIOS/docs/plan/architecture-web-desktop-local-companion.md).

---

## 🔹 Phase 1: Khởi tạo Nền tảng Dữ liệu & Hợp đồng Cốt lõi (Sprint 0 - Foundations)

> **Mục tiêu:** Hoàn thiện Database Schema (Prisma 15 bảng qua 8 modules cốt lõi), kết nối PostgreSQL và dựng các Interface/Context cốt lõi độc lập thư viện ngoài. Docker Compose dùng cho môi trường development; đích đến của Desktop Production là **PGlite + `pgvector`** chạy nhúng trong tiến trình NestJS.

- [x] **Task 0.1: Hạ tầng Docker & Cấu hình Môi trường**
  - Đã có: `docker/docker-compose.yml`, `docker/init-db/01-init.sql`, `docker/.env`.
  - Port mapping tránh xung đột cho development: PostgreSQL (`5433:5432`), Redis (`6378:6379`), Qdrant (`6333`), Adminer (`8080`). Đây là môi trường dev; bản desktop dùng PGlite zero-daemon.
  - Đã cấu hình `.npmrc` cấp quyền build cho pnpm v10+ (`onlyBuiltDependencies`).

- [x] **Task 0.2: Cài đặt Prisma ORM & Triển khai Schema Database Cơ sở**
  - [x] Thiết kế xong Master ERD chuẩn hóa 8 modules (15 bảng cơ sở).
  - [x] Cài đặt Prisma 6.19.3 (bản Stable tương thích NestJS 11).
  - [x] Viết và validate thành công `apps/api/prisma/schema.prisma`:
    - **Auth & Identity:** `User` (Owner, liên kết Keycloak Subject)
    - **Chat:** `Conversation`, `Message`
    - **Agents:** `AgentConfig`, `AgentSession`, `AgentRun`
    - **Knowledge (RAG):** `Document`, `MessageDocument` (M:N), `DocumentChunk` (`pgvector` 768)
    - **Tools:** `ToolExecution`
    - **Workflow:** `Workflow`, `WorkflowStep`
    - **Planner:** `Plan`, `Task` (Sub-task self-relation)
    - **Memory:** `MemoryRecord` (Ký ức Global/Scoped kèm `sourceAgentSessionId` phục vụ truy vết và `@@unique([userId, key])`)
  - [x] Chạy `pnpm exec prisma migrate dev --name init` tạo bảng trên PostgreSQL thực tế.
  - [x] Viết `apps/api/src/infrastructure/database/prisma.service.ts` kết nối NestJS Lifecycle (`onModuleInit`, `onModuleDestroy`) và `PrismaModule`.

- [x] **Task 0.3: Xây dựng Thư viện Dùng chung (`packages/shared-types`)**
  - Khởi tạo package `shared-types` trong `packages/` (DTOs, Enums, API Request/Response) để dùng chung cho cả `api` và `web`.
  - [x] Bổ sung module `user` (`IUser`, `DEFAULT_LOCAL_USER`, `DEFAULT_LOCAL_USER_ID`).
  - [x] Chuẩn hóa các trường E2EE sync (`version`, `contentHash`, `deletedAt`, `embeddingModel`, `userId`) vào `IDocument`, `IDocumentChunk`, `IMemoryRecord`.

- [x] **Task 0.4: Tầng Core Contracts (Trừu tượng hóa kiểu Caremate)**
  - `apps/api/src/core/context/agent-context.interface.ts`: Định nghĩa `AgentExecutionContext` (đối tượng bất biến `readonly` mang toàn bộ ngữ cảnh thực thi, chứa `readonly userId: string`).
  - `apps/api/src/core/context/context-builder.ts`: Hiện thực Builder Pattern tạo lập và nhân bản context bất biến (`ContextBuilder.from(ctx)`).
  - `apps/api/src/core/hooks/`: Định nghĩa `AIOSHookHandler` (`onBeforePromptBuild` dạng Immutable Pipeline, `onBeforeToolExecution`, `onAfterToolExecution`, `onAfterCompletion`) & `HookRegistry`.
  - `apps/api/src/core/queue/job-queue.interface.ts`: Hợp đồng trừu tượng hóa hàng đợi nền `IJobQueue` độc lập hạ tầng.
  - `apps/api/src/core/llm/interfaces/`: Định nghĩa `ILLMClient`, `LLMMessage`, `StreamingChunk`, `TokenUsage`.
  - `apps/api/src/core/observability/`: Định nghĩa Interface Tracing & Logger.
  - *DoD:* Core code độc lập 100% với SDK bên ngoài.

---

## 🔹 Phase 2: LLM Gateway & Hạ tầng Adapters (Sprint 1 - Anti-Corruption Layer)

> **Mục tiêu:** Xây dựng cổng giao tiếp LLM đa nhà cung cấp và các Adapter kết nối Vector Store / Queue / Storage.

- [x] **Task 1.1: LLM Gateway & Provider Adapters (`core/llm` & `infrastructure/llm-providers`)**
  - Hiện thực `LLMClientFactory` và `OpenAIAdapter` / `GeminiAdapter` / `OllamaAdapter` kế thừa `ILLMClient`.
  - Hiện thực luồng Streaming Token (AsyncIterable → Server-Sent Events).
  - `TokenCounterService`: Đếm token và ước lượng chi phí context window.

- [x] **Task 1.2: Vector Store Adapter (`infrastructure/vector-store`)**
  - Interface `IVectorStore` (`upsert`, `searchSimilarity`, `delete`).
  - Hiện thực `PgVectorAdapter` (dùng extension `pgvector` của Postgres/PGlite) và `QdrantAdapter` (kết nối Qdrant REST/gRPC). Theo quyết định kiến trúc mới nhất, **`PgVectorAdapter` chạy trên PGlite là đích mặc định cho Desktop** (Zero-Daemon); `QdrantAdapter` được giữ làm adapter tùy chọn cho môi trường Dev/Cloud.

- [x] **Task 1.3: Queue & Storage Adapters (`infrastructure/`)**
  - `RedisService` & **BullMQ** cho môi trường dev. Đã trừu tượng hóa qua `IJobQueue` tại `core/queue/job-queue.interface.ts` (Task 2.2.5); `QueueService` hiện thực `IJobQueue`. Giai đoạn Desktop Production (Phase 8) sẽ cắm thêm `PgLiteQueueAdapter` để loại bỏ hoàn toàn phụ thuộc Redis.
  - `LocalStorageService`: Hiện lưu file upload theo `LOCAL_STORAGE_PATH`, mặc định `./data/storage` cho development. Desktop production sẽ cấu hình data root bền vững trong OS application data directory (`app.getPath('userData')`), tách khỏi thư mục cài đặt.

---

## 🔹 Phase 3: Các Module Nghiệp vụ Cốt lõi, Auth & Chuẩn hóa Schema (Sprint 2 - Memory, RAG, Auth, Chat)

> **Mục tiêu:** Chatbot thông minh có khả năng nhớ sở thích, tra cứu tài liệu cá nhân và có sẵn `AuthModule` + Multi-user Ownership/Sync Schema ngay từ tầng nền tảng.

- [x] **Task 2.1: Memory Module (`modules/memory`)**
  - CRUD Ký ức dài hạn (`MemoryRecord`: User Profile, Preferences, Project Facts) lưu vào PostgreSQL.
  - Cung cấp method `getRelevantMemory(ctx)` để inject vào `AgentExecutionContext`.
  - Tích hợp ghi nhận nguồn gốc thông qua `sourceAgentSessionId`.
  - Đã cập nhật `MemoryRepository` và `MemoryService` theo `userId`, ràng buộc phức hợp `@@unique([userId, key])`, và phương thức `enrichContext` dùng `ContextBuilder` đảm bảo tính bất biến.
  - Đầy đủ tài liệu nghiệp vụ và kỹ thuật: [apps/api/src/modules/memory/docs/memory-module-business.md](file:///Users/thaonh21/AIOS/apps/api/src/modules/memory/docs/memory-module-business.md) và [apps/api/src/modules/memory/docs/memory-module-technical.md](file:///Users/thaonh21/AIOS/apps/api/src/modules/memory/docs/memory-module-technical.md).

- [x] **Task 2.2: Knowledge & RAG Module (`modules/knowledge`)**
  - **Pipeline:** `POST /knowledge/upload` → Lưu file (`LocalStorageService`) → Text Extraction (`DocumentProcessorService`) → Chunking (`RecursiveTextSplitter`) → Embedding (`EmbeddingGatewayService`) → Lưu Vector Store (`IVectorStore`).
    - `core/llm/interfaces/embedding.interface.ts`: Hợp đồng `IEmbeddingClient` (core độc lập 100% với SDK).
    - `core/llm/embedding-gateway.service.ts`: Cổng Embedding đa provider, tự chia batch, mặc định 768 chiều (khớp cột `embedding vector(768)` của `document_chunks` trong Postgres/PGlite).
    - `infrastructure/embedding/`: `EmbeddingClientFactory` + adapter `OpenAI` / `Gemini` / `Ollama`.
    - `modules/knowledge/services/recursive-text-splitter.ts`: Tách đệ quy theo separator, giữ `chunkOverlap` và sinh `startOffset`/`endOffset` để trích dẫn nguồn.
    - `KnowledgeIngestionWorker`: Chạy pipeline nền khi `KNOWLEDGE_PROCESSING_MODE=queue`; mặc định `sync` xử lý ngay trong request.
  - **Endpoint `GET /knowledge/search` (Semantic Search):** query → embedding → cosine similarity → hydrate nội dung/tiêu đề tài liệu từ PostgreSQL/PGlite. Hỗ trợ `limit`, `minScore`, `documentId`.
  - **Gắn kết nhiều tài liệu vào tin nhắn (`MessageDocument`):**
    - `POST /knowledge/messages/:messageId/documents` (idempotent, `skipDuplicates`) · `GET` · `DELETE /knowledge/messages/:messageId/documents/:documentId`.
    - `messageIds` kèm theo khi upload để đính kèm ngay tài liệu vào tin nhắn.
  - **Bổ sung:** `GET /knowledge/context` (RAG context sẵn sàng chèn prompt) · `GET /knowledge/:id/chunks` · `POST /knowledge/:id/reindex` · `GET /knowledge/stats`.
  - **Điểm tích hợp cho Task 2.3:** `getRelevantChunks(ctx)` và `injectIntoContext(ctx)` nạp `ctx.prefetch.ragChunks` (tương xứng với `MemoryService.getRelevantMemory`). Khi Vector Store/Embedding lỗi, service trả `[]` và ghi cảnh báo để chat vẫn hoạt động bằng Memory + Chat History.
  - Đã cập nhật `KnowledgeRepository` lưu `userId` và hỗ trợ các trường sync E2EE (`version`, `contentHash`, `deletedAt`, `embeddingModel`).
  - Đầy đủ tài liệu nghiệp vụ và kỹ thuật: [apps/api/src/modules/knowledge/docs/business.md](file:///Users/thaonh21/AIOS/apps/api/src/modules/knowledge/docs/business.md) và [apps/api/src/modules/knowledge/docs/technique.md](file:///Users/thaonh21/AIOS/apps/api/src/modules/knowledge/docs/technique.md).
  - *DoD:* 104 unit test xanh; `tsc`/`eslint`/`nest build` sạch; `KnowledgeRepository` là nơi duy nhất chạm Prisma.

- [x] **Task 2.2.5: [URGENT REFACTOR] Chuẩn hóa Ownership, Sync Fields, Immutable Hook & Queue Abstraction (Làm ngay trước Auth & Chat)**
  > [!IMPORTANT]
  > **Lý do:** Đưa bảng `User`, `userId`, `version` và `deletedAt` (Tombstone) vào Schema và Core Contracts ngay lúc này để `AuthModule` và các module từ Task 2.3 trở đi không bị nợ kỹ thuật.
  - **Cập nhật Prisma Schema (`apps/api/prisma/schema.prisma`):**
    - [x] Thêm bảng `User` (`id` UUID, `keycloakSubject` unique nullable cho local dev seed, `email`, `displayName`, `emailVerified`, timestamps).
    - [x] Thêm `userId` (Owner) vào các aggregate gốc: `Document`, `Conversation`, `MemoryRecord` (đổi unique thành `@@unique([userId, key])`), `Plan`, `Workflow`.
    - [x] Thêm các trường phục vụ E2EE Sync vào các bảng cốt lõi (`Document`, `DocumentChunk`, `Conversation`, `Message`, `MemoryRecord`, `Plan`, `Task`, `Workflow`): `version Int @default(1)`, `contentHash String?`, và `deletedAt DateTime?` (Soft-delete / Tombstone).
    - [x] Bổ sung metadata `embeddingModel String?` vào `Document` / `DocumentChunk` (giữ cột `embedding vector(768)` cho `pgvector` của Postgres/PGlite) để phục vụ cơ chế Smart Vector Sync.
    - [x] Viết migration mới (`20261117103000_add_ownership_and_sync_fields`).
  - **Cập nhật Core Contracts (`apps/api/src/core/`):**
    - [x] Bổ sung `readonly userId: string;` vào gốc của `AgentExecutionContext`.
    - [x] Sửa chữ ký `onBeforePromptBuild?(ctx: AgentExecutionContext): Promise<AgentExecutionContext>` trong `AIOSHookHandler` để đảm bảo tính bất biến thực sự (Immutable Pipeline), cập nhật `ContextBuilder` và `HookRegistry`.
    - [x] Tạo interface `IJobQueue` tại `core/queue/` để trừu tượng hóa hàng đợi; `QueueService` hiện thực `IJobQueue`.
  - *DoD:* 121 unit tests xanh 100%; `pnpm build` (shared-types, api, web) sạch sẽ; schema sẵn sàng cho Task 2.2.6 (`AuthModule`).

- [ ] **Task 2.2.6: Xây dựng Auth Module & Dual-Mode Guard (`modules/auth`)**
  > **Mục tiêu:** Xây dựng cổng xác thực và quản lý `User` projection ngay tại backend để toàn bộ Controller/Service của `Memory`, `Knowledge`, `Chat`, `Planner`, `Workflow` đều dùng chung `@CurrentUser()` và `AuthGuard` một cách thống nhất.
  - **Cấu trúc `apps/api/src/modules/auth/`:**
    - `UserRepository` & `AuthService`: Quản lý projection bảng `User` (tìm theo `id`, `keycloakSubject`, tự động provision/upsert `User` từ JWT claims đã xác thực, hoặc khởi tạo/lấy `Default Local User` khi chạy môi trường dev). Không lưu mật khẩu, không có role admin.
    - `KeycloakJwtVerifier`: Xác thực Access Token bằng JWKS endpoint, kiểm tra `iss` (issuer), `aud` (audience), `exp` và `scope`.
    - `AIOSAuthGuard` (Global `APP_GUARD`) hỗ trợ 2 chế độ qua biến môi trường `AUTH_MODE`:
      - `keycloak` (Mặc định cho Prod/Staging): Bắt buộc Bearer JWT hợp lệ từ Keycloak (hoặc Scoped Companion Token), upsert `User` từ `sub` và gắn vào `request.user`.
      - `dev_bypass` (Chỉ dùng cho Local Dev khi chưa bật Keycloak): Tự động resolve `Default Local User` đã seed sẵn và gắn vào `request.user` (cấm tuyệt đối tin tưởng `userId` gửi từ body/query của client).
    - Decorators chuẩn: `@CurrentUser()` (lấy thông tin `AuthenticatedUser` gắn vào Controller và truyền `user.id` vào `AgentExecutionContext`), `@Public()` (cho các route health-check/pairing).
    - Endpoints: `GET /auth/me` (trả về profile `User` hiện tại + trạng thái auth mode) và `POST /auth/logout` (xóa session/token local nếu có).
  - **Áp dụng ngay vào `MemoryModule` & `KnowledgeModule`:**
    - Gắn `@CurrentUser()` vào `MemoryController` và `KnowledgeController`; truyền `userId` xuống Service & Repository (kèm điều kiện lọc `deletedAt: null`).
  - *DoD:* Unit tests cho `AuthService`, `AIOSAuthGuard` (cả chế độ `keycloak` với mock JWKS: token hợp lệ, thiếu, hết hạn, sai issuer/audience lẫn chế độ `dev_bypass`); toàn bộ unit tests của `Memory` và `Knowledge` xanh 100% với `userId`.

- [ ] **Task 2.3: Chat Module hoàn chỉnh (`modules/chat`)**
  - Endpoint `POST /chat` và `POST /chat/stream` (SSE Streaming), nhận `user` từ `@CurrentUser()` và gắn `user.id` vào `Conversation` cũng như `AgentExecutionContext`.
  - Kết hợp `ContextBuilder`: Gom System Rules + Chat History + Prefetched Memory + RAG Chunks (theo đúng `ctx.userId`) thông qua chuỗi Immutable Hook (`ctx = await hookRegistry.runBeforePromptBuild(ctx)`).
  - Tích hợp Lifecycle Hooks (`onBeforePromptBuild`, `onAfterCompletion` ghi nhận Trace vào `AgentRun`).

---

## 🔹 Phase 4: Kế hoạch & Công cụ Mở rộng (Sprint 3 - Planner, Tools & MCP)

> **Mục tiêu:** AI có khả năng quản lý công việc và tương tác ra thế giới bên ngoài (tất cả đều đi qua `AIOSAuthGuard`, tuân thủ `userId` và soft-delete `deletedAt`).

- [ ] **Task 3.1: Planner Module (`modules/planner`)**
  - CRUD Plans, Tasks, Roadmap theo `@CurrentUser()` (`userId`) (Trạng thái: `todo`, `in_progress`, `blocked`, `done`; hỗ trợ soft-delete `deletedAt` và tăng `version`).
  - Hỗ trợ cây công việc phân cấp (`parentTaskId` cho sub-tasks).
  - Tính năng AI tự động phân rã mục tiêu từ `Workflow` thành các `Task` cụ thể.

- [ ] **Task 3.2: Tool Registry & Execution Engine (`modules/tools`)**
  - Định nghĩa `ToolDefinition` (tự sinh JSON Schema tương thích LLM Function Calling).
  - Xây dựng Built-in Tools: `FilesystemTool` (giới hạn trong sandbox/workspace của `ctx.userId`), `CalculatorTool`, `WebSearchTool`, `PlannerTool`.
  - Cơ chế Policy Guard: Bắt buộc gọi `onBeforeToolExecution` để kiểm tra quyền sở hữu (`ctx.userId`) và an toàn trước khi chạy tool.
  - Lưu trữ kết quả và độ trễ vào bảng `ToolExecution`.

- [ ] **Task 3.3: Tích hợp Model Context Protocol (MCP Client)**
  - Cho phép AIOS cắm thêm các MCP Server ngoài (GitHub, Google Calendar, Notion,...).

---

## 🔹 Phase 5: Trí tuệ Tự chủ & Quy trình Tự động (Sprint 4 - ReAct Agent & Workflow)

> **Mục tiêu:** AI tự suy luận, tự gọi công cụ và xử lý quy trình nhiều bước.

- [ ] **Task 4.1: Agent ReAct Engine (`modules/agents`)**
  - Hiện thực chu trình **ReAct Loop**: `Reason (Thought)` → `Act (Tool Call)` → `Reflect (Observation)`.
  - Quản lý phiên làm việc qua `AgentSession` và từng lượt chạy qua `AgentRun`.
  - Cấu hình vai trò qua `AgentConfig` (AIOS Chief of Staff, Coder, Researcher).

- [ ] **Task 4.2: Workflow Engine (`modules/workflow`)**
  - Định nghĩa quy trình nhiều bước qua bảng `WorkflowStep` (gắn với `Workflow.userId`).
  - Cơ chế State Machine: Hỗ trợ Pause, Resume, Cancel và lưu trạng thái trung gian vào PostgreSQL/PGlite.
  - Worker xử lý nền thông qua interface `IJobQueue` (độc lập với BullMQ).

---

## 🔹 Phase 6: Giao diện Người dùng & Tích hợp Toàn diện (Sprint 5 - Web UI & Testing)

> **Mục tiêu:** Dashboard trực quan hóa toàn bộ hệ thống cho người dùng.

- [ ] **Task 5.1: Giao diện Chat & Streaming (`apps/web`)**
  - UI trò chuyện hỗ trợ Markdown, Syntax Highlight, Token Streaming realtime qua SSE.
  - Cho phép đính kèm file tài liệu trực tiếp vào từng tin nhắn.

- [ ] **Task 5.2: Giao diện Knowledge Hub, Memory & Planner**
  - Kéo thả upload file tài liệu & xem kết quả RAG similarity.
  - Bảng Memory Board (Xem, chỉnh sửa profile và truy vết nguồn gốc ký ức).
  - Bảng Kanban Todo / Roadmap quản lý kế hoạch công việc.

- [ ] **Task 5.3: Agent & Workflow Visualizer**
  - Theo dõi luồng suy luận của Agent qua `AgentRun` (`Thought` → `Action` → `Result`).
  - Trực quan hóa tiến trình từng bước của `WorkflowStep`.

- [ ] **Task 5.4: Kiểm thử Tích hợp E2E & Đo baseline**
  - Đo và ghi nhận baseline để phát hiện hồi quy; tối ưu hiệu năng chuyên sâu được để cho giai đoạn tương lai.

---

## 🔹 Phase 7: Hạ tầng Keycloak OIDC, Data Claiming & Local Companion Security

> **Mục tiêu:** Kết nối `AuthModule` (đã xây ở Task 2.2.6) với Keycloak Server thực tế, tích hợp luồng đăng nhập OIDC PKCE trên Client và bảo vệ cổng giao tiếp Local Companion.

- [ ] **Task 6.1: Hạ tầng Keycloak Server & Client OIDC PKCE Flow (`Keycloak` + `apps/web` + `apps/desktop`)**
  - Cấu hình Keycloak Realm, Client, Google làm external Identity Provider (IdP) và luồng email verification có sẵn của Keycloak khi đăng ký; không triển khai OTP số tùy chỉnh trong MVP.
  - Tích hợp luồng OIDC Authorization Code + PKCE trên Client: Web dùng redirect flow, Desktop dùng system browser + custom protocol deep-link (`aios://auth/callback`) và lưu token an toàn.
  - Chuyển `AUTH_MODE=keycloak` làm mặc định và kiểm thử E2E thật giữa `Client` ↔ `Keycloak` ↔ `AuthModule` (`apps/api`).
  - *DoD:* E2E test luồng đăng nhập Google/Email qua Keycloak, làm mới token (refresh token), và đồng bộ thông tin user qua `GET /auth/me`.

- [ ] **Task 6.2: Data Claiming & Ownership Isolation Audit (`modules/auth` + Repositories)**
  - Bổ sung endpoint/luồng `POST /auth/claim-local-data` trong `AuthModule` để người dùng chủ động claim/import dữ liệu cũ (được tạo dưới `Default Local User` khi dùng offline/dev trước đó) vào tài khoản Keycloak vừa đăng nhập; tuyệt đối không tự động gán mù quáng record chưa có owner vào tài khoản bất kỳ.
  - Kiểm tra toàn diện (E2E Security Audit) đảm bảo mọi query/update/delete/retrieval ở tất cả các module (`Chat`, `Knowledge`, `Memory`, `Planner`, `Workflow`) đều bị cô lập nghiêm ngặt theo `userId`.
  - *DoD:* E2E test chứng minh User A không thể đọc/sửa/xóa hoặc tìm kiếm vector chéo sang dữ liệu của User B.

- [ ] **Task 6.3: Local Companion Pairing & Browser PNA Security (`modules/auth` + `main.ts`)**
  - Mở rộng `AuthModule` để hỗ trợ **Companion Pairing Flow**: sinh pairing challenge one-time do người dùng chủ động khởi tạo trên Desktop/Companion, cấp scoped short-lived local access token cho Web App sau khi pair thành công.
  - Chỉ bind `127.0.0.1`; bổ sung origin/CSRF checks và giới hạn origin.
  - Bổ sung middleware xử lý **Browser Private Network Access (PNA)** (`Access-Control-Allow-Private-Network: true`) khi HTTPS Web gọi xuống `http://127.0.0.1`.
  - Thiết kế cơ chế phát hiện lỗi kết nối localhost trên Safari / Brave (khi bật Shield) để hướng dẫn người dùng cấu hình cho phép hoặc mở ứng dụng Desktop; CORS không được coi là authentication.
  - *DoD:* Test origin lạ, PNA preflight, pairing replay/hết hạn, token scope và request không xác thực.

---

## 🔹 Phase 8: Electron Desktop & PGlite Zero-Daemon Runtime

> **Mục tiêu:** Dùng cùng NestJS API cho desktop và web, nhúng toàn bộ Database + Vector Search + Job Queue vào một thư mục PGlite duy nhất trên máy người dùng.

- [ ] **Task 7.1: Electron Shell & NestJS Sidecar (`apps/desktop`)**
  - Electron Main khởi chạy, cấp phát port động cho HTTP API (nếu port mặc định bận), health-check, restart khi cần và shutdown NestJS sidecar sạch; sidecar chỉ bind loopback (`127.0.0.1`).
  - Electron Renderer gọi cùng local HTTP API như web client. IPC chỉ điều khiển sidecar/status và tích hợp OS; preload bridge giới hạn command, validate input, không expose Node integration.
  - *DoD:* Kiểm thử sidecar lifecycle, renderer/API access, app restart và shutdown.

- [ ] **Task 7.2: PGlite + Bundled `pgvector` + SQL Queue Local Runtime**
  - Tích hợp `@electric-sql/pglite` (bật sẵn extension `vector`) và `@prisma/adapter-pglite` vào `PrismaService` khi chạy ở chế độ Desktop/Local Companion.
  - Sử dụng `PgVectorAdapter` làm Vector Store mặc định trên PGlite (lưu trữ cả dữ liệu quan hệ, canonical chunks và vector index HNSW trong cùng một thư mục PGlite tại `userData`).
  - Hiện thực `PgLiteQueueAdapter` (implement `IJobQueue`) dùng bảng SQL ngay trong PGlite để xử lý tác vụ nền (thay thế hoàn toàn Redis/BullMQ và Qdrant binary).
  - Làm rõ khởi động, readiness, auto-migration khi update app, crash recovery và backup/restore thư mục PGlite.
  - *DoD:* Cài/chạy mượt mà trên Windows/macOS/Linux mà không cần người dùng cài Docker, Postgres daemon, Qdrant hay Redis; dữ liệu tồn tại bền vững qua restart/update.

- [ ] **Task 7.3: Per-Profile File Storage & Knowledge Lifecycle**
  - Lưu file gốc và thư mục PGlite dưới OS application data directory (Electron `app.getPath('userData')`), phân tách theo profile `userId`; không dùng email làm path và không lưu trong install directory.
  - Bổ sung authenticated file APIs, ownership-scoped search/retrieval, xóa mềm (`deletedAt` tombstone) kèm dọn dẹp file/chunks/vector nhất quán và khả năng reindex `pgvector` từ canonical data.
  - *DoD:* Upload, restart, reindex, delete và restore không để lại orphan file/vector.

- [ ] **Task 7.4: Web Pairing & Desktop Distribution**
  - Web khi không có companion vẫn hỗ trợ đăng nhập, account, download và sync status; Knowledge/AI local yêu cầu companion đã pair và đang chạy.
  - Website cung cấp installer ký số theo OS, checksum, version và hướng dẫn cập nhật.
  - *DoD:* Test web không companion, web đã pair và desktop app; không truy cập local API trước khi pair.

---

## 🔹 Phase 9: End-to-End Encrypted Sync

> **Mục tiêu:** Đồng bộ dữ liệu giữa thiết bị qua Sync Envelope mà cloud không đọc được nội dung, tiết kiệm chi phí re-embedding trên thiết bị mới.

- [ ] **Task 8.1: Client-Side Encryption & Recovery Key**
  - Mã hóa payload (AES-256-GCM) trước khi upload; thiết kế vault key, recovery key do user giữ, key rotation, thiết bị mới/mất và revoke.
  - Cloud không nhận plaintext hoặc decryption key; cảnh báo rõ mất cả vault key và recovery key sẽ không thể khôi phục dữ liệu.

- [ ] **Task 8.2: Sync API, Sync Envelope, Versioning & Smart Vector Sync**
  - Tạo Sync API/object storage chỉ lưu `EncryptedSyncItem` (Sync Envelope gồm: `id`, `userId`, `entityType`, `version`, `isDeleted` tombstone, `updatedAt`, `ciphertext`, `iv`, `authTag`); phân quyền namespace theo Keycloak subject.
  - Đồng bộ toàn diện: canonical documents/chunks, conversations/messages, memory records và plans/tasks.
  - **Cơ chế Smart Vector Sync:** Không sync chỉ mục HNSW của `pgvector`. Tuy nhiên, nếu chunk được tạo bởi Cloud Embedding trả phí (OpenAI/Gemini), hỗ trợ nén nhị phân mảng `Float32Array` vector (768 chiều) kèm `embeddingModel` và mã hóa E2EE gửi kèm Sync Envelope. Thiết bị thứ 2 sau khi giải mã sẽ ghi thẳng mảng vector vào cột `embedding` của PGlite local mà không tốn tiền gọi lại API. Nếu dùng Local Ollama hoặc đổi model, máy mới tự rebuild vector từ text.
  - Xử lý content hashes, manifests, tombstones (`deletedAt`), conflict resolution, upload tiếp tục cho file lớn, retention/quota và account deletion.
  - *DoD:* Test hai thiết bị, conflict, xóa đồng bộ (tombstone propagation), revoke và recovery; server không thể semantic-search plaintext từ payload E2E.

- [ ] **Task 8.3: LLM Data Privacy Boundary**
  - Thông báo rõ context/chunks nào được gửi tới hosted LLM; không ghi nội dung nhạy cảm vào log mặc định.
  - Hỗ trợ cấu hình provider (lưu API secret trong OS Keychain) và local-model mode (Ollama) khi có thể; không nhúng provider secrets trong web assets.
  - *DoD:* Privacy documentation/UI khớp với dữ liệu thực tế được gửi ra ngoài thiết bị.

---

### 📌 Trạng thái Hiện tại & Việc Cần làm Ngay:

1. **Đảm bảo hạ tầng development Docker (PostgreSQL + Redis + Qdrant) đang chạy:**
   ```bash
   cd docker && docker compose up -d
   ```
2. **Đã hoàn thành Task 2.2.5 (Urgent Refactor Schema & Core):**
   * Đã cập nhật `apps/api/prisma/schema.prisma` và migration `20261117103000_add_ownership_and_sync_fields`.
   * Đã cập nhật `AgentExecutionContext` (`userId`), `AIOSHookHandler` (`onBeforePromptBuild` Immutable Pipeline), `ContextBuilder`, `HookRegistry`, và `IJobQueue`.
3. **Thực hiện Task 2.2.6 (`modules/auth`) [VIỆC TIẾP THEO]:**
   * Triển khai `AuthModule`, `AIOSAuthGuard` (`keycloak` + `dev_bypass`), `@CurrentUser()` decorator, và áp dụng ngay vào `MemoryModule` + `KnowledgeModule`.
4. **Chuyển sang Task 2.3 (`modules/chat`):**
   * Sử dụng `@CurrentUser()` và ghép RAG + Memory + Chat History vào `AgentExecutionContext` qua Immutable Hook Pipeline.
