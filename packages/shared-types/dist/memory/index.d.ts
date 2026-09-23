/**
 * Memory Module — Shared contracts dùng chung cho API & Web.
 * Tương ứng bảng Prisma `MemoryRecord` (apps/api/prisma/schema.prisma).
 *
 * - scope: phạm vi ký ức ("global" xuyên hội thoại | "conversation" gắn với phiên cụ thể)
 * - category: nhóm ký ức ("profile" | "preference" | "fact")
 * - key: khóa duy nhất toàn cục (unique), value: nội dung ký ức
 * - sourceAgentSessionId: truy vết nguồn gốc (nullable — null khi user tạo tay qua Dashboard)
 */
import { MemoryCategory, MemoryScope } from '../enums';
export { MemoryCategory, MemoryScope };
export interface IMemoryRecord {
    id: string;
    sourceAgentSessionId: string | null;
    scope: string;
    category: string;
    key: string;
    value: string;
    updatedAt: Date;
}
export interface CreateMemoryPayload {
    key: string;
    value: string;
    category: string;
    scope?: string;
    /** Nullable — null/undefined khi user tạo tay qua Dashboard. */
    sourceAgentSessionId?: string | null;
}
export interface UpdateMemoryPayload {
    value?: string;
    category?: string;
    scope?: string;
    sourceAgentSessionId?: string | null;
}
export interface MemoryFilter {
    scope?: string;
    category?: string;
    search?: string;
    sourceAgentSessionId?: string;
    limit?: number;
    offset?: number;
}
export interface RelevantMemoryOptions {
    /** Giới hạn số records trả về (mặc định 20). */
    limit?: number;
    /** Lọc theo scope. Mặc định lấy cả global + conversation. */
    scope?: string;
    /** Lọc theo category. */
    category?: string;
    /**
     * Session hiện tại — dùng để ưu tiên ký ức thuộc về session này
     * (scope=conversation có sourceAgentSessionId trùng) rồi mới tới global.
     */
    sessionId?: string;
}
/**
 * Dạng userProfile nạp vào `AgentExecutionContext.context.userProfile`.
 * Map từ key -> value của các MemoryRecord liên quan.
 */
export type MemoryUserProfile = Record<string, unknown>;
//# sourceMappingURL=index.d.ts.map