# Component Diagram — AIOS

> Mô tả cách các module giao tiếp với nhau trong hệ thống AIOS, bao gồm luồng dữ liệu, interface, và tích hợp với hạ tầng.

---

## High-Level Component Diagram

```mermaid
graph TD
    User(["👤 User"])

    subgraph APILayer ["API Layer"]
        HTTP["REST API\n(NestJS HTTP)"]
        WS["WebSocket\n(Streaming)"]
    end

    subgraph CoreModules ["Core Business Modules"]
        CONV["💬 Conversation\nModule"]
        KNOW["📚 Knowledge\nModule (RAG)"]
        MEM["🧠 Memory\nModule"]
        PLAN["📅 Planner\nModule"]
        TOOL["🔧 Tool\nModule"]
        WORK["⚙️ Workflow\nModule"]
        AGENT["🤖 Agent\nModule"]
    end

    subgraph CoreServices ["Core Services"]
        LLM["🔮 LLM Gateway"]
        OBS["📊 Observability"]
    end

    subgraph Infrastructure ["Infrastructure Layer"]
        DB[("🗄️ PostgreSQL")]
        VEC[("🧮 Vector Store\n(Qdrant/pgvector)")]
        FS[("📁 File Storage\n(Local)")]
        CACHE[("⚡ Redis\n(Cache)")]
    end

    subgraph External ["External Services"]
        LLMAPI["OpenAI / Anthropic\n/ Gemini API"]
        SEARCH["Search API\n(Tavily/Google)"]
        WEATHER["Weather API"]
        GITHUB["GitHub API"]
        EMAIL["Email API"]
    end

    %% User → API
    User -- "HTTP Request" --> HTTP
    User -- "WebSocket" --> WS

    %% API → Conversation
    HTTP --> CONV
    WS --> CONV

    %% Conversation → downstream
    CONV -- "context + messages" --> LLM
    CONV -- "RAG query" --> KNOW
    CONV -- "read profile" --> MEM
    CONV -- "delegate task" --> AGENT

    %% Knowledge → infra
    KNOW -- "store doc" --> FS
    KNOW -- "store/search vectors" --> VEC
    KNOW -- "embed text" --> LLM

    %% Memory → infra
    MEM -- "persist" --> DB

    %% Planner → infra
    PLAN -- "persist" --> DB

    %% Tool → external
    TOOL -- "web search" --> SEARCH
    TOOL -- "weather query" --> WEATHER
    TOOL -- "code/file ops" --> FS
    TOOL -- "repo access" --> GITHUB
    TOOL -- "send/read mail" --> EMAIL

    %% Workflow → siblings
    WORK -- "execute tool" --> TOOL
    WORK -- "delegate step" --> AGENT
    WORK -- "persist state" --> DB

    %% Agent → siblings
    AGENT -- "call model" --> LLM
    AGENT -- "use tool" --> TOOL
    AGENT -- "run sub-workflow" --> WORK

    %% LLM → external
    LLM -- "API call" --> LLMAPI

    %% Observability
    CONV -. "trace" .-> OBS
    LLM -. "token usage / latency" .-> OBS
    TOOL -. "tool call log" .-> OBS
    AGENT -. "agent session log" .-> OBS
    WORK -. "workflow run log" .-> OBS

    %% Cache
    CONV -- "session cache" --> CACHE
```

---

## Sequence Diagram — Chat với RAG

```mermaid
sequenceDiagram
    actor User
    participant API as REST/WS API
    participant Conv as Conversation Module
    participant Mem as Memory Module
    participant Know as Knowledge Module
    participant LLM as LLM Gateway
    participant OBS as Observability

    User->>API: POST /chat { message }
    API->>Conv: handleMessage(message)

    Conv->>Mem: getRelevantMemory(message)
    Mem-->>Conv: [memory items]

    Conv->>Know: semanticSearch(message)
    Know-->>Conv: [top-k document chunks]

    Conv->>LLM: complete(messages + memory + chunks)
    LLM-->>Conv: stream(token...)
    Conv-->>API: stream response
    API-->>User: Server-Sent Events

    Conv--)OBS: trace(prompt, latency, tokens)
```

