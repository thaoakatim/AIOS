# Domain Model — AIOS

> Mô tả các thực thể cốt lõi (Entities), Value Objects và quan hệ giữa chúng trong hệ thống AIOS theo hướng **Domain-Driven Design (DDD)** và chuẩn hóa **Multi-user Ownership & E2EE Sync**.

---

## Domain Model Diagram

```mermaid
classDiagram
    direction TB

    class User {
        +String id
        +String keycloakSubject
        +String email
        +String displayName
        +Boolean emailVerified
        +DateTime createdAt
    }

    class Conversation {
        +String id
        +String userId
        +String title
        +Integer version
        +String contentHash
        +DateTime deletedAt
        +DateTime createdAt
        +addMessage()
        +getHistory()
    }

    class Message {
        +String id
        +String conversationId
        +String agentSessionId
        +String role [user | assistant | tool | system]
        +String content
        +Integer version
        +String contentHash
        +DateTime deletedAt
        +DateTime createdAt
        +isStreaming()
    }

    class Document {
        +String id
        +String userId
        +String title
        +String fileType [pdf | md | docx]
        +String sourceUrl
        +String embeddingModel
        +Integer version
        +String contentHash
        +DateTime deletedAt
        +DateTime createdAt
        +getChunks()
    }

    class DocumentChunk {
        +String id
        +String documentId
        +String content
        +Float[] embedding
        +String embeddingModel
        +JSON metadata
        +Integer version
        +DateTime deletedAt
        +similaritySearch()
    }

    class Memory {
        +String id
        +String userId
        +String sourceAgentSessionId
        +String key
        +String value
        +String category [profile | preference | fact]
        +String scope [global | conversation]
        +Integer version
        +String contentHash
        +DateTime deletedAt
        +DateTime updatedAt
        +update()
        +softDelete()
    }

    class Plan {
        +String id
        +String userId
        +String workflowId
        +String title
        +PlanStatus status [active | completed]
        +Integer version
        +String contentHash
        +DateTime deletedAt
        +DateTime createdAt
        +addTask()
        +complete()
    }

    class Task {
        +String id
        +String planId
        +String parentTaskId
        +String title
        +TaskStatus status [todo | in_progress | done]
        +DateTime dueDate
        +Integer version
        +DateTime deletedAt
        +complete()
    }

    class Tool {
        +String name
        +String description
        +JSON parametersSchema
        +execute()
        +validate()
    }

    class ToolExecution {
        +String id
        +String agentRunId
        +String toolName
        +JSON inputParams
        +JSON result
        +Integer latencyMs
        +String status
        +DateTime createdAt
    }

    class Workflow {
        +String id
        +String userId
        +String messageId
        +String name
        +WorkflowStatus status [running | paused | completed | failed]
        +Integer version
        +String contentHash
        +DateTime deletedAt
        +DateTime createdAt
        +execute()
        +pause()
        +resume()
    }

    class WorkflowStep {
        +String id
        +String workflowId
        +String stepName
        +Integer stepOrder
        +StepStatus status [pending | running | done | skipped]
        +JSON stepOutput
        +execute()
    }

    class AgentConfig {
        +String id
        +String name
        +String modelName
        +String systemPrompt
    }

    class AgentSession {
        +String id
        +String conversationId
        +String agentConfigId
        +String status [active | closed]
    }

    class AgentRun {
        +String id
        +String messageId
        +String status
        +Integer totalTokens
        +JSON traceLogs
    }

    class AgentExecutionContext {
        +String executionId
        +String userId
        +String sessionId
        +String query
        +Map context
        +Map prefetch
        +Tool[] availableTools
        +Map metadata
    }

    class EncryptedSyncItem {
        +String id
        +String userId
        +String entityType
        +Integer version
        +Boolean isDeleted
        +String ciphertext
        +String iv
        +String authTag
        +DateTime updatedAt
    }

    %% Relationships
    User "1" --> "many" Conversation : owns
    User "1" --> "many" Document : owns
    User "1" --> "many" Memory : owns
    User "1" --> "many" Workflow : owns
    User "1" --> "many" Plan : owns
    User "1" --> "many" EncryptedSyncItem : syncs

    Conversation "1" --> "many" Message : contains
    Conversation "1" --> "many" AgentSession : contains
    AgentConfig "1" --> "many" AgentSession : defines

    Document "1" --> "many" DocumentChunk : split into

    Message "1" --> "0..1" AgentRun : triggers
    AgentRun "1" --> "many" ToolExecution : executes

    Message "1" --> "0..1" Workflow : initiates
    Workflow "1" --> "many" WorkflowStep : composed of
    Workflow "1" --> "0..1" Plan : generates
    Plan "1" --> "many" Task : decomposes
    Task "1" --> "many" Task : sub-tasks

    AgentExecutionContext ..> Message : created from
    AgentExecutionContext ..> Memory : injects relevant
    AgentExecutionContext ..> DocumentChunk : injects RAG
```

