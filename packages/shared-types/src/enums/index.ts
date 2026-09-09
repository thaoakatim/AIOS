export enum MessageRole {
    USER = 'user',
    ASSISTANT = 'assistant',
    TOOL = 'tool',
    SYSTEM = 'system',
}

export enum AgentRunStatus {
    RUNNING = 'running',
    TOOL_CALLING = 'tool_calling',
    COMPLETED = 'completed',
    FAILED = 'failed',
}

export enum TaskStatus {
    TODO = 'todo',
    IN_PROGRESS = 'in_progress',
    DONE = 'done',
    BLOCKED = 'blocked',
}

export enum DocumentStatus {
    PENDING = 'pending',
    PROCESSING = 'processing',
    INDEXED = 'indexed',
    FAILED = 'failed',
}