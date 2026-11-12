# Component Diagram — AIOS

> Mô tả chi tiết cấu trúc thành phần, luồng dữ liệu, interface và các điểm tích hợp hạ tầng trong hệ thống AIOS theo kiến trúc **Modular Monolith & Clean Architecture (Zero-Daemon trên Desktop)**.

---

## 1. High-Level Component Diagram

```mermaid
graph TD
    User(["👤 User (Browser / Desktop)"])

    subgraph Clients ["Client Layer"]
        WEB["🌐 React Web App\n(HTTPS Browser)"]
        DESK_MAIN["🖥️ Electron Main\n(Sidecar Lifecycle, Ports)"]
        DESK_REN["🖼️ Electron Renderer\n(Desktop UI)"]
    end

    subgraph SecurityLayer ["Security & Ingress Layer (127.0.0.1)"]
        PNA["🔒 PNA & CORS Middleware\n(Private Network Access)"]
        AUTH_GUARD["🛡️ AIOSAuthGuard\n(Keycloak JWT / Dev Bypass)"]
    end

    subgraph CoreModules ["Core Business Modules"]
        AUTH["🔑 Auth Module\n(@CurrentUser, Pairing, Claim)"]
        CONV["💬 Chat Module\n(Orchestration, SSE)"]
        KNOW["📚 Knowledge Module\n(RAG, Ingestion)"]
        MEM["🧠 Memory Module\n(Long-term Profile)"]
        PLAN["📅 Planner Module\n(Kanban, Tasks)"]
        WORK["⚙️ Workflow Module\n(DAG Engine)"]
        AGENT["🤖 Agents Module\n(ReAct Runner)"]
        TOOL["🔧 Tools Module\n(Registry, MCP Client)"]
        SYNC["🔄 Sync Module\n(E2EE Sync Engine)"]
    end

    subgraph CoreDomain ["Core Domain & Contracts (Caremate)"]
        CTX["📦 AgentExecutionContext\n(Immutable & userId)"]
        HOOK["🪝 Lifecycle Hook Engine\n(Pipeline & Policy Guard)"]
        LLM["🔮 LLM Gateway (ACL)\n(ILLMClient, IEmbeddingClient)"]
        QUEUE["📬 IJobQueue Contract\n(Queue Abstraction)"]
        OBS["📊 Observability\n(Tracing, Token Counter)"]
    end

    subgraph DesktopInfra ["Desktop Local Data Plane (Zero-Daemon)"]
        PGLITE[("🐘 PGlite WASM (In-Process)\n• Relational DB\n• Bundled pgvector (768d)\n• SQL Job Queue")]
        FS[("📁 Local App Data\n(userData/profile)")]
    end

    subgraph DevInfra ["Dev Infrastructure (Docker Compose)"]
        PG[("🗄️ PostgreSQL 16")]
        QD[("🧮 Qdrant Vector DB")]
        REDIS[("⚡ Redis / BullMQ")]
    end

    subgraph RemoteCloud ["Remote Cloud Services"]
        KC["🔐 Keycloak OIDC\n(Google IdP)"]
        SYNC_API["☁️ Sync API & Object Storage\n(E2EE Ciphertext Only)"]
        LLM_API["☁️ LLM Providers\n(OpenAI / Gemini / Anthropic)"]
    end

    %% Client flows
    User --> WEB
    User --> DESK_REN
    DESK_MAIN -- "Spawn & Monitor Sidecar" --> PNA
    WEB -- "PNA + Scoped Token" --> PNA
    DESK_REN -- "Local Loopback HTTP" --> PNA
    PNA --> AUTH_GUARD
    AUTH_GUARD --> AUTH

    %% Business Modules interaction
    AUTH_GUARD --> CONV
    AUTH_GUARD --> KNOW
    AUTH_GUARD --> MEM
    AUTH_GUARD --> PLAN
    AUTH_GUARD --> WORK
    AUTH_GUARD --> AGENT

    CONV -- "Create Context & Execute" --> CTX
    CTX --> HOOK
    HOOK -- "Enrich Memory" --> MEM
    HOOK -- "Enrich RAG Chunks" --> KNOW
    HOOK -- "Policy Guard" --> TOOL

    CONV -- "Prompt & Stream" --> LLM
    AGENT -- "Reason & Tool Call" --> LLM
    AGENT -- "Execute Tool" --> TOOL
    WORK -- "Enqueue Steps" --> QUEUE

    %% Infrastructure bindings
    CONV & MEM & PLAN & WORK & KNOW -->|Prisma| PGLITE
    KNOW -- "Vector Search" --> PGLITE
    QUEUE -. Desktop Adapter .-> PGLITE
    KNOW -- "File Store" --> FS
    SYNC -->|E2EE Envelopes| SYNC_API

    %% External
    AUTH -. Verify Token .-> KC
    LLM --> LLM_API
    HOOK -. Telemetry .-> OBS
```

---

