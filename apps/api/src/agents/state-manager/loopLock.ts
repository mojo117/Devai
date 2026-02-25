/**
 * Loop Lock Manager — Atomic session-level locking to prevent race conditions
 * when checking and setting loop active state.
 */

import { deleteState } from './core.js';

// Session-level locks for atomic operations
const sessionLocks = new Map<string, Promise<void>>();

// Pending lock resolvers
const lockResolvers = new Map<string, (() => void)[]>();

/**
 * Acquire an exclusive lock for a session.
 * Returns a release function that MUST be called.
 */
export async function acquireSessionLock(sessionId: string): Promise<() => void> {
  // Wait for any existing lock
  while (sessionLocks.has(sessionId)) {
    const existingLock = sessionLocks.get(sessionId)!;
    await existingLock.catch(() => {}); // Ignore errors from previous locks
  }

  // Create new lock
  let releaseFn: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseFn = () => {
      sessionLocks.delete(sessionId);
      resolve();
      // Wake up any waiting locks
      const waiting = lockResolvers.get(sessionId) || [];
      lockResolvers.delete(sessionId);
      waiting.forEach((fn) => fn());
    };
  });

  sessionLocks.set(sessionId, lockPromise);
  return releaseFn!;
}

/**
 * Try to acquire a lock without blocking.
 * Returns release function or null if locked.
 */
export function tryAcquireSessionLock(sessionId: string): (() => void) | null {
  if (sessionLocks.has(sessionId)) {
    return null;
  }

  let releaseFn: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseFn = () => {
      sessionLocks.delete(sessionId);
      resolve();
      const waiting = lockResolvers.get(sessionId) || [];
      lockResolvers.delete(sessionId);
      waiting.forEach((fn) => fn());
    };
  });

  sessionLocks.set(sessionId, lockPromise);
  return releaseFn!;
}

// Track session last activity for cleanup
const sessionActivity = new Map<string, number>();

export function updateSessionActivity(sessionId: string): void {
  sessionActivity.set(sessionId, Date.now());
}

export function getSessionLastActivity(sessionId: string): number | undefined {
  return sessionActivity.get(sessionId);
}

// Cleanup interval for stale sessions (runs every 5 minutes)
const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const SESSION_STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

function cleanupStaleSessions(): void {
  const now = Date.now();
  const staleSessions: string[] = [];

  for (const [sessionId, lastActivity] of sessionActivity.entries()) {
    if (now - lastActivity > SESSION_STALE_THRESHOLD_MS) {
      staleSessions.push(sessionId);
    }
  }

  for (const sessionId of staleSessions) {
    sessionActivity.delete(sessionId);
    // Clean up any dangling locks
    if (sessionLocks.has(sessionId)) {
      sessionLocks.delete(sessionId);
    }
    // Clean up state from memory
    deleteState(sessionId);
  }

  if (staleSessions.length > 0) {
    console.log(`[loopLock] Cleaned up ${staleSessions.length} stale sessions`);
  }
}

// Start cleanup interval
setInterval(cleanupStaleSessions, SESSION_CLEANUP_INTERVAL_MS).unref?.();

// Cleanup function for tests
export function cleanupAllLocks(): void {
  sessionLocks.clear();
  lockResolvers.clear();
  sessionActivity.clear();
}
