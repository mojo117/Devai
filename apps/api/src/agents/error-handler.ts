// ──────────────────────────────────────────────
// Agent Error Handler — Resilient error handling for ChapoLoop
// Never crashes, always reports and continues.
// ──────────────────────────────────────────────

export interface AgentError {
  code: string;
  message: string;
  recoverable: boolean;
  context?: Record<string, unknown>;
  originalError?: Error;
  retryCount: number;
  maxRetries: number;
}

type ErrorCallback = (error: AgentError) => void;

export class AgentErrorHandler {
  private retryCounts = new Map<string, number>();
  private errorLog: AgentError[] = [];
  private onError?: ErrorCallback;

  constructor(private maxRetries: number = 3) {}

  setErrorCallback(cb: ErrorCallback): void {
    this.onError = cb;
  }

  /**
   * Wraps an async operation with resilient error handling.
   * Returns [result, null] on success or [null, AgentError] on failure.
   */
  async safe<T>(
    operationKey: string,
    fn: () => Promise<T>,
    options?: { recoverable?: boolean; context?: Record<string, unknown> }
  ): Promise<[T, null] | [null, AgentError]> {
    const retryCount = this.retryCounts.get(operationKey) || 0;

    try {
      const result = await fn();
      // Reset retry count on success
      this.retryCounts.delete(operationKey);
      return [result, null];
    } catch (err) {
      const error: AgentError = {
        code: this.classifyError(err),
        message: err instanceof Error ? err.message : String(err),
        recoverable: options?.recoverable ?? true,
        context: options?.context,
        originalError: err instanceof Error ? err : undefined,
        retryCount,
        maxRetries: this.maxRetries,
      };

      this.errorLog.push(error);
      this.retryCounts.set(operationKey, retryCount + 1);

      if (this.onError) {
        this.onError(error);
      }

      return [null, error];
    }
  }

  /**
   * Whether the given operation can still be retried.
   */
  canRetry(operationKey: string): boolean {
    const count = this.retryCounts.get(operationKey) || 0;
    return count < this.maxRetries;
  }

  /**
   * Reset the retry count for a given operation.
   */
  resetRetry(operationKey: string): void {
    this.retryCounts.delete(operationKey);
  }

  /**
   * Create a human-readable error summary for the LLM to reason about.
   */
  formatForLLM(error: AgentError): string {
    const lines = [
      `[ERROR] ${error.code}: ${error.message}`,
      `Recoverable: ${error.recoverable ? 'yes' : 'no'}`,
      `Retries: ${error.retryCount}/${error.maxRetries}`,
    ];
    if (error.context) {
      lines.push(`Context: ${JSON.stringify(error.context)}`);
    }
    return lines.join('\n');
  }

  /**
   * Return accumulated errors.
   */
  getErrors(): AgentError[] {
    return [...this.errorLog];
  }

  /**
   * Clear error state.
   */
  clear(): void {
    this.retryCounts.clear();
    this.errorLog = [];
  }

  classifyError(err: unknown): string {
    if (!(err instanceof Error)) return 'UNKNOWN';

    const msg = err.message.toLowerCase();
    if (msg.includes('timeout')) return 'TIMEOUT';
    if (msg.includes('rate limit') || msg.includes('429')) return 'RATE_LIMIT';
    if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('fetch')) return 'NETWORK';
    if (msg.includes('not found') || msg.includes('404')) return 'NOT_FOUND';
    if (msg.includes('permission') || msg.includes('403') || msg.includes('401')) return 'AUTH';
    if (msg.includes('whitelisted') || msg.includes('not allowed')) return 'FORBIDDEN_TOOL';
    if (msg.includes('token') && msg.includes('limit')) return 'TOKEN_LIMIT';
    return 'INTERNAL';
  }
}
