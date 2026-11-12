# Module Decomposition — AIOS

> Tài liệu phân rã hệ thống **AIOS (Personal AI Operating System)** dựa trên cấu trúc thực tế của dự án (**pnpm Monorepo: NestJS API + React Web + Electron Desktop + PGlite Zero-Daemon**).  
> Mục tiêu: Xác định ranh giới trách nhiệm rõ ràng cho từng module, đảm bảo tính độc lập (High Cohesion, Loose Coupling) theo Domain-Driven Design (DDD), sẵn sàng mở rộng, kiểm thử và đồng bộ E2EE an toàn.

---

## 1. Cấu trúc Tổng thể Dự án (Project Monorepo Structure)

Hệ thống được tổ chức dưới dạng monorepo quản lý bởi `pnpm`, chia tách rõ rệt giữa Backend API (`apps/api`), Frontend UI (`apps/web`), Desktop Shell (`apps/desktop`), Infrastructure (`docker`) và Shared Packages (`packages/`):

```text
AIOS/
├── apps/
│   ├── api/                             # NestJS Backend Application / Local Companion
│   │   ├── src/
│   │   │   ├── main.ts                  # Entry point (Bootstrap HTTP, PNA & WebSockets)
│   │   │   ├── app.module.ts            # Root Module tổng hợp toàn bộ modules
│   │   │   ├── app.controller.ts        # Health check & root endpoints
│   │   │   ├── app.service.ts
│   │   │   │
│   │   │   ├── core/                    # Core & Cross-cutting Contracts (Pure TS Interfaces)
│   │   │   │   ├── context/             # AgentExecutionContext (kèm userId), ContextBuilder
│   │   │   │   ├── hooks/               # AIOSHookHandler (Immutable Pipeline), HookRegistry
│   │   │   │   ├── llm/                 # ILLMClient, IEmbeddingClient, PromptBuilder
│   │   │   │   ├── queue/               # IJobQueue interface (độc lập BullMQ/pg-boss/SQL queue)
│   │   │   │   ├── observability/       # Tracing, Token Counter, Metrics, Logger
│   │   │   │   └── config/              # Configuration & Environment Validation
│   │   │   │
│   │   │   ├── modules/                 # Business Feature Modules (Nghiệp vụ cốt lõi)
│   │   │   │   ├── auth/                # AuthModule (Keycloak OIDC, Dual-Mode Guard, Pairing)
│   │   │   │   ├── chat/                # Module Quản lý hội thoại & Streaming
│   │   │   │   ├── knowledge/           # Module Tài liệu & RAG (Vector Search)
│   │   │   │   ├── memory/              # Module Ký ức dài hạn (User Profile/Preferences)
│   │   │   │   ├── planner/             # Module Kế hoạch, Task & Roadmap
│   │   │   │   ├── workflow/            # Module Workflow Engine (Multi-step DAG)
│   │   │   │   ├── agents/              # Module Multi-Agent Orchestration & ReAct
│   │   │   │   ├── tools/               # Module Tool Registry, MCP Client & Policy Guard
│   │   │   │   └── sync/                # Module E2EE Sync Engine, Manifests & Tombstones
│   │   │   │
│   │   │   └── infrastructure/          # Tầng kết nối Hạ tầng kỹ thuật (Adapters)
│   │   │       ├── database/            # PrismaService (Hỗ trợ PGlite Desktop & Postgres Dev)
│   │   │       ├── vector-store/        # PgVectorAdapter (Desktop) / QdrantAdapter (Dev)
│   │   │       ├── queue/               # PgLiteQueueAdapter (Desktop) / BullMQAdapter (Dev)
│   │   │       ├── llm-providers/       # OpenAIAdapter, GeminiAdapter, OllamaAdapter
│   │   │       └── storage/             # Quản lý file nhị phân cục bộ (Local Filesystem)
│   │   │
│   │   ├── prisma/
│   │   │   ├── schema.prisma            # Prisma Schema (Users, Ownership & Sync Fields)
│   │   │   └── migrations/
│   │   ├── test/                        # E2E & Integration Tests (Jest)
│   │   └── package.json
│   │
│   ├── web/                             # React Frontend (Vite + TypeScript + Tailwind)
│   │   ├── src/
│   │   │   ├── components/              # Shared UI components (ChatBox, Kanban, FileViewer)
│   │   │   ├── views/                   # Views tương ứng với các module API (Chat, Knowledge, Plan...)
│   │   │   ├── hooks/                   # useChatStream, useAgentRun, useCompanionPairing
│   │   │   └── stores/                  # Zustand Stores (AuthStore, SyncStore, SettingsStore)
│   │   └── package.json
│   │
│   └── desktop/                         # Electron Desktop Application
│       ├── src/
│       │   ├── main/                    # Electron Main (Sidecar lifecycle, dynamic ports, OS APIs)
│       │   ├── preload/                 # Preload Script (An toàn, không Node integration)
│       │   └── renderer/                # Desktop UI bundle (chia sẻ code với web)
│       └── package.json
│
├── docker/                              # Cấu hình container hóa hạ tầng (Môi trường Dev)
│   └── docker-compose.yml               # PostgreSQL, Qdrant/pgvector, Redis
│
├── packages/                            # Shared Libraries & Contracts dùng chung
│   └── shared-types/                    # DTOs, Enums, Sync Envelopes dùng chung giữa API/Web/Desktop
│
├── docs/                                # Tài liệu kỹ thuật & Kiến trúc
├── pnpm-workspace.yaml                  # Khai báo Monorepo Workspace
└── README.md
```

