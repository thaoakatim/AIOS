/**
 * DTO lọc / tìm kiếm ký ức cho `GET /memory`.
 * Tất cả trường optional — service áp giá trị mặc định an toàn.
 */
export class QueryMemoryDto {
  scope?: string;
  category?: string;
  /** Tìm tương đối (case-insensitive) trên cả `key` và `value`. */
  search?: string;
  /** Lọc theo phiên nguồn (truy vết provenance). */
  sourceAgentSessionId?: string;
  /** Số bản ghi tối đa (mặc định 50, tối đa 100). */
  limit?: number;
  /** Bỏ qua N bản ghi đầu (mặc định 0). */
  offset?: number;
}

/**
 * Tùy chọn truy hồi ký ức liên quan cho AgentExecutionContext.
 * Dùng cho `GET /memory/relevant` và `MemoryService.getRelevantMemory`.
 */
export class RelevantMemoryQueryDto {
  /** Câu truy vấn (mặc định lấy query từ context của agent). */
  query?: string;
  /** Session hiện tại — ưu tiên ký ức conversation của session này. */
  sessionId?: string;
  scope?: string;
  category?: string;
  /** Giới hạn số records (mặc định 20, tối đa 100). */
  limit?: number;
}
