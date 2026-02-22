import { getAgentState, upsertAgentState } from '../../db/queries.js';
import type { ConversationState } from '../types.js';
import { PersistenceQueue } from './persistenceQueue.js';

// In-memory state storage (per session)
const stateStore = new Map<string, ConversationState>();

// Load deduplication (not persistence — stays in core)
const loadPromises = new Map<string, Promise<ConversationState>>();

// Per-session persistence queues
const persistQueues = new Map<string, PersistenceQueue>();

// Auto-cleanup after 24 hours
const STATE_TTL_MS = 24 * 60 * 60 * 1000;

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
    const queue = persistQueues.get(sessionId);
    if (queue) queue.cleanup();
    persistQueues.delete(sessionId);
  }, STATE_TTL_MS);
  t.unref?.();
}

function getOrCreateQueue(sessionId: string): PersistenceQueue {
  let queue = persistQueues.get(sessionId);
  if (!queue) {
    queue = new PersistenceQueue(
      sessionId,
      () => stateStore.get(sessionId),
      upsertAgentState,
    );
    persistQueues.set(sessionId, queue);
  }
  return queue;
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
  getOrCreateQueue(sessionId).schedule();
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
  const queue = persistQueues.get(sessionId);
  if (queue) await queue.flush();
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
  const queue = persistQueues.get(sessionId);
  if (queue) queue.cleanup();
  persistQueues.delete(sessionId);
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
  for (const queue of persistQueues.values()) queue.cleanup();
  persistQueues.clear();
  stateStore.clear();
}
