# Module Decomposition — AIOS

> Tài liệu phân rã hệ thống **AIOS (Personal AI Operating System)** dựa trên cấu trúc thực tế của dự án (**pnpm Monorepo: NestJS API + React Web + Docker Infrastructure**).  
> Mục tiêu: Xác định ranh giới trách nhiệm rõ ràng cho từng module, đảm bảo tính độc lập (High Cohesion, Loose Coupling) theo Domain-Driven Design (DDD), sẵn sàng mở rộng và kiểm thử độc lập.

---

## 1. Cấu trúc Tổng thể Dự án (Project Monorepo Structure)

Hệ thống được tổ chức dưới dạng monorepo quản lý bởi `pnpm`, chia tách rõ rệt giữa Backend API (`apps/api`), Frontend UI (`apps/web`), Infrastructure (`docker`) và Shared Packages (`packages/`):

```
AIOS/
├── apps/
│   ├── api/                             # NestJS Backend Application
│   │   ├── src/
│   │   │   ├── main.ts                  # Entry point (Bootstrap HTTP & WebSocket)
│   │   │   ├── app.module.ts            # Root Module tổng hợp toàn bộ modules
│   │   │   ├── app.controller.ts        # Health check & root endpoints
│   │   │   ├── app.service.ts
│   │   │   │
│   │   │   ├── modules/                 # Business Feature Modules (Nghiệp vụ cốt lõi)
│   │   │   │   ├── chat/                # Module Quản lý hội thoại & Streaming
│   │   │   │   ├── knowledge/           # Module Tài liệu & RAG (Vector Search)
│   │   │   │   ├── memory/              # Module Ký ức dài hạn (User Profile)
│   │   │   │   ├── planner/             # Module Kế hoạch, Task & Roadmap
│   │   │   │   ├── workflow/            # Module Workflow Engine (Multi-step DAG)
│   │   │   │   ├── agents/              # Module Multi-Agent Orchestration & ReAct
│   │   │   │   └── tools/               # Module Tool Registry & Execution
│   │   │   │
│   │   │   ├── core/                    # Core & Cross-cutting Concerns (Shared Kernel)
│   │   │   │   ├── llm/                 # LLM Gateway (Anti-Corruption Layer)
│   │   │   │   ├── observability/       # Tracing, Token Counter, Metrics, Logger
│   │   │   │   └── config/              # Configuration & Environment Validation
│   │   │   │
│   │   │   └── infrastructure/          # Tầng kết nối Hạ tầng kỹ thuật
│   │   │       ├── database/            # PostgreSQL (Prisma ORM Client & Migrations)
│   │   │       ├── vector-store/        # Vector Database Adapter (Qdrant / pgvector)
│   │   │       ├── storage/             # Quản lý file nhị phân cục bộ (Local Filesystem)
│   │   │       └── cache/               # Redis Service (Session, Cache, Rate Limit)
│   │   │
│   │   ├── test/                        # E2E & Integration Tests (Jest)
│   │   ├── nest-cli.json
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── web/                             # React Frontend (Vite + TypeScript + Tailwind)
│       ├── src/
│       │   ├── App.tsx                  # Main layout & router
│       │   ├── main.tsx                 # Client entry point
│       │   ├── components/              # Shared UI components
│       │   └── views/                   # Views tương ứng với các module API (Chat, RAG, Plan...)
│       ├── vite.config.ts
│       ├── tsconfig.json
│       └── package.json
│
├── docker/                              # Cấu hình container hóa hạ tầng
│   └── docker-compose.yml               # PostgreSQL, Qdrant/pgvector, Redis
│
├── docs/                                # Tài liệu kỹ thuật & Kiến trúc
│   ├── diagrams/                        # Bounded Context, Component, Domain, Use Case
│   ├── vision-and-scope-docs.md         # Yêu cầu & Tầm nhìn hệ thống
│   └── module-decomposition.md          # Bản đặc tả phân rã module
│
├── packages/                            # Shared Libraries & Contracts dùng chung
├── pnpm-workspace.yaml                  # Khai báo Monorepo Workspace
└── README.md
```

