export interface ITracer {
  startSpan(name: string, metadata?: Record<string, unknown>): ISpan;
  getCurrentSpan(): ISpan | undefined;
}

export interface ISpan {
  readonly spanId: string;
  readonly traceId: string;
  
  addEvent(name: string, attributes?: Record<string, unknown>): void;
  setStatus(status: 'ok' | 'error', message?: string): void;
  end(): void;
}