---

## 2. Chi tiết các Business Module (`apps/api/src/modules`)

Mỗi module nghiệp vụ trong NestJS tuân theo cấu trúc tiêu chuẩn:
- `*.module.ts`: Khai báo module, dependency injection providers và exports.
- `*.controller.ts`: Tiếp nhận HTTP requests, kiểm tra `@CurrentUser()`.
- `*.service.ts`: Xử lý business logic và điều phối tác vụ.
- `*.repository.ts`: Tầng lưu trữ duy nhất chạm tới Prisma, bắt buộc lọc theo `userId` và `deletedAt: null`.
- `dto/`: Data Transfer Objects (Validation input với `class-validator`).

---

### 2.1. `modules/auth` — Auth & Identity Module
| Thuộc tính | Chi tiết |
|---|---|
| **Vị trí** | `apps/api/src/modules/auth/` |
| **Trách nhiệm** | Quản lý bảng chiếu người dùng `User`, xác thực token Keycloak OIDC, cung cấp `AIOSAuthGuard` đa chế độ, cơ chế Pairing Web-Companion qua PNA, và import/claim dữ liệu dev cũ. |
| **Input** | Authorization Header (`Bearer <JWT>` hoặc `Bearer <PairingToken>`), Claim Data DTO. |
| **Output** | `AuthenticatedUser` gắn vào `request.user` (chứa `id`, `email`, `keycloakSubject`). |
| **Dependencies** | `infrastructure/database` (Prisma) |

**Thành phần cốt lõi:**
- `AIOSAuthGuard`: Global Guard hỗ trợ 2 mode: `keycloak` (xác thực JWKS từ remote Keycloak) và `dev_bypass` (tự resolve `Default Local User`).
- `CurrentUser` Decorator: Trích xuất `AuthenticatedUser` cho Controller để truyền `userId` xuống Service/Repository.
- `CompanionPairingService`: Xử lý sinh mã one-time pairing và cấp short-lived token cho Web App qua PNA.

---

