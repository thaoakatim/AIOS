import { DocumentChunk, Message } from '@prisma/client';
import { ToolDefinition } from '../tools/tool.interface';

/**
 * AgentExecutionContext — Đối tượng ngữ cảnh thực thi bất biến (Immutable)
 * mang toàn bộ thông tin cho chu trình suy luận của Agent.
 *
 * Chứa `userId` ngay tại gốc để đảm bảo tính cô lập dữ liệu (Multi-tenant Ownership).
 */
export interface AgentExecutionContext {
  readonly executionId: string; // Unique trace ID cho một phiên chạy
  readonly userId: string; // ID người dùng sở hữu phiên chạy (Data Ownership)
  readonly sessionId: string; // ID phiên hội thoại hoặc agent session
  readonly query: string; // Yêu cầu gốc của người dùng
  readonly context: {
    readonly userProfile: Record<string, unknown>; // Memory dài hạn
    readonly systemRules: string[]; // Quy tắc hệ thống
    readonly activePlans?: Record<string, unknown>; // Các plan hiện tại
  };
  readonly prefetch?: {
    readonly ragChunks?: DocumentChunk[]; // Dữ liệu RAG nạp trước
    readonly recentMessages?: Message[]; // Lịch sử chat gần nhất
  };
  readonly availableTools: ToolDefinition[]; // Danh sách công cụ được phép dùng
  readonly metadata: Record<string, unknown>; // Thông tin mở rộng
}
