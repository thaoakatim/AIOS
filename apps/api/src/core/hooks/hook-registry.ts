import { Injectable } from '@nestjs/common';
import { AgentExecutionContext } from '../context/agent-context.interface';
import { AgentResponse } from '../context/agent-response.interface';
import { AIOSHookHandler } from './aios-hook.interface';

export interface IHookRegistry {
  registerHook(handler: AIOSHookHandler): void;
  getHooks(): AIOSHookHandler[];

  /**
   * Chạy chuỗi hook onBeforePromptBuild theo mô hình Immutable Pipeline.
   * Mỗi hook nhận context từ hook trước và trả về bản sao context mới.
   */
  runBeforePromptBuild(
    ctx: AgentExecutionContext,
  ): Promise<AgentExecutionContext>;

  executeBeforePromptBuild(
    ctx: AgentExecutionContext,
  ): Promise<AgentExecutionContext>;

  executeBeforeToolExecution(
    toolName: string,
    input: Record<string, unknown>,
    ctx: AgentExecutionContext,
  ): Promise<boolean>;

  executeAfterToolExecution(
    toolName: string,
    result: unknown,
    ctx: AgentExecutionContext,
  ): Promise<void>;

  executeAfterCompletion(
    response: AgentResponse,
    ctx: AgentExecutionContext,
  ): Promise<void>;
}

@Injectable()
export class HookRegistry implements IHookRegistry {
  private hooks: AIOSHookHandler[] = [];

  registerHook(handler: AIOSHookHandler): void {
    this.hooks.push(handler);
  }

  getHooks(): AIOSHookHandler[] {
    return [...this.hooks];
  }

  /**
   * Chạy chuỗi hook onBeforePromptBuild bất biến (Immutable Hook Pipeline).
   * Context được pipe tuần tự qua từng hook đã đăng ký.
   */
  async runBeforePromptBuild(
    ctx: AgentExecutionContext,
  ): Promise<AgentExecutionContext> {
    let currentCtx = ctx;
    for (const hook of this.hooks) {
      if (hook.onBeforePromptBuild) {
        currentCtx = await hook.onBeforePromptBuild(currentCtx);
      }
    }
    return currentCtx;
  }

  executeBeforePromptBuild(
    ctx: AgentExecutionContext,
  ): Promise<AgentExecutionContext> {
    return this.runBeforePromptBuild(ctx);
  }

  async executeBeforeToolExecution(
    toolName: string,
    input: Record<string, unknown>,
    ctx: AgentExecutionContext,
  ): Promise<boolean> {
    for (const hook of this.hooks) {
      if (hook.onBeforeToolExecution) {
        const allowed = await hook.onBeforeToolExecution(toolName, input, ctx);
        if (!allowed) {
          return false;
        }
      }
    }
    return true;
  }

  async executeAfterToolExecution(
    toolName: string,
    result: unknown,
    ctx: AgentExecutionContext,
  ): Promise<void> {
    for (const hook of this.hooks) {
      if (hook.onAfterToolExecution) {
        await hook.onAfterToolExecution(toolName, result, ctx);
      }
    }
  }

  async executeAfterCompletion(
    response: AgentResponse,
    ctx: AgentExecutionContext,
  ): Promise<void> {
    for (const hook of this.hooks) {
      if (hook.onAfterCompletion) {
        await hook.onAfterCompletion(response, ctx);
      }
    }
  }
}