---

## 2. Chi tiết các Business Module (`apps/api/src/modules`)

Mỗi module nghiệp vụ trong NestJS tuân theo cấu trúc tiêu chuẩn:
- `*.module.ts`: Khai báo module, dependency injection providers và exports.
- `*.controller.ts`: Tiếp nhận HTTP requests, điều hướng luồng dữ liệu.
- `*.service.ts`: Xử lý business logic và điều phối tác vụ.
- `dto/`: Data Transfer Objects (Validation input với class-validator).
- `entities/`: Định nghĩa thực thể domain hoặc ORM mapping.

---

### 2.1. `modules/chat` — Chat & Conversation Module

| Thuộc tính | Chi tiết |
|---|---|
| **Vị trí** | `apps/api/src/modules/chat/` |
| **Trách nhiệm** | Quản lý vòng đời cuộc hội thoại, lưu trữ tin nhắn, điều phối luồng hỏi - đáp (Orchestrator), và truyền phát (stream) token về Client. |
| **Input** | User message payload (`CreateChatDto`), conversationId, streaming options. |
| **Output** | Streaming response (Server-Sent Events / WebSocket) hoặc JSON Message. |
| **Dependencies** | `core/llm`, `modules/knowledge`, `modules/memory`, `infrastructure/database` |

**Cấu trúc tệp hiện tại:**
- `chat.module.ts`: Khai báo module, inject `ChatService`.
- `chat.controller.ts`: REST endpoints (`POST /chat`, `GET /chat`, `GET /chat/:id`).
- `chat.service.ts`: Logic tạo conversation, append message, kết nối Memory & Knowledge để build prompt cho LLM.
- `dto/create-chat.dto.ts`, `dto/update-chat.dto.ts`: Định dạng dữ liệu đầu vào.
- `entities/chat.entity.ts`: Thực thể `Conversation` và `Message`.

---

### 2.2. `modules/knowledge` — Knowledge & RAG Module

| Thuộc tính | Chi tiết |
|---|---|
| **Vị trí** | `apps/api/src/modules/knowledge/` |
| **Trách nhiệm** | Tiếp nhận tài liệu (PDF, Markdown, DOCX), chia nhỏ đoạn văn bản (Chunking), tạo vector embedding và thực hiện tìm kiếm ngữ nghĩa (Semantic Search). |
| **Input** | Upload file nhị phân, Search Query string, Top-K parameter. |
| **Output** | Danh sách `DocumentChunk` phù hợp kèm điểm tương đồng (similarity score). |
| **Dependencies** | `core/llm` (Embedding Service), `infrastructure/vector-store`, `infrastructure/storage` |

**Cấu trúc tệp hiện tại:**
- `knowledge.module.ts`: Quản lý upload và indexing pipeline.
- `knowledge.controller.ts`: Endpoints upload file, xóa tài liệu, tra cứu tri thức (`POST /knowledge/upload`, `GET /knowledge/search`).
- `knowledge.service.ts`: Điều phối pipeline: Lưu file $\rightarrow$ Parse text $\rightarrow$ Chunking $\rightarrow$ Gọi Embedding $\rightarrow$ Lưu Vector Store.
- `dto/create-knowledge.dto.ts`, `dto/update-knowledge.dto.ts`
- `entities/knowledge.entity.ts`: Thực thể `Document` (metadata) và `DocumentChunk`.

---

### 2.3. `modules/memory` — Long-Term Memory Module

| Thuộc tính | Chi tiết |
|---|---|
| **Vị trí** | `apps/api/src/modules/memory/` |
| **Trách nhiệm** | Lưu trữ và truy xuất thông tin dài hạn về người dùng (sở thích, thói quen, thông tin dự án, quy tắc cá nhân) theo cặp Key-Value và danh mục (Category). |
| **Input** | Khóa (key), giá trị (value), danh mục (category, e.g. `profile`, `preference`, `project`). |
| **Output** | Danh sách Memory record hoặc Memory Profile tổng hợp. |
| **Dependencies** | `infrastructure/database` (PostgreSQL) |

