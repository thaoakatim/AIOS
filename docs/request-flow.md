# AIOS Request Flow Specification

> **Tài liệu đặc tả chi tiết các luồng xử lý yêu cầu (Request Flow) trong hệ thống AIOS**  
> *Mô tả tường tận từ thời điểm Client gửi Request qua API Layer, đi qua các Middleware, Lifecycle Hooks, Service Orchestrator, Core Gateway đến Hạ tầng (DB, Vector Store, LLM Provider) và Streaming kết quả ngược lại.*

---

## 1. Tổng quan Các Loại Request trong AIOS

Hệ thống AIOS tiếp nhận và xử lý 5 luồng request chính:

1. **Flow 1: Conversational Chat Flow (Chat + Memory + RAG + Streaming):** Luồng trò chuyện tương tác trực tiếp với phản hồi streaming dạng token-by-token.
2. **Flow 2: Autonomous Agent Flow (ReAct Loop + Tool/MCP + Policy Guard):** Luồng thực thi nhiệm vụ phức tạp tự trị (Reason $\rightarrow$ Act $\rightarrow$ Reflect).
3. **Flow 3: Knowledge Ingestion & Indexing Flow:** Luồng upload tài liệu và xử lý trích xuất văn bản, chunking, sinh vector nhúng chạy ngầm qua Queue.
4. **Flow 4: Workflow Execution Flow (Multi-step DAG Pipeline):** Luồng điều phối các quy trình tự động hóa nhiều bước có lưu vết trạng thái để Pause/Resume.
5. **Flow 5: Background Memory Extraction Flow:** Luồng ngầm tự động phân tích hội thoại để trích xuất thói quen, sở thích của người dùng và lưu vào bộ nhớ dài hạn.

---

## 2. Flow 1: Conversational Chat Flow (Chat + RAG + Memory)

Đây là luồng phổ biến nhất khi người dùng đặt câu hỏi trực tiếp trên giao diện web và mong muốn câu trả lời phản hồi tức thì dưới dạng streaming.

### 2.1. Biểu đồ Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 User (Web Client)
    participant API as 🌐 ChatController
    participant Svc as 💬 ChatService
    participant CtxB as 📦 ContextBuilder
    participant Hook as 🪝 Lifecycle Hooks
    participant Mem as 🧠 MemoryModule
    participant Know as 📚 KnowledgeModule (RAG)
    participant LLM as 🔮 LLMGateway (ACL)
    participant Provider as ☁️ LLM Provider (OpenAI/Gemini)
    participant DB as 🗄️ PostgreSQL (Prisma)
    participant OBS as 📊 Observability

    User->>API: POST /chat/stream { conversationId, message }
    API->>Svc: handleStreamMessage(dto)
    
    %% Tạo Context
    Svc->>CtxB: buildContext(dto)
    CtxB->>CtxB: Tạo AgentExecutionContext (sessionId, query, timestamp)
    CtxB-->>Svc: ctx (Immutable Context Object)

    %% Giai đoạn Hook onBeforePromptBuild
    Svc->>Hook: onBeforePromptBuild(ctx)
    par Lấy Memory & RAG đồng thời
        Hook->>Mem: getRelevantMemory(ctx.query)
        Mem-->>Hook: [User Preferences, Profile]
    and
        Hook->>Know: searchRelevantChunks(ctx.query, topK=4)
        Know-->>Hook: [DocumentChunk 1, 2, 3]
    end
    Hook->>Hook: Ghi nạp Memory & RAG vào ctx.prefetch
    Hook-->>Svc: ctx đã được làm giàu (Enriched Context)

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
        Svc->>DB: Lưu User Message & Assistant Message vào DB
    and
        Svc->>Hook: onAfterCompletion(response, ctx)
        Hook--)OBS: Ghi log Trace (Latency, Prompt Tokens, Completion Tokens)
    end
    
    API-->>User: SSE Event: { type: 'done', messageId: '...' }
