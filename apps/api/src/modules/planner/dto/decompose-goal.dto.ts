export class DecomposeGoalDto {
  goal!: string;
  title?: string;
  workflowId?: string;
  maxDepth?: number;
  dryRun?: boolean;
}