**Cấu trúc tệp hiện tại:**
- `memory.module.ts`: Khai báo MemoryModule.
- `memory.controller.ts`: Endpoints quản lý ký ức (`POST /memory`, `GET /memory`, `PATCH /memory/:id`, `DELETE /memory/:id`).
- `memory.service.ts`: Xử lý CRUD memory và cung cấp phương thức `getRelevantMemory(context)` cho ChatModule.
- `dto/create-memory.dto.ts`, `dto/update-memory.dto.ts`
- `entities/memory.entity.ts`: Thực thể `Memory` (id, key, value, category, timestamps).

---

### 2.4. `modules/planner` — Planner & Task Management Module

| Thuộc tính | Chi tiết |
|---|---|
| **Vị trí** | `apps/api/src/modules/planner/` |
| **Trách nhiệm** | Quản lý kế hoạch (Plan), danh sách công việc (Task) và lộ trình (Roadmap). Hỗ trợ AI tự động phân rã mục tiêu thành các bước hành động cụ thể. |
| **Input** | Tiêu đề kế hoạch, mô tả, danh sách nhiệm vụ con, hạn hoàn thành (due date). |
| **Output** | Trạng thái kế hoạch (`pending`, `in_progress`, `done`), danh sách task chi tiết. |
| **Dependencies** | `infrastructure/database` (PostgreSQL) |

**Cấu trúc tệp hiện tại:**
- `planner.module.ts`: Khai báo PlannerModule.
- `planner.controller.ts`: Endpoints quản trị plan và task (`POST /planner`, `GET /planner`, `PATCH /planner/:id`).
- `planner.service.ts`: Xử lý logic lập kế hoạch, cập nhật trạng thái tiến độ task. Cung cấp adapter để các Agent/Tool có thể gọi cập nhật task tự động.
- `dto/create-planner.dto.ts`, `dto/update-planner.dto.ts`
- `entities/planner.entity.ts`: Thực thể `Plan` và `Task`.

---

### 2.5. `modules/workflow` — Workflow Engine Module

| Thuộc tính | Chi tiết |
|---|---|
| **Vị trí** | `apps/api/src/modules/workflow/` |
| **Trách nhiệm** | Định nghĩa, điều phối và thực thi các quy trình tự động hóa nhiều bước (Multi-step DAG / Pipeline). Hỗ trợ lưu trạng thái trung gian để có thể Pause, Resume hoặc Cancel. |
| **Input** | Định nghĩa quy trình (Workflow Definition), Step configurations, input parameters. |
| **Output** | Kết quả thực thi từng bước (`StepResult`), trạng thái cuối cùng của Workflow. |
| **Dependencies** | `modules/agents`, `modules/tools`, `infrastructure/database` |

**Cấu trúc tệp hiện tại:**
- `workflow.module.ts`: Khai báo WorkflowModule.
- `workflow.controller.ts`: Endpoints quản trị workflow (`POST /workflow/run`, `POST /workflow/:id/resume`, `GET /workflow/:id`).
- `workflow.service.ts`: Máy trạng thái (State Machine) điều phối tuần tự hoặc song song các bước, ủy thác thực thi cho Tool hoặc Agent.
- `dto/create-workflow.dto.ts`, `dto/update-workflow.dto.ts`
- `entities/workflow.entity.ts`: Thực thể `Workflow` và `WorkflowStep`.

---

### 2.6. `modules/agents` — Multi-Agent Orchestration Module

| Thuộc tính | Chi tiết |
|---|---|
| **Vị trí** | `apps/api/src/modules/agents/` |
| **Trách nhiệm** | Quản lý và điều phối các AI Agent chuyên biệt (Research, Coding, Learning, Review). Triển khai vòng lặp suy luận ReAct Loop (Reason $\rightarrow$ Act $\rightarrow$ Reflect). |
| **Input** | Yêu cầu nhiệm vụ (Task Prompt), Agent Role, danh sách Tools cho phép. |
| **Output** | Kết quả xử lý sau quá trình tự suy luận và gọi công cụ (Tool Calls). |
| **Dependencies** | `core/llm`, `modules/tools`, `modules/workflow` |

