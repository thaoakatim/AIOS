/**
 * DTO cập nhật ký ức (tất cả trường đều optional, ngoại trừ `key`
 * là bất biến sau khi tạo để giữ tính ổn định của userProfile map).
 */
export class UpdateMemoryDto {
  /** Nội dung ký ức mới. */
  value?: string;

  /** Nhóm ký ức: "profile" | "preference" | "fact". */
  category?: string;

  /** Phạm vi: "global" | "conversation". */
  scope?: string;

  /**
   * Truy vết nguồn gốc — cho phép gán lại hoặc gỡ (set null)
   * khi ký ức được xác thực thủ công.
   */
  sourceAgentSessionId?: string | null;
}
