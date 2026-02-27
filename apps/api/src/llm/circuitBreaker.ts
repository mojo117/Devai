/**
 * Circuit Breaker for LLM providers — prevents wasting time on failing providers.
 *
 * Three states: CLOSED (normal) → OPEN (skip provider) → HALF_OPEN (test) → CLOSED
 */

interface ProviderHealth {
  state: 'closed' | 'open' | 'half_open';
  errorCount: number;
  windowStart: number;
  openedAt: number | null;
  lastError: string | null;
}

const ERROR_THRESHOLD = 5;
const WINDOW_MS = 60_000;
const COOLDOWN_MS = 30_000;

class CircuitBreaker {
  private providers = new Map<string, ProviderHealth>();

  private getHealth(provider: string): ProviderHealth {
    let health = this.providers.get(provider);
    if (!health) {
      health = {
        state: 'closed',
        errorCount: 0,
        windowStart: Date.now(),
        openedAt: null,
        lastError: null,
      };
      this.providers.set(provider, health);
    }
    return health;
  }

  isAvailable(provider: string): boolean {
    const health = this.getHealth(provider);
    if (health.state === 'closed') return true;
    if (health.state === 'open') {
      if (Date.now() - (health.openedAt || 0) > COOLDOWN_MS) {
        health.state = 'half_open';
        return true;
      }
      return false;
    }
    return true; // half_open: allow one test request
  }

  recordSuccess(provider: string): void {
    const health = this.getHealth(provider);
    health.state = 'closed';
    health.errorCount = 0;
    health.windowStart = Date.now();
    health.openedAt = null;
    health.lastError = null;
  }

  recordError(provider: string, error: string): void {
    const health = this.getHealth(provider);

    if (health.state === 'half_open') {
      // Test request failed — reopen circuit
      health.state = 'open';
      health.openedAt = Date.now();
      health.lastError = error;
      console.warn(`[circuit-breaker] ${provider}: half_open → open (test failed: ${error.slice(0, 80)})`);
      return;
    }

    // Reset window if expired
    if (Date.now() - health.windowStart > WINDOW_MS) {
      health.errorCount = 0;
      health.windowStart = Date.now();
    }

    health.errorCount++;
    health.lastError = error;

    if (health.errorCount >= ERROR_THRESHOLD) {
      health.state = 'open';
      health.openedAt = Date.now();
      console.warn(`[circuit-breaker] ${provider}: closed → open (${health.errorCount} errors in window)`);
    }
  }

  /** Returns ms until this provider's cooldown expires (0 if already available). */
  getTimeUntilAvailable(provider: string): number {
    const health = this.getHealth(provider);
    if (health.state !== 'open' || !health.openedAt) return 0;
    const remaining = COOLDOWN_MS - (Date.now() - health.openedAt);
    return Math.max(0, remaining);
  }

  getStatus(provider: string): { state: string; errorCount: number; lastError: string | null } {
    const health = this.getHealth(provider);
    return {
      state: health.state,
      errorCount: health.errorCount,
      lastError: health.lastError,
    };
  }

  getSnapshot(): Record<string, { state: string; errorCount: number; lastError: string | null }> {
    const result: Record<string, { state: string; errorCount: number; lastError: string | null }> = {};
    for (const [provider, health] of this.providers) {
      result[provider] = {
        state: health.state,
        errorCount: health.errorCount,
        lastError: health.lastError,
      };
    }
    return result;
  }
}

export const circuitBreaker = new CircuitBreaker();
