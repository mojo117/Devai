import { getAgentState, upsertAgentState } from '../../db/queries.js';
import type { ConversationState } from '../types.js';

// In-memory state storage (per session)
const stateStore = new Map<string, ConversationState>();

// Persistence: avoid duplicate loads / debounce writes per session
const loadPromises = new Map<string, Promise<ConversationState>>();
const persistTimers = new Map<string, NodeJS.Timeout>();
const lastPersisted = new Map<string, string>();
const persistInFlight = new Map<string, Promise<void>>();
const persistRetryTimers = new Map<string, NodeJS.Timeout>();
const persistRetryCount = new Map<string, number>();

// Auto-cleanup after 24 hours
const STATE_TTL_MS = 24 * 60 * 60 * 1000;

// Persistence retry/backoff (best-effort, non-fatal)
const PERSIST_RETRY_BASE_MS = 500;
const PERSIST_RETRY_MAX_MS = 10_000;
const PERSIST_RETRY_MAX_ATTEMPTS = 8;

// Keep persistence payload bounded so JSONB rows don't grow unbounded over long sessions.
const MAX_PERSISTED_AGENT_HISTORY = 200;

function buildDefaultState(sessionId: string): ConversationState {
  return {
    sessionId,
    currentPhase: 'qualification',
    activeAgent: 'chapo',
    agentHistory: [],
    taskContext: {
      originalRequest: '',
      gatheredFiles: [],
      gatheredInfo: {},
      approvalGranted: false,
    },
    pendingApprovals: [],
    pendingQuestions: [],
    parallelExecutions: [],
    // Plan Mode state
    currentPlan: undefined,
    planHistory: [],
    // Task Tracking state
    tasks: [],
    taskOrder: [],
    // Multi-message state
    isLoopRunning: false,
  };
}

function scheduleMemoryCleanup(sessionId: string): void {
  // Best-effort memory hygiene; persistence lives in DB.
  const t = setTimeout(() => {
    stateStore.delete(sessionId);
    persistTimers.delete(sessionId);
    lastPersisted.delete(sessionId);
    persistInFlight.delete(sessionId);
    const retry = persistRetryTimers.get(sessionId);
    if (retry) clearTimeout(retry);
    persistRetryTimers.delete(sessionId);
    persistRetryCount.delete(sessionId);
  }, STATE_TTL_MS);
  t.unref?.();
}

function normalizeLoadedState(sessionId: string, raw: unknown): ConversationState {
  const base = buildDefaultState(sessionId);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<ConversationState>;

  const merged: ConversationState = {
    ...base,
    ...r,
    sessionId,
    taskContext: {
      ...base.taskContext,
      ...(r.taskContext || {}),
      gatheredFiles: Array.isArray(r.taskContext?.gatheredFiles)
        ? r.taskContext.gatheredFiles
        : base.taskContext.gatheredFiles,
      gatheredInfo: (r.taskContext?.gatheredInfo && typeof r.taskContext.gatheredInfo === 'object')
        ? (r.taskContext.gatheredInfo as Record<string, unknown>)
        : base.taskContext.gatheredInfo,
    },
    agentHistory: Array.isArray(r.agentHistory) ? r.agentHistory : base.agentHistory,
    pendingApprovals: Array.isArray(r.pendingApprovals) ? r.pendingApprovals : base.pendingApprovals,
    pendingQuestions: Array.isArray(r.pendingQuestions) ? r.pendingQuestions : base.pendingQuestions,
    parallelExecutions: Array.isArray(r.parallelExecutions) ? r.parallelExecutions : base.parallelExecutions,
    planHistory: Array.isArray(r.planHistory) ? r.planHistory : base.planHistory,
    tasks: Array.isArray(r.tasks) ? r.tasks : base.tasks,
    taskOrder: Array.isArray(r.taskOrder) ? r.taskOrder : base.taskOrder,
  };

  return merged;
}

export function schedulePersist(sessionId: string): void {
  if (persistTimers.has(sessionId)) return;
  const t = setTimeout(() => {
    persistTimers.delete(sessionId);
    void persistNow(sessionId);
  }, 300);
  t.unref?.();
  persistTimers.set(sessionId, t);
}

function schedulePersistRetry(sessionId: string, err: unknown): void {
  if (!stateStore.has(sessionId)) return;
  if (persistRetryTimers.has(sessionId)) return;

  const attempt = (persistRetryCount.get(sessionId) ?? 0) + 1;
  persistRetryCount.set(sessionId, attempt);
  if (attempt > PERSIST_RETRY_MAX_ATTEMPTS) {
    console.warn('[state] Giving up persisting state after retries', { sessionId, attempt, err });
    return;
  }

  const delay = Math.min(PERSIST_RETRY_BASE_MS * (2 ** (attempt - 1)), PERSIST_RETRY_MAX_MS);
  const t = setTimeout(() => {
    persistRetryTimers.delete(sessionId);
    void persistNow(sessionId);
  }, delay);
  t.unref?.();
  persistRetryTimers.set(sessionId, t);
}

