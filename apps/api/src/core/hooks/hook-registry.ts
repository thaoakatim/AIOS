import { AIOSHookHandler } from './aios-hook.interface';

export interface IHookRegistry {
  registerHook(handler: AIOSHookHandler): void;
  getHooks(): AIOSHookHandler[];
}

export class HookRegistry implements IHookRegistry {
  private hooks: AIOSHookHandler[] = [];

  registerHook(handler: AIOSHookHandler): void {
    this.hooks.push(handler);
  }

  getHooks(): AIOSHookHandler[] {
    return this.hooks;
  }
}
