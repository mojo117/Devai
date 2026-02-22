import type { ConversationState } from '../types.js';

const DEBOUNCE_MS = 300;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 10_000;
const MAX_RETRIES = 8;
const MAX_HISTORY_ENTRIES = 200;

type WriteFn = (sessionId: string, state: ConversationState) => Promise<void>;
type GetStateFn = () => ConversationState | undefined;

export class PersistenceQueue {
  private debounceTimer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private retryCount = 0;
  private lastEncoded = '';

  constructor(
    private readonly sessionId: string,
    private readonly getState: GetStateFn,
    private readonly writeFn: WriteFn,
  ) {}

  /** Schedule a debounced persist. Multiple calls collapse into one write. */
  schedule(): void {
    if (this.debounceTimer) return;
    const t = setTimeout(() => {
      this.debounceTimer = null;
      void this.persistNow();
    }, DEBOUNCE_MS);
    t.unref?.();
    this.debounceTimer = t;
  }

  /** Flush immediately — cancel debounce, write now. Best-effort. */
  async flush(): Promise<void> {
    this.clearDebounce();
    try {
      await this.persistNow();
    } catch {
      // Best-effort; callers should not fail user-visible flows on persistence errors.
    }
  }

  /** Clear all timers. Call when session is deleted or cleaned up. */
  cleanup(): void {
    this.clearDebounce();
    this.clearRetry();
  }

  // ── Private ──

  private async persistNow(): Promise<void> {
    if (this.inFlight) return this.inFlight;

    const p = (async () => {
      const state = this.getState();
      if (!state) return;

      let encoded = '';
      try {
        encoded = JSON.stringify(state);
      } catch (err) {
        console.warn('[state] Failed to serialize state', { sessionId: this.sessionId, err });
        return;
      }

      if (this.lastEncoded === encoded) return;

      try {
        const decoded = JSON.parse(encoded) as ConversationState;
        if (Array.isArray(decoded.agentHistory) && decoded.agentHistory.length > MAX_HISTORY_ENTRIES) {
          decoded.agentHistory = decoded.agentHistory.slice(-MAX_HISTORY_ENTRIES);
        }

        await this.writeFn(this.sessionId, decoded);
        this.lastEncoded = encoded;
        this.retryCount = 0;
        this.clearRetry();
      } catch (err) {
        console.warn('[state] Failed to persist state', { sessionId: this.sessionId, err });
        this.scheduleRetry();
      }
    })().finally(() => {
      this.inFlight = null;
    });

    this.inFlight = p;
    return p;
  }

  private scheduleRetry(): void {
    if (!this.getState()) return;
    if (this.retryTimer) return;

    this.retryCount++;
    if (this.retryCount > MAX_RETRIES) {
      console.warn('[state] Giving up persisting state after retries', {
        sessionId: this.sessionId,
        attempt: this.retryCount,
      });
      return;
    }

    const delay = Math.min(RETRY_BASE_MS * (2 ** (this.retryCount - 1)), RETRY_MAX_MS);
    const t = setTimeout(() => {
      this.retryTimer = null;
      void this.persistNow();
    }, delay);
    t.unref?.();
    this.retryTimer = t;
  }

  private clearDebounce(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
}
