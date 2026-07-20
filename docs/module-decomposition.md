# Module Decomposition — AIOS

> Phân rã hệ thống AIOS thành các module độc lập với ranh giới trách nhiệm rõ ràng.
> Mục tiêu: mỗi module có thể phát triển, test, và thay thế độc lập mà không ảnh hưởng đến module khác.

---

## Tổng quan cấu trúc module

```
aios/
├── core/                        # Shared kernel & cross-cutting concerns
│   ├── llm/                     # LLM Gateway (abstraction layer)
│   ├── observability/           # Tracing, metrics, logging
│   └── config/                  # Configuration management
│
├── modules/
│   ├── conversation/            # Chat & Conversation Module
│   ├── knowledge/               # Knowledge & RAG Module
│   ├── memory/                  # Long-term Memory Module
│   ├── planner/                 # Planning & Task Management Module
│   ├── tool/                    # Tool Registry & Execution Module
│   ├── workflow/                # Workflow Engine Module
│   └── agent/                   # Multi-Agent Orchestration Module
│
├── infrastructure/
│   ├── database/                # PostgreSQL (Prisma ORM)
│   ├── vector-store/            # Vector Database (Qdrant / pgvector)
│   ├── file-storage/            # Local filesystem management
│   └── cache/                   # Redis (session, rate limit)
│
└── api/
    ├── http/                    # REST API (NestJS Controllers)
    └── ws/                      # WebSocket (Streaming)
```

---

## Chi tiết từng Module

### 1. `core/llm` — LLM Gateway

| Thuộc tính | Giá trị |
|---|---|
| **Trách nhiệm** | Trừu tượng hóa việc gọi LLM, ẩn provider cụ thể |
| **Input** | Danh sách messages, tool schemas, parameters |
| **Output** | Completion text hoặc tool call request |
| **Dependencies** | Không phụ thuộc module nghiệp vụ nào |
| **Provider** | OpenAI / Anthropic / Gemini / Ollama |

**Thành phần:**
- `LLMClient` — interface gọi model
- `PromptBuilder` — xây dựng prompt từ context
- `StreamingAdapter` — xử lý streaming response
- `TokenCounter` — đếm và kiểm soát token

---

### 2. `modules/conversation` — Chat Module

| Thuộc tính | Giá trị |
|---|---|
| **Trách nhiệm** | Quản lý cuộc hội thoại, điều phối luồng xử lý tin nhắn |
| **Input** | User message |
| **Output** | AI response (stream / full) |
| **Dependencies** | `core/llm`, `knowledge`, `memory` |

**Thành phần:**
- `ConversationService` — CRUD conversation
- `MessageService` — xử lý message
- `ChatOrchestrator` — điều phối: đọc memory → gọi RAG → gọi LLM → lưu history

---

### 3. `modules/knowledge` — Knowledge & RAG Module

| Thuộc tính | Giá trị |
|---|---|
| **Trách nhiệm** | Upload tài liệu, embedding, tìm kiếm ngữ nghĩa (RAG) |
| **Input** | File (PDF/MD/DOCX), search query |
| **Output** | DocumentChunks liên quan nhất |
| **Dependencies** | `core/llm` (embedding), `infrastructure/vector-store`, `infrastructure/file-storage` |

**Thành phần:**
- `DocumentService` — upload, delete, list
- `ChunkingService` — chia nhỏ document
- `EmbeddingService` — tạo vector embedding
- `VectorSearchService` — tìm kiếm semantic

---

### 4. `modules/memory` — Memory Module

| Thuộc tính | Giá trị |
|---|---|
| **Trách nhiệm** | Lưu trữ và truy xuất ký ức dài hạn của người dùng |
| **Input** | Key-value pair + category |
| **Output** | Danh sách memory liên quan |
| **Dependencies** | `infrastructure/database` |

**Thành phần:**
- `MemoryService` — CRUD memory
- `MemoryRetriever` — tìm memory liên quan theo query

---

### 5. `modules/planner` — Planner Module

| Thuộc tính | Giá trị |
|---|---|
| **Trách nhiệm** | Quản lý kế hoạch và danh sách công việc |
| **Input** | Plan title, task descriptions, due dates |
| **Output** | Plan list, task status |
| **Dependencies** | `infrastructure/database` |

**Thành phần:**
- `PlanService` — CRUD Plan
- `TaskService` — CRUD Task
- `PlannerTool` — Tool adapter để AI có thể gọi qua ToolCall

---

### 6. `modules/tool` — Tool Module

| Thuộc tính | Giá trị |
|---|---|
| **Trách nhiệm** | Đăng ký, validate và thực thi các tool |
| **Input** | Tool name + input JSON |
| **Output** | Tool result |
| **Dependencies** | External services (Search API, Weather API...) |

**Thành phần:**
- `ToolRegistry` — đăng ký và quản lý danh sách tool
- `ToolExecutor` — thực thi tool call
- Tools built-in: `SearchTool`, `WeatherTool`, `CalculatorTool`, `FilesystemTool`

---

### 7. `modules/workflow` — Workflow Module

| Thuộc tính | Giá trị |
|---|---|
| **Trách nhiệm** | Định nghĩa và chạy các workflow nhiều bước |
| **Input** | Workflow definition (YAML/JSON hoặc AI-generated) |
| **Output** | Kết quả sau từng bước |
| **Dependencies** | `modules/tool`, `modules/agent`, `infrastructure/database` |

**Thành phần:**
- `WorkflowEngine` — điều phối thứ tự bước
- `StepExecutor` — thực thi từng step
- `WorkflowRepository` — lưu trạng thái để resume

---

### 8. `modules/agent` — Agent Module

| Thuộc tính | Giá trị |
|---|---|
| **Trách nhiệm** | Tạo và điều phối các agent chuyên biệt |
| **Input** | Task description |
| **Output** | Task result sau nhiều vòng lặp (reason → act → reflect) |
| **Dependencies** | `core/llm`, `modules/tool`, `modules/workflow` |

**Thành phần:**
- `AgentRunner` — vòng lặp ReAct (Reason + Act)
- `AgentRouter` — định tuyến tới agent phù hợp
- `ReflectionService` — AI tự đánh giá kết quả
- Agents: `ResearchAgent`, `CodingAgent`, `LearningAgent`, `ReviewAgent`

---

### 9. `core/observability` — Observability Module

| Thuộc tính | Giá trị |
|---|---|
| **Trách nhiệm** | Ghi lại trace, span, metrics toàn hệ thống |
| **Input** | Events từ các module (LLM call, tool call, latency...) |
| **Output** | Dashboard / log file |
| **Dependencies** | External: OpenTelemetry, Langfuse (optional) |

**Thành phần:**
- `TraceCollector` — thu thập trace
- `SpanRecorder` — ghi từng span
- `MetricsDashboard` — hiển thị metrics

---

## Ma trận phụ thuộc module

| Module | Phụ thuộc vào |
|---|---|
| `conversation` | `llm`, `knowledge`, `memory` |
| `knowledge` | `llm` (embedding), `vector-store`, `file-storage` |
| `memory` | `database` |
| `planner` | `database` |
| `tool` | External APIs |
| `workflow` | `tool`, `agent`, `database` |
| `agent` | `llm`, `tool`, `workflow` |
| `observability` | Nhận events từ tất cả module |
| `llm` | External LLM API |

> **Nguyên tắc:** Không có phụ thuộc vòng (circular dependency). Dependency chỉ đi một chiều từ module nghiệp vụ → core → infrastructure.