### 2.2. `modules/chat` — Chat & Conversation Module
| Thuộc tính | Chi tiết |
|---|---|
| **Vị trí** | `apps/api/src/modules/chat/` |
| **Trách nhiệm** | Quản lý vòng đời cuộc hội thoại, lưu trữ tin nhắn, điều phối luồng hỏi - đáp (Orchestrator) qua `AgentExecutionContext`, và streaming token về Client qua SSE. |
| **Input** | User message payload (`CreateChatDto`), conversationId, streaming options, `@CurrentUser()`. |
| **Output** | Streaming response (Server-Sent Events) hoặc JSON Message. |
| **Dependencies** | `core/llm`, `core/context`, `core/hooks`, `modules/knowledge`, `modules/memory`, `infrastructure/database` |

---

### 2.3. `modules/knowledge` — Knowledge & RAG Module
| Thuộc tính | Chi tiết |
|---|---|
| **Vị trí** | `apps/api/src/modules/knowledge/` |
| **Trách nhiệm** | Tiếp nhận tài liệu (PDF, Markdown, DOCX), trích xuất văn bản, chunking (`RecursiveTextSplitter`), sinh vector nhúng và tìm kiếm ngữ nghĩa theo `userId`. |
| **Input** | Upload file nhị phân, Search Query string, Top-K parameter, `@CurrentUser()`. |
| **Output** | Danh sách `DocumentChunk` phù hợp kèm điểm tương đồng (similarity score). |
| **Dependencies** | `core/llm` (Embedding Service), `core/queue` (`IJobQueue`), `infrastructure/vector-store`, `infrastructure/storage` |

---

### 2.4. `modules/memory` — Long-Term Memory Module
| Thuộc tính | Chi tiết |
|---|---|
| **Vị trí** | `apps/api/src/modules/memory/` |
| **Trách nhiệm** | Lưu trữ và truy xuất thông tin dài hạn về người dùng theo cặp `(userId, key)` và danh mục (`profile`, `preference`, `fact`), phục vụ nạp memory vào prompt. |
| **Input** | Khóa (`key`), giá trị (`value`), danh mục (`category`), `@CurrentUser()`. |
| **Output** | Danh sách Memory record hoặc Memory Profile tổng hợp. |
| **Dependencies** | `infrastructure/database` (PGlite/PostgreSQL) |

---

### 2.5. `modules/planner` — Planner & Task Management Module
| Thuộc tính | Chi tiết |
|---|---|
| **Vị trí** | `apps/api/src/modules/planner/` |
| **Trách nhiệm** | Quản lý kế hoạch (`Plan`), danh sách công việc (`Task`) và lộ trình (`Roadmap`) theo `userId`. Hỗ trợ phân rã sub-tasks và tự động cập nhật tiến độ bởi AI. |
| **Input** | Tiêu đề kế hoạch, mô tả, sub-tasks, hạn hoàn thành, `@CurrentUser()`. |
| **Output** | Trạng thái kế hoạch (`active`, `completed`), danh sách task chi tiết. |
| **Dependencies** | `infrastructure/database` (PGlite/PostgreSQL) |

---

### 2.6. `modules/workflow` — Workflow Engine Module
| Thuộc tính | Chi tiết |
|---|---|
| **Vị trí** | `apps/api/src/modules/workflow/` |
| **Trách nhiệm** | Định nghĩa, điều phối và thực thi các quy trình tự động hóa nhiều bước (Multi-step DAG). Hỗ trợ lưu trạng thái trung gian để có thể Pause, Resume hoặc Cancel. |
| **Input** | Workflow Definition, Step configurations, input parameters, `@CurrentUser()`. |
| **Output** | Kết quả thực thi từng bước (`StepResult`), trạng thái cuối cùng của Workflow. |
| **Dependencies** | `core/queue` (`IJobQueue`), `modules/agents`, `modules/tools`, `infrastructure/database` |

---

