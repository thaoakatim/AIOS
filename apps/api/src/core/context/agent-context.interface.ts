import { DocumentChunk, Message } from '@prisma/client';

export interface AgentExecutionContext {
    readonly executionId: string; // Id for trace
    readonly sessionId: string;
    readonly query: string; // Question from user
    readonly context: {
        readonly userProfile: Record<string, unknown>; // Long memory
        readonly systemRules: string[];
        readonly activePlans: Record<string, unknown>;
    };
    readonly prefetch?: {
    readonly ragChunks?: DocumentChunk[]; // Dữ liệu RAG nạp trước
    readonly recentMessages?: Message[]; // Lịch sử chat gần nhất
  };
  readonly availableTools: ToolDefinition[]; // Danh sách công cụ được phép dùng
  readonly metadata: Record<string, unknown>; // Thông tin mở rộng
}