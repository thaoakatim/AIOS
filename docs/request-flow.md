# AIOS Request Flow Specification

> **Tài liệu đặc tả chi tiết các luồng xử lý yêu cầu (Request Flow) trong hệ thống AIOS**  
> *Mô tả tường tận từ thời điểm Client gửi Request qua Ingress & Security Layer (PNA, AuthGuard), đi qua Lifecycle Hooks, Service Orchestrator, Core Gateway đến Hạ tầng lưu trữ (PGlite, Vector Store) và Streaming kết quả ngược lại.*

---

## 1. Tổng quan Các Loại Request trong AIOS

Hệ thống AIOS tiếp nhận và xử lý 6 luồng request chính:

1. **Flow 1: Conversational Chat Flow (Chat + Memory + RAG + Streaming):** Luồng trò chuyện trực tiếp với phản hồi streaming token qua SSE, có làm giàu context qua Immutable Hook Pipeline.
2. **Flow 2: Autonomous Agent Flow (ReAct Loop + Tool/MCP + Policy Guard):** Luồng thực thi nhiệm vụ phức tạp tự trị (`Reason` → `Act` → `Reflect`) có kiểm duyệt quyền sở hữu (`userId`) qua Policy Guard.
3. **Flow 3: Knowledge Ingestion & Indexing Flow:** Luồng tải lên tài liệu và xử lý trích xuất văn bản, chunking, sinh vector nhúng chạy ngầm qua `IJobQueue` (`PgLiteQueueAdapter` trên Desktop).
4. **Flow 4: Workflow Execution Flow (Multi-step DAG Pipeline):** Luồng điều phối các quy trình tự động hóa nhiều bước có lưu vết trạng thái để Pause/Resume.
5. **Flow 5: Background Memory Extraction Flow:** Luồng ngầm tự động phân tích hội thoại để trích xuất thói quen, sở thích của người dùng và lưu vào `memory_records` theo cặp `(userId, key)`.
6. **Flow 6: End-to-End Encrypted Sync Flow:** Luồng đóng gói dữ liệu local thành Sync Envelopes (AES-256-GCM), đồng bộ Tombstone và truyền mảng nhị phân vector nhúng (`Float32Array`).

---

## 2. Flow 1: Conversational Chat Flow (Chat + RAG + Memory)

Đây là luồng tương tác phổ biến nhất khi người dùng đặt câu hỏi trực tiếp trên Web hoặc Desktop Client.

### 2.1. Biểu đồ Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 User (Web / Desktop UI)
    participant Ingress as 🔒 PNA / Security
    participant API as 🌐 ChatController
    participant Guard as 🛡️ AIOSAuthGuard
    participant Svc as 💬 ChatService
    participant Hook as 🪝 Lifecycle Hooks
    participant Mem as 🧠 MemoryModule
    participant Know as 📚 KnowledgeModule (RAG)
    participant LLM as 🔮 LLMGateway (ACL)
    participant Provider as ☁️ LLM Provider (OpenAI/Gemini)
    participant DB as 🐘 PGlite / PostgreSQL (Prisma)
    participant OBS as 📊 Observability

    User->>Ingress: POST /chat/stream { conversationId, content }
    Ingress->>API: Forward (Validated Origin / Localhost)
    API->>Guard: canActivate()
    Guard-->>API: Gắn @CurrentUser() { id: userId, email }
    API->>Svc: handleStreamMessage(dto, currentUser)
    
    %% Tạo Context
    Svc->>Svc: Tạo AgentExecutionContext (userId, executionId, sessionId, query)

    %% Giai đoạn Hook onBeforePromptBuild (Immutable Pipeline)
    rect rgb(240, 248, 255)
    Note over Svc,Hook: Giai đoạn Immutable Hook Pipeline: onBeforePromptBuild
    Svc->>Hook: onBeforePromptBuild(ctx)
    par Lấy Memory & RAG đồng thời theo đúng ctx.userId
        Hook->>Mem: getRelevantMemory(ctx.query, ctx.userId)
        Mem-->>Hook: [User Preferences, Facts]
    and
        Hook->>Know: searchRelevantChunks(ctx.query, ctx.userId, topK=4)
        Know-->>Hook: [DocumentChunk 1, 2, 3]
    end
    Hook->>Hook: Clone & nạp Memory + RAG vào ctx.prefetch
    Hook-->>Svc: ctx mới đã được làm giàu (Enriched Context)
    end

    %% Gửi sang LLM Gateway
    Svc->>LLM: streamComplete(ctx)
    LLM->>LLM: PromptBuilder: Gộp SystemPrompt + Memory + RAG + ChatHistory
    LLM->>Provider: Gửi Request (Stream mode = true)
    Provider-->>LLM: Luồng AsyncIterable Token Chunk
    
    %% Streaming phản hồi về Client qua SSE
    loop Từng Token nhận về từ Provider
        LLM-->>Svc: token
        Svc-->>API: SSE Event: { type: 'token', content: '...' }
        API-->>User: Server-Sent Event (SSE Stream)
    end

    %% Hoàn tất & Hook onAfterCompletion
    Provider-->>LLM: Kết thúc Stream (Usage: tokens, finishReason)
    LLM-->>Svc: Full Response Text + Metadata
    
    par Lưu dữ liệu & Ghi Observability
        Svc->>DB: Lưu User Message & Assistant Message (kèm userId, version=1)
    and
        Svc->>Hook: onAfterCompletion(response, ctx)
        Hook--)OBS: Ghi log Trace (Latency, Prompt Tokens, Completion Tokens)
    end
    
    API-->>User: SSE Event: { type: 'done', messageId: '...' }