```

### 2.2. Chi tiết Biến đổi Dữ liệu (Data Transformation)
1. **Request DTO (Input):**
   ```json
   {
     "conversationId": "conv_12345",
     "content": "Dự án AIOS dùng kiến trúc gì?",
     "model": "gpt-4o"
   }
   ```
2. **Context Object sau khi Enrich (`AgentExecutionContext`):**
   * `ctx.query`: `"Dự án AIOS dùng kiến trúc gì?"`
   * `ctx.context.userProfile`: `{ role: "Software Engineer", techStack: ["TypeScript", "NestJS"] }`
   * `ctx.prefetch.ragChunks`: `["docs/architecture.md: AIOS thiết kế theo Modular Monolith..."]`
3. **Payload gửi lên LLM Provider:**
   * Ghép `System Prompt` định hình vai trò Personal Chief of Staff.
   * Chèn khối context RAG: `<context>...</context>`.
   * Lịch sử 5 tin nhắn gần nhất.
   * Câu hỏi hiện tại của người dùng.
4. **SSE Event Stream (Output):**
   ```text
   event: token
   data: {"content": "Dự án "}

   event: token
   data: {"content": "AIOS được thiết kế..."}

   event: done
   data: {"messageId": "msg_987", "tokens": 420}
   ```

---

## 3. Flow 2: Autonomous Agent Flow (ReAct Loop + Tool/MCP Execution)

Luồng kích hoạt khi người dùng giao một nhiệm vụ đòi hỏi hành động và tương tác với hệ thống bên ngoài (Ví dụ: *"Kiểm tra GitHub issues của repo AIOS và lên kế hoạch làm việc hôm nay"*).

### 3.1. Biểu đồ Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 User
    participant API as 🌐 AgentsController
    participant Svc as 🤖 AgentsService
    participant Hook as 🪝 Lifecycle Hooks (Policy Guard)
    participant LLM as 🔮 LLMGateway
    participant Registry as 🔧 ToolRegistry
    participant MCP as 🔌 Tool / MCP Server (GitHub/Filesystem)
    participant OBS as 📊 Observability

    User->>API: POST /agents/run { task: "Check GitHub issues & update plan" }
    API->>Svc: runAgent(dto)
    Svc->>Svc: Khởi tạo AgentExecutionContext & Session

    loop Vòng lặp ReAct (Tối đa N iterations)
        Note over Svc,LLM: 1. REASON (Suy luận)
        Svc->>Registry: getAvailableToolSchemas()
        Registry-->>Svc: [github_list_issues, planner_add_task]
        Svc->>LLM: generateStep(task, history, toolSchemas)
        LLM-->>Svc: Trả về Thought + ToolCall { name: 'github_list_issues', args: { repo: 'AIOS' } }

        alt LLM quyết định gọi Tool (Action)
            Note over Svc,MCP: 2. ACT (Thực thi có kiểm duyệt an toàn)
            Svc->>Hook: onBeforeToolExecution(toolName, args, ctx)
            Note over Hook: Kiểm tra quyền & chính sách an toàn (Policy Guard)
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

### 3.2. Cơ chế Policy Guard (Học hỏi từ Caremate)
Trước khi bất kỳ Tool nào được chạy qua `onBeforeToolExecution`:
* **Read-only tools (Search, Read File, Get Calendar):** Tự động duyệt chạy ngay.
* **Mutating tools (Write File, Delete File, Send Mail, Commit Code):** 
  * Nếu mức độ nguy hiểm cao: Hook tạm dừng Agent (`PAUSED_WAITING_CONFIRMATION`), bắn thông báo về Web UI yêu cầu người dùng bấm `Approve / Reject`.
  * Khi người dùng Approve: Tiếp tục thực thi tool.

---

## 4. Flow 3: Knowledge Ingestion & Indexing Flow (Document RAG)

Xử lý khi người dùng tải lên tài liệu (PDF, Markdown, DOCX) để đưa vào tri thức cá nhân của AIOS. Tác vụ được chuyển sang xử lý bất đồng bộ (Asynchronous Worker) bằng BullMQ để không làm nghẽn server.

### 4.1. Biểu đồ Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 User
    participant API as 🌐 KnowledgeController
    participant Svc as 📚 KnowledgeService
    participant FS as 📁 Local File Storage
    participant Q as ⚡ BullMQ (Redis Queue)
    participant Worker as ⚙️ IngestionWorker
    participant LLM as 🔮 LLMGateway (Embedding)
    participant VecDB as 🧮 Vector Store (pgvector / Qdrant)
    participant DB as 🗄️ PostgreSQL

    User->>API: POST /knowledge/upload (Multipart Form Data: file.pdf)
    API->>Svc: uploadDocument(file)
    
    %% Lưu file và ghi nhận DB
    Svc->>FS: Lưu file nhị phân vào /data/storage/documents/file.pdf
    Svc->>DB: Tạo Document record (status = 'PENDING')
    DB-->>Svc: documentId
    
    %% Đẩy việc vào Queue
    Svc->>Q: Đẩy Job { documentId, filePath } vào queue 'document-ingestion'
    Svc-->>API: Trả về { documentId, status: 'PROCESSING' }
    API-->>User: Phản hồi upload thành công, đang xử lý ngầm

    %% Worker ngầm bắt đầu xử lý
    Note over Q,Worker: Xử lý Bất đồng bộ trong Background
    Q->>Worker: Nhận Job(documentId)
    Worker->>FS: Đọc file từ ổ đĩa
    Worker->>Worker: Parse PDF sang Plain Text
    Worker->>Worker: ChunkingService: Cắt văn bản thành các chunks (500 tokens, 10% overlap)
    
    loop Từng batch DocumentChunks (VD: 10 chunks/lần)
        Worker->>LLM: getEmbeddings(chunksText[])
        LLM-->>Worker: Mảng vectors 768/1536 chiều
        Worker->>VecDB: Lưu Vector + Text Content + Metadata vào Vector Store
    end

    Worker->>DB: Cập nhật Document (status = 'INDEXED', totalChunks = X)
    Worker--)User: Bắn thông báo realtime qua WebSocket: "Tài liệu đã sẵn sàng để hỏi đáp"
```

