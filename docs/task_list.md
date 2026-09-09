# 📋 AIOS Master Implementation Tasklist

Dự án **AIOS (Personal AI Operating System)** được thiết kế và triển khai theo kiến trúc **Clean Architecture & Modular Monolith** (kế thừa từ tài liệu [docs/architecture.md](file:///Users/huyhq41.ghc/AIOS/docs/architecture.md)), lấy **`Message` làm trung tâm điều phối (Message-Centric Design)** và hỗ trợ 7 modules nghiệp vụ độc lập.

---

## 🔹 Phase 1: Khởi tạo Nền tảng Dữ liệu & Hợp đồng Cốt lõi (Sprint 0 - Foundations)
> **Mục tiêu:** Hoàn thiện Database Schema (Prisma 14 bảng), kết nối PostgreSQL (pgvector), và dựng các Interface/Context cốt lõi độc lập thư viện ngoài.

- [x] **Task 0.1: Hạ tầng Docker & Cấu hình Môi trường**
  - Đã có: [docker/docker-compose.yml](file:///Users/huyhq41.ghc/AIOS/docker/docker-compose.yml), [docker/init-db/01-init.sql](file:///Users/huyhq41.ghc/AIOS/docker/init-db/01-init.sql), [docker/.env](file:///Users/huyhq41.ghc/AIOS/docker/.env).
  - Port mapping tránh xung đột: PostgreSQL (`5433:5432`), Redis (`6378:6379`), Qdrant (`6333`), Adminer (`8080`).
  - Đã cấu hình [.npmrc](file:///Users/huyhq41.ghc/AIOS/.npmrc) cấp quyền build cho pnpm v10+ (`onlyBuiltDependencies`).

- [/] **Task 0.2: Cài đặt Prisma ORM & Triển khai Schema Database (Đang thực hiện)**
  - [x] Thiết kế xong Master ERD chuẩn hóa 7 modules (14 bảng).
  - [x] Cài đặt Prisma 6.19.3 (bản Stable tương thích NestJS 11).
  - [x] Viết và validate thành công [apps/api/prisma/schema.prisma](file:///Users/huyhq41.ghc/AIOS/apps/api/prisma/schema.prisma):
    - **Chat:** `Conversation`, `Message`
    - **Agents:** `AgentConfig`, `AgentSession`, `AgentRun`
    - **Knowledge (RAG):** `Document`, `MessageDocument` (M:N), `DocumentChunk` (pgvector 768)
    - **Tools:** `ToolExecution`
    - **Workflow:** `Workflow`, `WorkflowStep`
    - **Planner:** `Plan`, `Task` (Sub-task self-relation)
    - **Memory:** `MemoryRecord` (Ký ức Global kèm `sourceAgentSessionId` phục vụ truy vết)
  - [ ] Chạy `pnpm exec prisma migrate dev --name init` tạo bảng trên PostgreSQL thực tế.
  - [x] Viết `apps/api/src/infrastructure/database/prisma.service.ts` kết nối NestJS Lifecycle (`onModuleInit`, `onModuleDestroy`) và `PrismaModule`.

- [ ] **Task 0.3: Xây dựng Thư viện Dùng chung (`packages/shared-types`)**
  - Khởi tạo package `shared-types` trong `packages/` (DTOs, Enums, API Request/Response) để dùng chung cho cả `api` và `web`.

- [ ] **Task 0.4: Tầng Core Contracts (Trừu tượng hóa kiểu Caremate)**
  - `apps/api/src/core/context/agent-context.interface.ts`: Định nghĩa `AgentExecutionContext` (đối tượng bất biến `readonly` mang toàn bộ ngữ cảnh thực thi).
  - `apps/api/src/core/hooks/`: Định nghĩa `AIOSHookHandler` (`onBeforePromptBuild`, `onBeforeToolExecution`, `onAfterToolExecution`, `onAfterCompletion`) & `HookRegistry`.
  - `apps/api/src/core/llm/interfaces/`: Định nghĩa `ILLMClient`, `LLMMessage`, `StreamingChunk`, `TokenUsage`.
  - `apps/api/src/core/observability/`: Định nghĩa Interface Tracing & Logger.
  - *DoD:* Core code độc lập 100% với SDK bên ngoài.

---

## 🔹 Phase 2: LLM Gateway & Hạ tầng Adapters (Sprint 1 - Anti-Corruption Layer)
> **Mục tiêu:** Xây dựng cổng giao tiếp LLM đa nhà cung cấp và các Adapter kết nối Vector Store / Redis.

- [ ] **Task 1.1: LLM Gateway & Provider Adapters (`core/llm` & `infrastructure/llm-providers`)**
  - Hiện thực `LLMClientFactory` và `OpenAIAdapter` / `GeminiAdapter` / `OllamaAdapter` kế thừa `ILLMClient`.
  - Hiện thực luồng Streaming Token (AsyncIterable $\rightarrow$ Server-Sent Events).
  - `TokenCounterService`: Đếm token và ước lượng chi phí context window.

- [ ] **Task 1.2: Vector Store Adapter (`infrastructure/vector-store`)**
  - Interface `IVectorStore` (`upsert`, `searchSimilarity`, `delete`).
  - Hiện thực `QdrantAdapter` (kết nối Qdrant REST/gRPC) và `PgVectorAdapter` (dùng native extension của Postgres).

- [ ] **Task 1.3: Redis & Storage Adapters (`infrastructure/`)**
  - `RedisService`: Quản lý cache session, pub/sub realtime, rate limiting.
  - Cấu hình **BullMQ** cho tác vụ bất đồng bộ (Chunking tài liệu, background workflow).
  - `LocalStorageService`: Lưu trữ file nhị phân tải lên (PDF, DOCX, MD) tại `./data/storage`.

---

## 🔹 Phase 3: Các Module Nghiệp vụ Cốt lõi (Sprint 2 - Chat, Memory, RAG)
> **Mục tiêu:** Chatbot thông minh có khả năng nhớ sở thích và tra cứu tài liệu cá nhân.

- [ ] **Task 2.1: Memory Module (`modules/memory`)**
  - CRUD Ký ức dài hạn (`MemoryRecord`: User Profile, Preferences, Project Facts) lưu vào PostgreSQL.
  - Cung cấp method `getRelevantMemory(ctx)` để inject vào `AgentExecutionContext`.
  - Tích hợp ghi nhận nguồn gốc thông qua `sourceAgentSessionId`.

- [ ] **Task 2.2: Knowledge & RAG Module (`modules/knowledge`)**
  - Pipeline xử lý: Upload tài liệu $\rightarrow$ Text Extraction $\rightarrow$ Chunking (Recursive Splitter) $\rightarrow$ Embedding Service $\rightarrow$ Lưu Vector DB.
  - Endpoint `POST /knowledge/upload` và `GET /knowledge/search` (Semantic Search).
  - Hỗ trợ gắn kết nhiều tài liệu vào tin nhắn qua bảng `MessageDocument`.

- [ ] **Task 2.3: Chat Module hoàn chỉnh (`modules/chat`)**
  - Endpoint `POST /chat` và `POST /chat/stream` (SSE Streaming).
  - Kết hợp Context Builder: Gom System Rules + Chat History + Prefetched Memory + RAG Chunks.
  - Tích hợp Lifecycle Hooks (`onBeforePromptBuild`, `onAfterCompletion` ghi nhận Trace vào `AgentRun`).

---

## 🔹 Phase 4: Kế hoạch & Công cụ Mở rộng (Sprint 3 - Planner, Tools & MCP)
> **Mục tiêu:** AI có khả năng quản lý công việc và tương tác ra thế giới bên ngoài.

- [ ] **Task 3.1: Planner Module (`modules/planner`)**
  - CRUD Plans, Tasks, Roadmap (Trạng thái: `todo`, `in_progress`, `blocked`, `done`).
  - Hỗ trợ cây công việc phân cấp (`parentTaskId` cho sub-tasks).
  - Tính năng AI tự động phân rã mục tiêu từ `Workflow` thành các `Task` cụ thể.

- [ ] **Task 3.2: Tool Registry & Execution Engine (`modules/tools`)**
  - Định nghĩa `ToolDefinition` (tự sinh JSON Schema tương thích LLM Function Calling).
  - Xây dựng Built-in Tools: `FilesystemTool`, `CalculatorTool`, `WebSearchTool`, `PlannerTool`.
  - Cơ chế Policy Guard: Bắt buộc gọi `onBeforeToolExecution` để kiểm tra an toàn trước khi chạy tool.
  - Lưu trữ kết quả và độ trễ vào bảng `ToolExecution`.

- [ ] **Task 3.3: Tích hợp Model Context Protocol (MCP Client)**
  - Cho phép AIOS cắm thêm các MCP Server ngoài (GitHub, Google Calendar, Notion,...).

---

## 🔹 Phase 5: Trí tuệ Tự chủ & Quy trình Tự động (Sprint 4 - ReAct Agent & Workflow)
> **Mục tiêu:** AI tự suy luận, tự gọi công cụ và xử lý quy trình nhiều bước.

- [ ] **Task 4.1: Agent ReAct Engine (`modules/agents`)**
  - Hiện thực chu trình **ReAct Loop**: `Reason (Thought)` $\rightarrow$ `Act (Tool Call)` $\rightarrow$ `Reflect (Observation)`.
  - Quản lý phiên làm việc qua `AgentSession` và từng lượt chạy qua `AgentRun`.
  - Cấu hình vai trò qua `AgentConfig` (AIOS Chief of Staff, Coder, Researcher).

- [ ] **Task 4.2: Workflow Engine (`modules/workflow`)**
  - Định nghĩa quy trình nhiều bước qua bảng `WorkflowStep`.
  - Cơ chế State Machine: Hỗ trợ Pause, Resume, Cancel và lưu trạng thái trung gian vào PostgreSQL.
  - Worker xử lý nền qua BullMQ.

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
  - Theo dõi luồng suy luận của Agent qua `AgentRun` (Thought $\rightarrow$ Action $\rightarrow$ Result).
  - Trực quan hóa tiến trình từng bước của `WorkflowStep`.

- [ ] **Task 5.4: Kiểm thử Tích hợp E2E & Tối ưu hiệu năng**

---

### 📌 Trạng thái Hiện tại & Việc Cần làm Ngay:
1. Chạy lệnh migrate để đẩy 14 bảng vào PostgreSQL:
   ```bash
   pnpm exec prisma migrate dev --name init
   ```
2. Tạo `PrismaService` trong NestJS để các module sau này inject và query DB.
3. Chuyển sang **Task 0.3** (`packages/shared-types`) và **Task 0.4** (Core Contracts & Hooks).