```

---

## 3. Flow 2: Autonomous Agent Flow (ReAct Loop + Tool/MCP Execution)

Luồng kích hoạt khi người dùng giao một nhiệm vụ phức tạp đòi hỏi Agent phải tự suy luận và gọi công cụ bên ngoài.

### 3.1. Biểu đồ Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 User
    participant API as 🌐 AgentsController
    participant Svc as 🤖 AgentsService (ReAct)
    participant Hook as 🪝 Policy Guard (onBeforeToolExecution)
    participant LLM as 🔮 LLMGateway
    participant Registry as 🔧 ToolRegistry
    participant MCP as 🔌 Tool / MCP Server (GitHub/Filesystem)
    participant OBS as 📊 Observability

    User->>API: POST /agents/run { task: "Check GitHub issues & update plan" }
    API->>Svc: runAgent(dto, currentUser)
    Svc->>Svc: Khởi tạo AgentExecutionContext (gắn userId) & AgentSession

    loop Vòng lặp ReAct (Tối đa maxIterations)
        Note over Svc,LLM: 1. REASON (Suy luận)
        Svc->>Registry: getAvailableToolSchemas()
        Registry-->>Svc: [github_list_issues, planner_add_task]
        Svc->>LLM: generateStep(task, history, toolSchemas)
        LLM-->>Svc: Trả về Thought + ToolCall { name: 'github_list_issues', args: { repo: 'AIOS' } }

        alt LLM quyết định gọi Tool (Action)
            Note over Svc,MCP: 2. ACT (Thực thi có kiểm duyệt an toàn)
            Svc->>Hook: onBeforeToolExecution(toolName, args, ctx)
            Note over Hook: Policy Guard: Kiểm tra quyền sở hữu (ctx.userId) & mức độ an toàn
            Hook-->>Svc: Cho phép thực thi (Approved)

            Svc->>Registry: execute(toolName, args)
            Registry->>MCP: Gọi Tool nội bộ hoặc MCP Server qua stdio/SSE
            MCP-->>Registry: Dữ liệu kết quả (Raw JSON Issues)
            Registry-->>Svc: ToolResult

            Svc->>Hook: onAfterToolExecution(toolName, result, ctx)

            Note over Svc,LLM: 3. REFLECT (Đánh giá lại)
            Svc->>Svc: Append ToolResult vào Agent Session History
        else LLM kết luận đã hoàn thành nhiệm vụ (isFinish = true)
            Note over Svc: Thoát vòng lặp ReAct
        end
    end

    Svc->>Hook: onAfterCompletion(finalOutput, ctx)
    Hook--)OBS: Ghi log Session, danh sách ToolCalls, Latency
    Svc-->>API: AgentExecutionResult
    API-->>User: Phản hồi tổng hợp kết quả công việc
```

---

## 4. Flow 3: Knowledge Ingestion & Indexing Flow

Xử lý khi người dùng tải lên tài liệu (PDF, Markdown, DOCX) để đưa vào RAG.

