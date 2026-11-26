/**
 * DTO tạo Plan mới.
 * Validation được thực hiện tường minh ở PlannerService (không dùng class-validator).
 */
export class CreatePlanDto {
  title!: string;
  description?: string | null;
  workflowId?: string;
  status?: string;
}