---

## 5. Flow 4: Workflow Execution Flow (Multi-step DAG)

Dành cho các quy trình nhiều bước, chạy tuần tự hoặc phân nhánh (Ví dụ: *"Thu thập thông tin $\rightarrow$ Tóm tắt $\rightarrow$ Sinh Todo Task $\rightarrow$ Gửi email báo cáo"*).

### 5.1. Cơ chế State Persistence
Mỗi bước trong Workflow được điều phối bởi `WorkflowEngine`:
1. **Trước khi chạy Step:** Ghi trạng thái `StepStatus = RUNNING` vào PostgreSQL.
2. **Nếu Step là Tool:** Ủy thác trực tiếp cho `ToolModule`.
3. **Nếu Step là Sub-Agent:** Khởi tạo `AgentSession` riêng, chạy ReAct loop và chờ kết quả.
4. **Sau khi chạy Step:** Lưu kết quả `StepResult (JSON)` vào PostgreSQL và cập nhật trạng thái `StepStatus = COMPLETED`.
5. **Cơ chế Khôi phục (Resume):** Nếu server bị restart hoặc gặp sự cố giữa chừng, `WorkflowEngine` kiểm tra database, tìm step cuối cùng còn dang dở hoặc chưa chạy để tiếp tục (`Resume`) mà không phải chạy lại từ đầu.

---

## 6. Xử lý Lỗi và Chiến lược Dự phòng (Error Handling & Fallbacks)

Để đảm bảo hệ thống vận hành bền bỉ (Fault-Tolerant), AIOS áp dụng các cơ chế dự phòng ở từng tầng:

| Tình huống lỗi | Vị trí phát sinh | Cơ chế xử lý dự phòng (Fallback Strategy) |
|---|---|---|
| **LLM Provider Timeout / Rate Limit** | `core/llm` | Tự động thử lại (Retry with Exponential Backoff) tối đa 3 lần. Nếu vẫn thất bại, tự động chuyển vùng (Fallback) sang Provider phụ (VD: OpenAI $\rightarrow$ Gemini $\rightarrow$ Local Ollama). |
| **Tool Execution Thất bại** | `modules/tools` | Bắt ngoại lệ và đóng gói mã lỗi vào `ToolResult.error`. Gửi thông báo lỗi ngược lại cho LLM để AI nhận biết và tự suy luận cách khắc phục (Self-Correction). |
| **Vector DB không phản hồi** | `modules/knowledge` | Bỏ qua phần RAG context, ghi log cảnh báo và tiếp tục cho phép hội thoại thông thường với dữ liệu từ Memory và Chat History. |
| **Token Tràn Context Window** | `core/llm` | `TokenCounter` phát hiện vượt ngưỡng $\rightarrow$ Kích hoạt cơ chế cắt tỉa: Rút ngắn lịch sử chat cũ, tóm tắt ngữ cảnh (Summarization), chỉ giữ lại các RAG chunks có độ tương đồng cao nhất. |

---

## 7. Tổng kết

Nhờ việc chuẩn hóa các **Request Flow** kết hợp **Context Object** và **Lifecycle Hooks**:
* Luồng dữ liệu trong AIOS có tính **nhất quán tuyệt đối (Consistent Data Flow)**.
* Tất cả request đều để lại dấu vết đầy đủ (Full Observability Trace).
* Các module giữ được tính độc lập cao, dễ dàng bảo trì, viết unit/integration tests và sẵn sàng mở rộng.

