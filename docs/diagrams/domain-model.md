# Domain Model — AIOS

> Mô tả các thực thể cốt lõi (Entities) và quan hệ giữa chúng trong hệ thống AIOS.

---

## Domain Model Diagram

```mermaid
classDiagram
    direction TB

    class Conversation {
        +String id
        +String title
        +DateTime createdAt
        +DateTime updatedAt
        +addMessage()
        +getHistory()
    }

    class Message {
        +String id
        +String role [user | assistant | tool]
        +String content
        +DateTime createdAt
        +isStreaming()
    }

    class Document {
        +String id
        +String name
        +String type [pdf | md | docx]
        +String storagePath
        +DateTime uploadedAt
        +getChunks()
    }

    class DocumentChunk {
        +String id
        +String content
        +Float[] embedding
        +Integer chunkIndex
        +similaritySearch()
    }

    class Memory {
        +String id
        +String key
        +String value
        +String category
        +DateTime createdAt
        +DateTime updatedAt
        +update()
        +delete()
    }

    class Plan {
        +String id
        +String title
        +String description
        +PlanStatus status [pending | in_progress | done]
        +DateTime dueDate
        +DateTime createdAt
        +addTask()
        +complete()
    }

    class Task {
        +String id
        +String title
        +TaskStatus status [todo | doing | done]
        +Integer order
        +complete()
    }

    class Tool {
        +String name
        +String description
        +String[] parameters
        +execute()
        +validate()
    }

    class ToolCall {
        +String id
        +String toolName
        +JSON input
        +JSON output
        +ToolCallStatus status
        +DateTime calledAt
    }

    class Workflow {
        +String id
        +String name
        +WorkflowStatus status [pending | running | paused | done | failed]
        +DateTime startedAt
        +execute()
        +pause()
        +cancel()
    }

    class WorkflowStep {
        +String id
        +String name
        +Integer order
        +StepStatus status
        +JSON output
        +execute()
    }

    class Agent {
        +String id
        +String name
        +String role
        +String systemPrompt
        +String[] toolNames
        +execute()
        +reflect()
    }

    class LLMRequest {
        +String model
        +Message[] messages
        +String[] tools
        +Float temperature
        +Integer maxTokens
        +send()
    }

    class LLMResponse {
        +String content
        +Integer promptTokens
        +Integer completionTokens
        +String finishReason
        +isToolCall()
    }

    %% Relationships
    Conversation "1" --> "many" Message : contains
    Message "1" --> "0..1" ToolCall : triggers

    Document "1" --> "many" DocumentChunk : split into

    Plan "1" --> "many" Task : contains

    Workflow "1" --> "many" WorkflowStep : composed of

    Agent "1" --> "many" Tool : can use
    Agent "1" --> "many" WorkflowStep : executes

    LLMRequest --> LLMResponse : produces
    Message --> LLMRequest : builds

    ToolCall --> Tool : references
    WorkflowStep --> ToolCall : may produce

    Memory ..> Conversation : enriches context
    DocumentChunk ..> LLMRequest : injected via RAG
```

---

## Mô tả Entity

### Core Entities

| Entity | Vai trò |
|---|---|
| `Conversation` | Một phiên hội thoại, bao gồm nhiều `Message` |
| `Message` | Một tin nhắn trong cuộc hội thoại (user / assistant / tool) |
| `Document` | Tài liệu người dùng upload (PDF, MD, DOCX) |
| `DocumentChunk` | Đoạn nhỏ của `Document` được embed thành vector |
| `Memory` | Thông tin dài hạn được lưu lại về người dùng / dự án |
| `Plan` | Kế hoạch công việc gồm nhiều `Task` |
| `Task` | Đơn vị công việc nhỏ trong một `Plan` |
| `Tool` | Công cụ AI có thể gọi (Search, Weather, Calculator...) |
| `ToolCall` | Log của một lần AI gọi `Tool` |
| `Workflow` | Quy trình nhiều bước liên tiếp |
| `WorkflowStep` | Một bước trong `Workflow` |
| `Agent` | Agent chuyên biệt, có system prompt và bộ tool riêng |
| `LLMRequest` | Request gửi lên LLM |
| `LLMResponse` | Response nhận về từ LLM |

---

## Value Objects

| Value Object | Thuộc về | Mô tả |
|---|---|---|
| `embedding: Float[]` | `DocumentChunk` | Vector biểu diễn ngữ nghĩa |
| `role: enum` | `Message` | `user`, `assistant`, `tool` |
| `status: enum` | `Plan`, `Task`, `Workflow`, `WorkflowStep` | Trạng thái tiến độ |

---

## Data Storage Mapping

| Entity | Storage |
|---|---|
| Conversation, Message | PostgreSQL |
| Document (metadata) | PostgreSQL |
| Document (file) | Local Filesystem |
| DocumentChunk + Embedding | Vector Database (Qdrant / pgvector) |
| Memory | PostgreSQL |
| Plan, Task | PostgreSQL |
| ToolCall (log) | PostgreSQL |
| Workflow, WorkflowStep | PostgreSQL |
| Agent definition | PostgreSQL / Config file |
| LLMRequest / Response | Runtime only (log to Observability) |
