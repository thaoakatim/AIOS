import { AgentExecutionContext } from '../context/agent-context.interface';
import { AgentResponse } from '../context/agent-response.interface';

export interface AIOSHookHandler {
  /** Được gọi trước khi LLM Gateway build prompt (bổ sung memory, filter RAG) */
  onBeforePromptBuild?(ctx: AgentExecutionContext): Promise<void>;

  /** Được gọi trước khi một Tool được kích hoạt (kiểm tra quyền, an toàn hệ thống) */
  onBeforeToolExecution?(
    toolName: string,
    input: Record<string, unknown>,
    ctx: AgentExecutionContext,
  ): Promise<boolean>;

  /** Được gọi sau khi Tool trả về kết quả */
  onAfterToolExecution?(
    toolName: string,
    result: unknown,
    ctx: AgentExecutionContext,
  ): Promise<void>;

  /** Được gọi sau khi hoàn tất (ghi log Observability, tính toán token) */
  onAfterCompletion?(
    response: AgentResponse,
    ctx: AgentExecutionContext,
  ): Promise<void>;
}
