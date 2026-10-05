/**
 * DTO truy vấn cho Knowledge Module.
 * Tất cả trường optional — service áp giá trị mặc định an toàn.
 */
export class QueryDocumentDto {
  /** "pending" | "processing" | "indexed" | "failed" */
  status?: string;
  /** "pdf" | "md" | "docx" | "txt" | ... */
  fileType?: string;
  /** Tìm tương đối (case-insensitive) trên `title`. */
  search?: string;
  /** Số bản ghi tối đa (mặc định 50, tối đa 100). */
  limit?: number;
  /** Bỏ qua N bản ghi đầu (mặc định 0). */
  offset?: number;
}

/** Query cho `GET /knowledge/search` (Semantic Search). */
export class SearchKnowledgeDto {
  /** Câu hỏi/cụm từ cần tra cứu. Bắt buộc — service trả 400 nếu rỗng. */
  query?: string;

  /** Top-K (mặc định 5, tối đa 50). */
  limit?: number;

  /** Ngưỡng điểm tương đồng tối thiểu (0..1) để lọc kết quả yếu. */
  minScore?: number;

  /** Chỉ tìm trong một tài liệu cụ thể (phục vụ Q&A theo file đính kèm). */
  documentId?: string;
}

/** Tùy chọn truy hồi chunk cho AgentExecutionContext (Task 2.3). */
export class RelevantChunksQueryDto {
  /** Câu truy vấn; bỏ trống sẽ dùng query của agent context. */
  query?: string;
  /** Số chunk trả về (mặc định 5, tối đa 50). */
  limit?: number;
  /** Ngưỡng điểm tương đồng tối thiểu (0..1). */
  minScore?: number;
  /** Chỉ tìm trong danh sách tài liệu này (ví dụ file đính kèm tin nhắn). */
  documentIds?: string[];
}

/** Tùy chọn cho `POST /knowledge/:id/reindex`. */
export class ReindexDocumentDto {
  chunkSize?: number;
  chunkOverlap?: number;
  /** 'sync' (mặc định) hoặc 'queue'. */
  mode?: string;
}

/** Body gắn nhiều tài liệu vào một Message (bảng `MessageDocument`). */
export class LinkDocumentsToMessageDto {
  /** Danh sách id tài liệu (UUID). Bắt buộc, tối đa 50. */
  documentIds!: string[];
}
