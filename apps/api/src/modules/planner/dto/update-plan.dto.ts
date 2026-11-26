/**
 * DTO cập nhật Plan (cho phép un-archive từ `archived` -> `active`).
 */
export class UpdatePlanDto {
  title?: string;
  description?: string | null;
  status?: string;
}