### 2.7. `modules/agents` — Multi-Agent Orchestration Module
| Thuộc tính | Chi tiết |
|---|---|
| **Vị trí** | `apps/api/src/modules/agents/` |
| **Trách nhiệm** | Quản lý và điều phối các AI Agent chuyên biệt (Research, Coding, Planner). Triển khai vòng lặp suy luận ReAct Loop (`Reason` → `Act` → `Reflect`). |
| **Input** | Yêu cầu nhiệm vụ (`AgentExecutionContext`), Agent Role, danh sách Tools cho phép. |
| **Output** | Kết quả xử lý sau quá trình tự suy luận và gọi công cụ (Tool Calls). |
| **Dependencies** | `core/llm`, `core/hooks`, `modules/tools`, `modules/workflow` |

---

### 2.8. `modules/tools` — Tool Registry & Execution Module
| Thuộc tính | Chi tiết |
|---|---|
| **Vị trí** | `apps/api/src/modules/tools/` |
| **Trách nhiệm** | Đăng ký công cụ, sinh JSON Schema cho LLM Function Calling, tích hợp Model Context Protocol (MCP) và áp dụng Policy Guard qua `onBeforeToolExecution`. |
| **Input** | Tool Name, JSON Schema input parameters, `AgentExecutionContext`. |
| **Output** | Dữ liệu trả về từ công cụ (`ToolResult`). |
| **Dependencies** | External Tools (Filesystem Sandbox, GitHub API, Search API, Planner Tool) |

---

### 2.9. `modules/sync` — End-to-End Encrypted Sync Module
| Thuộc tính | Chi tiết |
|---|---|
| **Vị trí** | `apps/api/src/modules/sync/` |
| **Trách nhiệm** | Đóng gói dữ liệu local thành `EncryptedSyncItem` (Sync Envelopes - AES-256-GCM), xử lý đồng bộ Tombstone xóa mềm, và thực hiện Smart Vector Sync (nén `Float32Array`). |
| **Input** | Modified local entities (Document, Message, Memory, Plan), Sync Token. |
| **Output** | Danh sách Sync Envelopes mã hóa đẩy lên Remote Sync Storage. |
| **Dependencies** | `infrastructure/database`, Remote Sync API |

---

## 3. Chi tiết Tầng Dùng Chung & Hạ Tầng (Core & Infrastructure)

### 3.1. `core/context` & `core/hooks` — Caremate Abstractions
* **`AgentExecutionContext`:** Đối tượng bất biến (`readonly`) mang `userId` ngay từ gốc, kèm context (user profile, system rules, active plans) và prefetch data (RAG chunks, recent messages).
* **`AIOSHookHandler`:** Hệ thống Hook đánh chặn bất biến:
  - `onBeforePromptBuild`: Làm giàu prompt theo chuỗi Functional Pipeline (`ctx = await hook.onBeforePromptBuild(ctx)`).
  - `onBeforeToolExecution`: Policy guard kiểm tra quyền sở hữu (`userId`) và mức độ an toàn trước khi chạy Tool.
  - `onAfterToolExecution`: Ghi nhận kết quả tool cho LLM reflection.
  - `onAfterCompletion`: Thu thập trace, token usage và đo độ trễ.

### 3.2. `core/llm` & `core/queue` — Anti-Corruption Layer
* **`ILLMClient` & `IEmbeddingClient`:** Cô lập nghiệp vụ khỏi các thư viện bên ngoài (OpenAI, Gemini, Anthropic, Ollama).
* **`IJobQueue`:** Trừu tượng hóa hàng đợi nền, độc lập hoàn toàn với công nghệ thực thi bên dưới (BullMQ hay PGlite Table Queue).

### 3.3. `infrastructure/` — Adapters Thực Thi
* **Desktop Runtime (Zero-Daemon):**
  - **`PGlite` + bundled `pgvector`:** PostgreSQL chạy dạng WASM nhúng ngay trong tiến trình Node.js của NestJS thông qua `@prisma/adapter-pglite`. Lưu trữ toàn bộ dữ liệu quan hệ, canonical chunks, và chỉ mục vector HNSW vào một thư mục trong `userData`.
  - **`PgVectorAdapter`:** Adapter truy vấn vector trực tiếp qua extension `pgvector` có sẵn trong PGlite.
  - **`PgLiteQueueAdapter`:** Hàng đợi tác vụ nền chạy trực tiếp trên bảng SQL của PGlite (thay thế hoàn toàn Redis).