async function persistNow(sessionId: string): Promise<void> {
  const inFlight = persistInFlight.get(sessionId);
  if (inFlight) return inFlight;

  const p = (async () => {
    const state = stateStore.get(sessionId);
    if (!state) return;

    let encoded = '';
    try {
      encoded = JSON.stringify(state);
    } catch (err) {
      console.warn('[state] Failed to serialize state', { sessionId, err });
      return;
    }

    if (lastPersisted.get(sessionId) === encoded) return;

    try {
      // Deep-clone via JSON and prune before writing to keep rows bounded.
      const decoded = JSON.parse(encoded) as ConversationState;
      if (Array.isArray(decoded.agentHistory) && decoded.agentHistory.length > MAX_PERSISTED_AGENT_HISTORY) {
        decoded.agentHistory = decoded.agentHistory.slice(-MAX_PERSISTED_AGENT_HISTORY);
      }

      await upsertAgentState(sessionId, decoded);
      lastPersisted.set(sessionId, encoded);
      persistRetryCount.delete(sessionId);
      const retry = persistRetryTimers.get(sessionId);
      if (retry) clearTimeout(retry);
      persistRetryTimers.delete(sessionId);
    } catch (err) {
      console.warn('[state] Failed to persist state', { sessionId, err });
      schedulePersistRetry(sessionId, err);
    }
  })().finally(() => {
    persistInFlight.delete(sessionId);
  });

  persistInFlight.set(sessionId, p);
  return p;
}

export function createState(sessionId: string): ConversationState {
  const state: ConversationState = buildDefaultState(sessionId);
  stateStore.set(sessionId, state);
  scheduleMemoryCleanup(sessionId);
  return state;
}

export function getState(sessionId: string): ConversationState | undefined {
  return stateStore.get(sessionId);
}

export function getOrCreateState(sessionId: string): ConversationState {
  return getState(sessionId) || createState(sessionId);
}

/**
 * Flush state immediately (best-effort).
 * Use this after enqueueing approvals/questions so they survive restarts even if the process exits quickly.
 */
export async function flushState(sessionId: string): Promise<void> {
  const t = persistTimers.get(sessionId);
  if (t) {
    clearTimeout(t);
    persistTimers.delete(sessionId);
  }
  try {
    await persistNow(sessionId);
  } catch {
    // persistNow is best-effort; callers should not fail user-visible flows on persistence errors.
  }
}

/**
 * Ensure a session's ConversationState is available and loaded from the DB.
 * Call this at the start of request handlers to make approvals/questions persistent across restarts.
 */
export async function ensureStateLoaded(sessionId: string): Promise<ConversationState> {
  const existing = stateStore.get(sessionId);
  if (existing) return existing;

  const pending = loadPromises.get(sessionId);
  if (pending) return pending;

  const p = (async () => {
    const row = await getAgentState(sessionId);
    const state = row ? normalizeLoadedState(sessionId, row.state) : createState(sessionId);
    stateStore.set(sessionId, state);
    scheduleMemoryCleanup(sessionId);
    // Persist immediately for newly created sessions or to normalize stored state shape.
    schedulePersist(sessionId);
    return state;
  })().finally(() => {
    loadPromises.delete(sessionId);
  });

  loadPromises.set(sessionId, p);
  return p;
}

export function updateState(
  sessionId: string,
  updates: Partial<ConversationState>,
): ConversationState {
  const state = getOrCreateState(sessionId);
  Object.assign(state, updates);
  stateStore.set(sessionId, state);
  schedulePersist(sessionId);
  return state;
}

export function deleteState(sessionId: string): void {
  stateStore.delete(sessionId);
  const t = persistTimers.get(sessionId);
  if (t) clearTimeout(t);
  persistTimers.delete(sessionId);
  lastPersisted.delete(sessionId);
  persistInFlight.delete(sessionId);
  const retry = persistRetryTimers.get(sessionId);
  if (retry) clearTimeout(retry);
  persistRetryTimers.delete(sessionId);
  persistRetryCount.delete(sessionId);
}

// Export full state for persistence/debugging
export function exportState(sessionId: string): ConversationState | null {
  return getState(sessionId) ?? null;
}

// Import state (for resuming sessions)
export function importState(state: ConversationState): void {
  stateStore.set(state.sessionId, state);
  scheduleMemoryCleanup(state.sessionId);
  schedulePersist(state.sessionId);
}

// Clear all states (for testing)
export function clearAllStates(): void {
  stateStore.clear();
}