### 4.1. Biểu đồ Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 User
    participant API as 🌐 KnowledgeController
    participant Svc as 📚 KnowledgeService
    participant FS as 📁 Local Storage (userData)
    participant Queue as 📬 IJobQueue (PgLiteQueueAdapter / BullMQ)
    participant Worker as ⚙️ IngestionWorker
    participant LLM as 🔮 EmbeddingGateway
    participant DB as 🐘 PGlite / PostgreSQL (Prisma)

    User->>API: POST /knowledge/upload (Multipart Form Data, Bearer Token)
    API->>Svc: uploadDocument(file, currentUser)
    
    %% Lưu file và ghi nhận DB
    Svc->>FS: Lưu file vào thư mục profile của userId trong userData
    Svc->>DB: Tạo Document record (userId, status='PENDING', version=1)
    DB-->>Svc: documentId
    
    %% Đẩy việc vào IJobQueue
    Svc->>Queue: enqueueJob('document-ingestion', { documentId, userId })
    Svc-->>API: Trả về { documentId, status: 'PROCESSING' }
    API-->>User: Upload thành công, đang xử lý ngầm

    %% Worker ngầm bắt đầu xử lý
    Note over Queue,Worker: Xử lý Bất đồng bộ trong Background
    Queue->>Worker: Dispatch Job (documentId, userId)
    Worker->>FS: Đọc file từ đĩa
    Worker->>Worker: Parse text & RecursiveTextSplitter (chunking)
    
    loop Từng batch DocumentChunks (VD: 10 chunks/lần)
        Worker->>LLM: getEmbeddings(chunksText[])
        LLM-->>Worker: Mảng vectors 768 chiều
        Worker->>DB: Lưu DocumentChunk (embedding vector(768), embeddingModel, version=1)
    end

    Worker->>DB: Cập nhật Document (status = 'INDEXED', totalChunks = X)
    Worker--)User: Thông báo hoàn tất qua SSE/WebSocket
```

---

## 5. Flow 6: End-to-End Encrypted Sync Flow

Đồng bộ an toàn giữa thiết bị local và Cloud Sync Server.

```mermaid
sequenceDiagram
    autonumber
    actor Client1 as 💻 Thiết bị 1 (Local Companion)
    participant SyncEng as 🔄 SyncEngine
    participant CloudSync as ☁️ Remote Sync API
    participant Client2 as 📱 Thiết bị 2 (New Device)

    Note over Client1,SyncEng: Người dùng thay đổi Plan hoặc upload Document
    Client1->>SyncEng: triggerSync()
    SyncEng->>SyncEng: Đọc các record có updatedAt > lastSyncTimestamp
    SyncEng->>SyncEng: Mã hóa AES-256-GCM bằng Vault Key (Zero-Knowledge)
    
    opt Nếu có Chunk Embedding trả phí (Cloud Embedding)
        SyncEng->>SyncEng: Nén nhị phân Float32Array vector (768 chiều)
        SyncEng->>SyncEng: Mã hóa mảng vector đưa vào Sync Envelope (Smart Vector Sync)
    end

    SyncEng->>CloudSync: POST /sync/envelopes (EncryptedSyncItems[])
    Note over CloudSync: Server chỉ lưu Ciphertext, IV, AuthTag & Tombstones

    %% Thiết bị 2 kéo về
    Client2->>CloudSync: GET /sync/envelopes?since=timestamp
    CloudSync-->>Client2: Danh sách EncryptedSyncItems[]
    Client2->>Client2: Giải mã bằng Vault Key (phục hồi qua Recovery Key)
    Client2->>Client2: Upsert dữ liệu vào PGlite local
    Client2->>Client2: Nạp thẳng mảng vector Float32Array vào pgvector (không tốn phí API)
```

---

## 6. Luồng Bảo Mật Browser PNA & Companion Pairing

Khi người dùng mở Web App trên trình duyệt (`https://app.aios.local` hoặc host remote) và muốn tương tác với Local Companion (`http://127.0.0.1:PORT`):

1. **Preflight PNA:** Trình duyệt gửi request `OPTIONS` kèm header `Access-Control-Request-Private-Network: true`. Local Companion phản hồi `Access-Control-Allow-Private-Network: true` kèm allowed origin.
2. **Pairing Challenge:** 
   * Người dùng nhấn "Pair with Desktop" trên Web App.
   * Desktop App hiển thị mã xác nhận Pairing Challenge (6 ký tự hoặc QR code) do người dùng chủ động yêu cầu.
   * Web App nhập mã challenge gửi xuống Local Companion.
   * Local Companion xác thực mã và cấp một `Scoped Companion Token` có thời hạn ngắn.
3. **Thực thi gọi API:** Mọi request tiếp theo từ Web App xuống Local Companion đều phải mang header `Authorization: Bearer <ScopedToken>`.