* **Development / Cloud Runtime:**
  - Standard PostgreSQL 16 + `QdrantAdapter` + `BullMQAdapter` (chạy qua Docker Compose).

---

## 4. Chi tiết Ứng Dụng Client (`apps/web` & `apps/desktop`)

1. **React Web App (`apps/web`):**
   - Chạy trên trình duyệt (HTTPS).
   - Đăng nhập qua Keycloak OIDC, hiển thị giao diện chat, knowledge hub, memory và kanban planner.
   - Kết nối với Local Companion thông qua Private Network Access (PNA) kèm pairing token. Nếu chưa pair, web hoạt động ở chế độ portal (quản lý tài khoản, tải desktop app, xem trạng thái sync).
2. **Electron Desktop App (`apps/desktop`):**
   - Electron Main quản lý vòng đời NestJS sidecar, cấp phát port động (`Dynamic Port Allocation`), kiểm tra health-check và shutdown an toàn.
   - Đóng gói UI bằng Electron Renderer (gọi local API tương tự web app).
   - Preload Script bảo mật: không bật `nodeIntegration`, kiểm tra nghiêm ngặt IPC message.

---

## 5. Ma Trận Phụ Thuộc Module (Module Dependency Matrix)

| Module gọi (Caller) | Module phụ thuộc (Callee) | Mục đích giao tiếp |
|---|---|---|
| `apps/web` / `apps/desktop` | `apps/api` | REST API calls & SSE Streaming (qua Localhost / PNA) |
| `modules/chat` | `core/llm`, `core/hooks` | Gửi prompt hoàn chỉnh, chạy pipeline enrich và nhận token stream |
| `modules/chat` | `modules/knowledge`, `modules/memory` | Truy xuất top-k chunks và memory dài hạn theo `ctx.userId` |
| `modules/knowledge` | `core/llm` | Sinh embedding vector cho document chunks |
| `modules/knowledge` | `infrastructure/vector-store` | Lưu và tìm kiếm vector tương đồng (`PgVectorAdapter` / `Qdrant`) |
| `modules/agents` | `core/llm`, `modules/tools` | Vòng lặp ReAct: suy luận và kích hoạt công cụ có Policy Guard |
| `modules/workflow` | `core/queue`, `modules/tools` | Đẩy task vào hàng đợi `IJobQueue` và thực thi các bước trong DAG |
| `modules/sync` | `infrastructure/database` | Đọc dữ liệu local kèm `deletedAt` (tombstone) để mã hóa E2EE |
| `Tất cả modules` | `modules/auth` | Nhận diện người dùng qua `@CurrentUser()` và `AIOSAuthGuard` |

---

## 6. Nguyên Tắc Thiết Kế (Architectural Principles)

1. **Phụ thuộc một chiều (Unidirectional Dependency):**
   $$\text{Clients (Web/Desktop)} \longrightarrow \text{API Layer (Modules)} \longrightarrow \text{Core Contracts} \longleftarrow \text{Infrastructure (Adapters)}$$
   Tầng Core không phụ thuộc vào bất kỳ thư viện bên ngoài hay module nào khác.
2. **Cô lập Dữ liệu Người dùng (Data Isolation):**
   Mọi thao tác đọc/ghi/tìm kiếm đều phải có `userId` làm điều kiện tiên quyết. Không cho phép bất kỳ truy vấn nào bỏ qua ownership.
3. **Local-First & Zero-Daemon:**
   Bản Desktop ưu tiên tối đa tính tự chứa (self-contained): không yêu cầu cài đặt Docker, không spawn các daemon cồng kềnh ngoài NestJS sidecar.
