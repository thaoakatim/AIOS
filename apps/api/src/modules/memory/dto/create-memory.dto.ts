/**
 * DTO tạo ký ức dài hạn mới (tương ứng bảng Prisma `MemoryRecord`).
 * Không dùng class-validator (chưa có trong dependencies) — validation
 * thực hiện ở tầng MemoryService để giữ DTO thuần khiết (Pure Contract).
 */
export class CreateMemoryDto {
  /** Khóa duy nhất toàn cục, ví dụ: "user.name", "preference.language". */
  key!: string;

  /** Nội dung ký ức, ví dụ: "Tên tôi là Huy", "Thích dark mode". */
  value!: string;

  /** Nhóm ký ức: "profile" | "preference" | "fact". */
  category!: string;

  /**
   * Phạm vi: "global" (mặc định, xuyên hội thoại) | "conversation"
   * (gắn với phiên cụ thể qua sourceAgentSessionId).
   */
  scope?: string;

  /**
   * Truy vết nguồn gốc — ID của AgentSession đã sinh ra ký ức này.
   * Nullable: null/undefined khi user tạo tay qua Dashboard.
   */
  sourceAgentSessionId?: string | null;
}