## 2. Sequence Diagram — Chat với RAG, Memory & Lifecycle Hooks

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 Người dùng
    participant API as 🌐 ChatController
    participant Guard as 🛡️ AIOSAuthGuard
    participant Svc as 💬 ChatService
    participant Hook as 🪝 Lifecycle Hook Pipeline
    participant Mem as 🧠 MemoryModule
    participant Know as 📚 KnowledgeModule (RAG)
    participant LLM as 🔮 LLMGateway (ACL)
    participant DB as 🐘 PGlite (Prisma)
    participant OBS as 📊 Observability

    User->>API: POST /chat/stream (Bearer Token)
    API->>Guard: canActivate(context)
    Guard-->>API: Gắn @CurrentUser() { id, email }
    API->>Svc: handleStreamMessage(dto, user)

    Svc->>Svc: Tạo AgentExecutionContext (userId, sessionId, query)
    
    rect rgb(240, 248, 255)
    Note over Svc,Hook: Giai đoạn Immutable Hook: onBeforePromptBuild
    Svc->>Hook: onBeforePromptBuild(ctx)
    par Đọc Ký ức và Tìm kiếm Vector đồng thời theo userId
        Hook->>Mem: getRelevantMemory(ctx.query, ctx.userId)
        Mem-->>Hook: [User Preferences, Facts]
    and
        Hook->>Know: searchRelevantChunks(ctx.query, ctx.userId)
        Know-->>Hook: [DocumentChunk 1, 2, 3]
    end
    Hook->>Hook: Clone & nạp Memory + RAG vào ctx.prefetch
    Hook-->>Svc: ctx mới (Enriched Context)
    end

    Svc->>LLM: streamComplete(ctx)
    LLM->>LLM: PromptBuilder: Ghép SystemPrompt + History + RAG + Memory
    LLM-->>Svc: Luồng AsyncIterable Token Stream
    
    loop Từng Token
        Svc-->>API: Server-Sent Event (SSE)
        API-->>User: Hiển thị Token realtime
    end

    LLM-->>Svc: Kết thúc Stream (TokenUsage, Latency)
    
    par Lưu dữ liệu & Đo lường
        Svc->>DB: Lưu Message (kèm userId, version=1, softDelete=null)
    and
        Svc->>Hook: onAfterCompletion(response, ctx)
        Hook--)OBS: Ghi log Trace (Token, Latency, ExecutionId)
    end
```

---

## 3. Sequence Diagram — Agent ReAct Loop & Policy Guard

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 Người dùng
    participant API as 🌐 AgentsController
    participant Agent as 🤖 AgentsService (ReAct)
    participant Hook as 🪝 Policy Guard (onBeforeToolExecution)
    participant LLM as 🔮 LLMGateway
    participant Tool as 🔧 ToolsModule (MCP Client)
    participant OBS as 📊 Observability

    User->>API: POST /agents/run { task }
    API->>Agent: execute(task, currentUser)

    loop Vòng lặp ReAct (Tối đa maxIterations)
        Agent->>LLM: Suy luận (Task, History, ToolSchemas)
        LLM-->>Agent: Thought + Action (ToolCall: name, args)

        alt Có yêu cầu gọi Tool
            Agent->>Hook: onBeforeToolExecution(toolName, args, ctx)
            Note over Hook: Policy Guard: Kiểm tra quyền sở hữu (ctx.userId) & mức độ an toàn
            Hook-->>Agent: Phê duyệt (Approved)

            Agent->>Tool: execute(toolName, args)
            Tool-->>Agent: ToolResult

            Agent->>Hook: onAfterToolExecution(toolName, result, ctx)
            Agent->>LLM: Gửi ToolResult để Reflection (Đánh giá)
        else Hoàn thành nhiệm vụ (isFinish = true)
            Note over Agent: Thoát vòng lặp
        end
    end

    Agent->>Hook: onAfterCompletion(result, ctx)
    Hook--)OBS: Ghi log AgentRun
    Agent-->>API: Kết quả tổng hợp
    API-->>User: Phản hồi hoàn tất
```

---

## 4. Deployment View: Desktop Zero-Daemon vs Cloud

```mermaid
graph LR
    subgraph DesktopMachine ["Máy tính người dùng (Desktop Production)"]
        direction TB
        ELECTRON["Electron Shell\n(Main Process)"]
        
        subgraph SidecarProcess ["NestJS Sidecar (Duy nhất 1 Process)"]
            APP["NestJS App\n(All Business Modules)"]
            PGLITE_EMBED[("🐘 PGlite WASM\n(Relational + pgvector + Queue)")]
            APP ---|In-Process WASM| PGLITE_EMBED
        end
        
        DATA_DIR["📁 OS Application Data Root\n(userData/profile)"]
        ELECTRON -->|Spawn & Healthcheck| SidecarProcess
        PGLITE_EMBED -->|Read/Write SQLite-like Files| DATA_DIR
    end

    subgraph CloudServices ["Hạ tầng Đám mây (Remote Cloud)"]
        KEYCLOAK["🔐 Keycloak Identity\n(OIDC Server + Google IdP)"]
        SYNC_SERVER["☁️ Sync API & Object Storage\n(Ciphertext Sync Envelopes)"]
        LLM_HOSTED["☁️ LLM Provider APIs\n(OpenAI / Gemini / Anthropic)"]
    end

    SidecarProcess -. "Xác thực JWT" .-> KEYCLOAK
    SidecarProcess -->|"E2EE Sync (AES-256-GCM)"| SYNC_SERVER
    SidecarProcess -->|"Prompt & RAG Context"| LLM_HOSTED
```