**Cấu trúc tệp hiện tại:**
- `agents.module.ts`: Khai báo AgentsModule.
- `agents.controller.ts`: Endpoints điều khiển agent (`POST /agents/run`, `GET /agents/roles`).
- `agents.service.ts`: Điều phối Agent Session, Agent Router, thực thi vòng lặp ReAct, gọi LLM suy luận và kích hoạt Tool tương ứng.
- `dto/create-agent.dto.ts`, `dto/update-agent.dto.ts`
- `entities/agent.entity.ts`: Thực thể `AgentConfig`, `AgentSession`, `AgentMessage`.

---

### 2.7. `modules/tools` — Tool Registry & Execution Module *(Đang bổ sung)*

| Thuộc tính | Chi tiết |
|---|---|
| **Vị trí** | `apps/api/src/modules/tools/` (Tích hợp cùng Agent/Workflow) |
| **Trách nhiệm** | Đăng ký (Register), kiểm tra hợp lệ (Validate Schema) và thực thi các công cụ bên ngoài theo tiêu chuẩn Tool Calling của LLM hoặc Model Context Protocol (MCP). |
| **Input** | Tool Name, JSON Schema input parameters. |
| **Output** | Dữ liệu trả về từ công cụ (`ToolResult`). |
| **Dependencies** | External Services (Tavily/Google Search, Local Filesystem, GitHub, Weather...) |

**Thành phần cốt lõi:**
- `ToolRegistry`: Quản lý danh sách các Tool có sẵn trong hệ thống và sinh Tool Definitions (JSON Schema) cho LLM.
- `ToolExecutor`: Chạy tool an toàn, bắt ngoại lệ và đo đạc thời gian thực thi (Latency).
- Built-in Tools: `SearchTool`, `CalculatorTool`, `FilesystemTool`, `WeatherTool`.

---

## 3. Chi tiết Tầng Dùng Chung & Hạ Tầng (Core & Infrastructure)

### 3.1. `core/llm` — LLM Gateway (Anti-Corruption Layer)
* **Mục tiêu:** Cô lập toàn bộ mã nguồn nghiệp vụ khỏi các SDK bên ngoài (OpenAI, Anthropic, Gemini, Ollama).
* **Thành phần:**
  - `LLMClientFactory`: Khởi tạo adapter tương ứng theo cấu hình (`OpenAIAdapter`, `GeminiAdapter`, `OllamaAdapter`).
  - `PromptBuilder`: Hỗ trợ ghép System Prompt, User Messages, Document Chunks và Tool Schemas.
  - `StreamingAdapter`: Chuẩn hóa luồng AsyncIterable token sang định dạng SSE cho Client.
  - `TokenCounter`: Kiểm soát giới hạn Context Window và tính toán chi phí token.

### 3.2. `core/observability` — Tracing & Metrics
* **Mục tiêu:** Giám sát toàn diện chu trình AI Agent để phục vụ debug và đánh giá chất lượng.
* **Thành phần:**
  - Ghi nhận Trace/Span cho từng vòng lặp LLM Call, Tool Call, Retrieval time.
  - Đo lường Latency, Prompt Tokens, Completion Tokens và tỷ lệ lỗi.

### 3.3. `infrastructure/database` & `infrastructure/vector-store`
* **PostgreSQL (Prisma ORM):** Quản trị quan hệ bền vững cho `Conversation`, `Message`, `Memory`, `Plan`, `Task`, `Workflow`, `AgentSession`.
* **Vector Store (Qdrant / pgvector):** Lưu trữ embedding vectors 768/1536 chiều của các `DocumentChunk` cho RAG.
* **Redis (Cache & Queue):** Quản lý session streaming tức thời, cache kết quả truy vấn và rate limit.
* **Local File Storage:** Quản lý lưu trữ file gốc upload lên hệ thống tại thư mục lưu trữ cục bộ.