---

## Mô tả Entity

### Core Domain Entities

| Entity | Trách nhiệm trong Domain |
|---|---|
| `User` | Đại diện cho chủ sở hữu tài khoản, được ánh xạ từ `sub` của Keycloak OIDC. |
| `Conversation` | Tập hợp các lượt trao đổi tin nhắn, thuộc sở hữu của một `User`. |
| `Message` | Đơn vị tương tác trung tâm trong hệ thống, kích hoạt ReAct Agent hoặc Workflow. |
| `Document` | Tài liệu người dùng tải lên, có gắn `embeddingModel` phục vụ Smart Vector Sync. |
| `DocumentChunk` | Đoạn văn bản băm nhỏ kèm vector nhúng `vector(768)` lưu trong `pgvector`. |
| `Memory` | Ký ức dài hạn của người dùng, phân biệt theo `(userId, key)` và danh mục. |
| `Plan` / `Task` | Kế hoạch công việc có cấu trúc cây (sub-tasks), tự động quản lý bởi Planner. |
| `Workflow` / `Step` | Quy trình tự động hóa nhiều bước (DAG), quản lý qua State Machine. |
| `AgentConfig` / `Session` / `Run` | Ba tầng quản lý Agent: Ai (Config) → Khi nào (Session) → Làm gì (Run). |
| `ToolExecution` | Bản ghi vết thực thi công cụ bên ngoài, lưu kết quả và độ trễ. |

---

## Value Objects & DTOs

| Value Object | Mô tả |
|---|---|
| `AgentExecutionContext` | Đối tượng bất biến (`readonly`) mang `userId`, context dài hạn và RAG prefetch đi xuyên suốt chu trình xử lý của Agent. |
| `EncryptedSyncItem` | Gói dữ liệu đồng bộ mã hóa đầu-cuối (Sync Envelope chứa ciphertext AES-256-GCM, IV, authTag, tombstone). |
| `embedding: Float[]` | Vector biểu diễn ngữ nghĩa 768 chiều (tương thích `pgvector`). |
| `SmartVectorPayload` | Mảng nhị phân `Float32Array` được nén và mã hóa để đồng bộ vector giữa các máy mà không mất phí embed lại. |

---

## Data Storage Mapping

| Entity | Môi trường Desktop Production | Môi trường Dev / Docker |
|---|---|---|
| **User (Projection)** | PGlite (WASM) Local | PostgreSQL 16 |
| **Conversation, Message** | PGlite (WASM) Local | PostgreSQL 16 |
| **Document, Chunk text** | PGlite (WASM) Local | PostgreSQL 16 |
| **Document file gốc** | Thư mục `userData` (OS App Data) | Local Filesystem (`./data/storage`) |
| **Vector Embeddings** | `pgvector` tích hợp trong PGlite | PostgreSQL `pgvector` hoặc Qdrant |
| **Memory, Plan, Task, Workflow** | PGlite (WASM) Local | PostgreSQL 16 |
| **Hàng đợi tác vụ nền (Queue)** | `PgLiteQueueAdapter` (bảng SQL) | BullMQ (Redis) |
| **Identity Authority** | Keycloak Remote | Keycloak Remote / Dev Bypass |
| **Encrypted Sync Data** | Không lưu (chỉ nạp/giải mã) | Remote Sync API / Object Storage |
