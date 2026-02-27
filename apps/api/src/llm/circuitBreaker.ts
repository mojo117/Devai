/**
 * Simple error tracker for LLM providers.
 * Tracks consecutive errors per provider to skip failing providers temporarily.
 */

interface ProviderHealth {
  errorCount: number;
  lastError: string | null;
  lastErrorAt: number;
}

const ERROR_THRESHOLD = 3;
const RECOVERY_MS = 30_000;

class ErrorTracker {
  private providers = new Map<string, ProviderHealth>();

  private getHealth(provider: string): ProviderHealth {
    let health = this.providers.get(provider);
    if (!health) {
      health = { errorCount: 0, lastError: null, lastErrorAt: 0 };
      this.providers.set(provider, health);
    }
    return health;
  }

  isAvailable(provider: string): boolean {
    const health = this.getHealth(provider);
    if (health.errorCount < ERROR_THRESHOLD) return true;
    return Date.now() - health.lastErrorAt > RECOVERY_MS;
  }

  recordSuccess(provider: string): void {
    const health = this.getHealth(provider);
    health.errorCount = 0;
    health.lastError = null;
  }

  recordError(provider: string, error: string): void {
    const health = this.getHealth(provider);
    health.errorCount++;
    health.lastError = error;
    health.lastErrorAt = Date.now();
  }

  getStatus(provider: string): { available: boolean; errorCount: number; lastError: string | null } {
    const health = this.getHealth(provider);
    return {
      available: this.isAvailable(provider),
      errorCount: health.errorCount,
      lastError: health.lastError,
    };
  }
}

export const errorTracker = new ErrorTracker();
