/**
 * DTO cập nhật metadata của tài liệu (`PATCH /knowledge/:id`).
 *
 * KHÔNG cho phép đổi `sourceUrl`/`fileType` — nội dung gốc chỉ thay đổi được
 * qua luồng upload lại (tạo Document mới) để không làm lệch vector đã index.
 */
export class UpdateDocumentDto {
  title?: string;

  /** Đánh dấu lại trạng thái (ví dụ đưa 'failed' về 'pending' để retry). */
  status?: string;
}
