export class UpdateTaskDto {
  title?: string;
  description?: string | null;
  parentTaskId?: string | null;
  status?: string;
  order?: number;
  dueDate?: string | null;
}