---

## Sequence Diagram — Agent thực hiện Task

```mermaid
sequenceDiagram
    actor User
    participant API
    participant Agent as Agent Module
    participant LLM as LLM Gateway
    participant Tool as Tool Module
    participant OBS as Observability

    User->>API: POST /agent/run { task }
    API->>Agent: execute(task)

    loop ReAct Loop (max N iterations)
        Agent->>LLM: reason(task, history, tools)
        LLM-->>Agent: thought + action (tool call)

        Agent->>Tool: execute(toolName, input)
        Tool-->>Agent: toolResult

        Agent->>LLM: reflect(result)
        LLM-->>Agent: is_done? next_action?
    end

    Agent-->>API: finalResult
    API-->>User: response
    Agent--)OBS: log(session, steps, tokens)
```

---

## Sequence Diagram — Workflow Execution

```mermaid
sequenceDiagram
    actor User
    participant API
    participant WFEngine as Workflow Engine
    participant Agent as Agent Module
    participant Tool as Tool Module
    participant DB as PostgreSQL

    User->>API: POST /workflow/run { workflowId }
    API->>WFEngine: execute(workflow)
    WFEngine->>DB: saveState(RUNNING)

    loop For each Step
        alt Step is ToolCall
            WFEngine->>Tool: execute(step)
            Tool-->>WFEngine: result
        else Step is AgentTask
            WFEngine->>Agent: execute(step)
            Agent-->>WFEngine: result
        end
        WFEngine->>DB: saveStepResult(result)
    end

    WFEngine->>DB: saveState(DONE)
    WFEngine-->>API: workflowResult
    API-->>User: response
```

---

## Interface Contract giữa các Module

### Conversation → LLM Gateway

```typescript
interface LLMRequest {
  model: string;
  messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string }>;
  tools?: ToolSchema[];
  stream: boolean;
  temperature?: number;
}

interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage: { promptTokens: number; completionTokens: number };
  finishReason: 'stop' | 'tool_calls' | 'length';
}
```

### Agent → Tool Module

```typescript
interface ToolExecutionRequest {
  toolName: string;
  input: Record<string, unknown>;
  callerAgentId?: string;
}

interface ToolExecutionResult {
  success: boolean;
  output: unknown;
  error?: string;
  latencyMs: number;
}
```

### Workflow → WorkflowStep

```typescript
interface WorkflowStep {
  id: string;
  name: string;
  type: 'tool' | 'agent' | 'condition' | 'parallel';
  config: Record<string, unknown>;
  dependsOn?: string[];  // step IDs
}

interface StepResult {
  stepId: string;
  status: 'success' | 'failed' | 'skipped';
  output: unknown;
  duration: number;
}
```

---

## Deployment View

```mermaid
graph LR
    subgraph SingleServer ["Single Server (Phase 1)"]
        NestJS["NestJS App\n(All Modules)"]
        PG[("PostgreSQL")]
        RD[("Redis")]
        QD[("Qdrant\nor pgvector")]
        FILES["Local File\nStorage"]
    end

    subgraph ExternalCloud ["External (Cloud APIs)"]
        OAIAPI["OpenAI API"]
        TAVILY["Tavily Search"]
        WX["Weather API"]
    end

    NestJS --- PG
    NestJS --- RD
    NestJS --- QD
    NestJS --- FILES
    NestJS --> OAIAPI
    NestJS --> TAVILY
    NestJS --> WX
```

> **Phase 1:** Monolith trên một server duy nhất.
> **Phase 2+:** Có thể tách `Knowledge`, `Workflow`, `Agent` thành microservice khi cần scale.