---

## 4. Chi tiết Ứng Dụng Giao Diện (`apps/web`)

Ứng dụng Frontend được xây dựng bằng **React 19 + Vite + TypeScript**, đóng vai trò là giao diện điều hành thống nhất (Unified AI Dashboard):

1. **Chat Screen:** Giao diện trò chuyện trực quan hỗ trợ markdown rendering, code highlight và hiển thị câu trả lời streaming tức thì qua SSE.
2. **Knowledge Base Manager:** Giao diện kéo-thả upload tài liệu (PDF, MD, DOCX), xem danh sách tài liệu đã index và kiểm tra kết quả tìm kiếm ngữ nghĩa.
3. **Memory Board:** Quản lý hồ sơ ký ức của người dùng theo danh mục (profile, sở thích, dự án), cho phép thêm/sửa/xóa thủ công.
4. **Planner Dashboard:** Bảng Kanban / Todo view hiển thị các kế hoạch và nhiệm vụ do người dùng hoặc AI tạo ra.
5. **Agent & Workflow Tracker:** Giám sát các bước chạy của Agent (Thought $\rightarrow$ Action $\rightarrow$ Observation), xem log thực thi tool và tiến độ workflow.

---

## 5. Ma Trận Phụ Thuộc Module (Module Dependency Matrix)

| Module gọi (Caller) | Module phụ thuộc (Callee) | Mục đích giao tiếp |
|---|---|---|
| `apps/web` | `apps/api` | REST API calls & SSE/WebSocket Streaming |
| `modules/chat` | `core/llm` | Gửi prompt hoàn chỉnh, nhận completion & stream |
| `modules/chat` | `modules/knowledge` | Truy xuất top-k chunks liên quan cho RAG |
| `modules/chat` | `modules/memory` | Lấy hồ sơ người dùng để bổ sung ngữ cảnh |
| `modules/knowledge` | `core/llm` | Sinh embedding vector cho document chunks |
| `modules/knowledge` | `infrastructure/vector-store` | Lưu và tìm kiếm vector tương đồng |
| `modules/knowledge` | `infrastructure/storage` | Lưu trữ file gốc người dùng tải lên |
| `modules/agents` | `core/llm` | Thực hiện vòng lặp suy luận (ReAct reasoning) |
| `modules/agents` | `modules/tools` | Gọi các công cụ bên ngoài theo chỉ thị của LLM |
| `modules/agents` | `modules/workflow` | Kích hoạt các sub-workflow phức tạp |
| `modules/workflow` | `modules/tools` | Chạy các bước là tool call trực tiếp |
| `modules/workflow` | `modules/agents` | Ủy quyền các bước cần khả năng suy luận AI |
| `Tất cả modules` | `core/observability` | Ghi nhận trace event, metrics, token usage |
| `Tất cả modules` | `infrastructure/database` | Lưu trữ dữ liệu thực thể bền vững (PostgreSQL) |

---

## 6. Nguyên Tắc Thiết Kế (Architectural Principles)

1. **Phụ thuộc một chiều (Unidirectional Dependency):**
   $$\text{apps/web} \longrightarrow \text{apps/api (Modules)} \longrightarrow \text{Core Services} \longrightarrow \text{Infrastructure}$$
   Tuyệt đối không có phụ thuộc vòng (no circular dependency) giữa các module.
2. **Độc lập và Cô lập (Loose Coupling):** Các module nghiệp vụ chỉ giao tiếp với nhau qua Services/Interfaces công khai, không truy cập trực tiếp vào DB Entity của module khác.
3. **Sẵn sàng tiến hóa (Evolution to Microservices):** Các module tiêu tốn nhiều tài nguyên tính toán như `knowledge` (RAG worker) hoặc `agents` (Agent execution engine) có thể dễ dàng tách thành các container/service độc lập ở Phase 2 mà không làm thay đổi logic các module còn lại.
