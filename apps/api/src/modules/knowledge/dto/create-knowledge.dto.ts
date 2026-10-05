/**
 * DTO cho `POST /knowledge/upload` (multipart/form-data).
 *
 * Không dùng class-validator (chưa có trong dependencies) — validation thực
 * hiện ở tầng KnowledgeService để giữ DTO thuần (Pure Contract), giống
 * Memory Module.
 */
export class UploadDocumentDto {
  /** Tiêu đề hiển thị. Bỏ trống sẽ suy ra từ tên file gốc. */
  title?: string;

  /** Định dạng: "pdf" | "md" | "docx" | "txt" | ... Bỏ trống sẽ suy ra từ mime type. */
  fileType?: string;

  /**
   * Cắt tùy chỉnh. Bỏ trống -> dùng giá trị mặc định của
   * `RecursiveTextSplitter` (1200 ký tự / overlap 200).
   */
  chunkSize?: number;
  chunkOverlap?: number;

  /**
   * 'sync' (mặc định): xử lý pipeline ngay trong request.
   * 'queue': đẩy job BullMQ, trả về ngay với status 'pending'
   * (xem docs/request-flow.md — Flow 3: Knowledge Ingestion).
   */
  mode?: string;

  /**
   * Gắn tài liệu vừa upload vào các Message đã có (bảng `MessageDocument`).
   * Cho phép đính kèm nhiều tài liệu vào một tin nhắn — Task 2.2.
   */
  messageIds?: string[];
}
