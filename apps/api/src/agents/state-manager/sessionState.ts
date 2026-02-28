import { nanoid } from 'nanoid';
import { getOrCreateState, getState, schedulePersist, deleteState } from './core.js';
import {
  acquireSessionLock,
  tryAcquireSessionLock,
  updateSessionActivity,
  cleanupAllLocks,
} from './loopLock.js';
import type {
  AgentAction,
  AgentHistoryEntry,
  AgentName,
  AgentPhase,
  AgentToolCall,
  ApprovalRequest,
  QualificationResult,
  UserQuestion,
} from '../types.js';

// --- Parallel Loop Types ---

export interface ParallelLoopAction {
  iteration: number;
  tool: string;
  summary: string;
}

export interface ParallelLoopEntry {
  turnId: string;
  taskLabel: string;
  originalPrompt: string;
  status: 'running' | 'completed' | 'aborted';
  finalAnswer?: string;
  actions: ParallelLoopAction[];
}

export type SessionMode = 'serial' | 'parallel';

// Runtime-only: sessionId → Map<turnId, ParallelLoopEntry>
const activeLoops = new Map<string, Map<string, ParallelLoopEntry>>();

// Backwards-compatible: tracks whether ANY loop is active for a session
const activeLoopSessions = new Set<string>();

// Module-level lock for Set operations
const loopSetLock = new Map<string, Promise<void>>();

// Phase Management
export function setPhase(sessionId: string, phase: AgentPhase): void {
  const state = getOrCreateState(sessionId);
  state.currentPhase = phase;
  schedulePersist(sessionId);
}

export function setActiveAgent(sessionId: string, agent: AgentName): void {
  const state = getOrCreateState(sessionId);
  state.activeAgent = agent;
  schedulePersist(sessionId);
}

// Task Context
export function setOriginalRequest(sessionId: string, request: string): void {
  const state = getOrCreateState(sessionId);
  state.taskContext.originalRequest = request;
  schedulePersist(sessionId);
}

export function setQualificationResult(
  sessionId: string,
  result: QualificationResult,
): void {
  const state = getOrCreateState(sessionId);
  state.taskContext.qualificationResult = result;
  schedulePersist(sessionId);
}

export function addGatheredFile(sessionId: string, filePath: string): void {
  const state = getOrCreateState(sessionId);
  if (!state.taskContext.gatheredFiles.includes(filePath)) {
    state.taskContext.gatheredFiles.push(filePath);
    schedulePersist(sessionId);
  }
}

export function setGatheredInfo(
  sessionId: string,
  key: string,
  value: unknown,
): void {
  const state = getOrCreateState(sessionId);
  state.taskContext.gatheredInfo[key] = value;
  schedulePersist(sessionId);
}

export function setActiveTurnId(sessionId: string, turnId: string): void {
  const state = getOrCreateState(sessionId);
  state.taskContext.gatheredInfo.activeTurnId = turnId;
  schedulePersist(sessionId);
}

export function getActiveTurnId(sessionId: string): string | null {
  const state = getState(sessionId);
  const raw = state?.taskContext.gatheredInfo.activeTurnId;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
}

export function ensureActiveTurnId(sessionId: string, preferredTurnId?: string): string {
  const preferred = preferredTurnId?.trim();
  if (preferred) {
    const existing = getActiveTurnId(sessionId);
    if (existing !== preferred) {
      setActiveTurnId(sessionId, preferred);
    }
    return preferred;
  }

  const existing = getActiveTurnId(sessionId);
  if (existing) return existing;
  const nextTurnId = nanoid();
  setActiveTurnId(sessionId, nextTurnId);
  return nextTurnId;
}

export async function setLoopRunning(sessionId: string, running: boolean): Promise<void> {
  const release = await acquireSessionLock(sessionId);
  try {
    const state = getOrCreateState(sessionId);
    state.isLoopRunning = running;
    if (running) {
      activeLoopSessions.add(sessionId);
    } else {
      activeLoopSessions.delete(sessionId);
    }
    updateSessionActivity(sessionId);
  } finally {
    release();
  }
}

/** Synchronous version for contexts where we already hold the lock */
export function setLoopRunningSync(sessionId: string, running: boolean): void {
  const state = getOrCreateState(sessionId);
  state.isLoopRunning = running;
  if (running) {
    activeLoopSessions.add(sessionId);
  } else {
    activeLoopSessions.delete(sessionId);
  }
  updateSessionActivity(sessionId);
}

export async function isLoopActive(sessionId: string): Promise<boolean> {
  const release = await acquireSessionLock(sessionId);
  try {
    if (activeLoopSessions.has(sessionId)) {
      return true;
    }

    // Self-heal stale persisted flags from older runs/restarts.
    const state = getState(sessionId);
    if (state?.isLoopRunning) {
      state.isLoopRunning = false;
    }
    return false;
  } finally {
    release();
  }
}

/** Non-blocking check - returns null if can't acquire lock immediately */
export function isLoopActiveSync(sessionId: string): boolean | null {
  const release = tryAcquireSessionLock(sessionId);
  if (!release) {
    // Lock is held - loop is definitely active
    return null; // Indicate "unknown - check async version"
  }
  try {
    if (activeLoopSessions.has(sessionId)) {
      return true;
    }
    const state = getState(sessionId);
    if (state?.isLoopRunning) {
      state.isLoopRunning = false;
    }
    return false;
  } finally {
    release();
  }
}

// --- Parallel Loop Management ---

export function getSessionMode(sessionId: string): SessionMode {
  const state = getState(sessionId);
  const mode = state?.taskContext.gatheredInfo.loopMode;
  return mode === 'parallel' ? 'parallel' : 'serial';
}

export function setSessionMode(sessionId: string, mode: SessionMode): void {
  const state = getOrCreateState(sessionId);
  state.taskContext.gatheredInfo.loopMode = mode;
  schedulePersist(sessionId);
}

export async function registerParallelLoop(
  sessionId: string,
  turnId: string,
  taskLabel: string,
  originalPrompt: string,
): Promise<void> {
  const release = await acquireSessionLock(sessionId);
  try {
    let sessionLoops = activeLoops.get(sessionId);
    if (!sessionLoops) {
      sessionLoops = new Map();
      activeLoops.set(sessionId, sessionLoops);
    }
    sessionLoops.set(turnId, {
      turnId,
      taskLabel,
      originalPrompt,
      status: 'running',
      actions: [],
    });
    // Keep activeLoopSessions in sync
    activeLoopSessions.add(sessionId);
    updateSessionActivity(sessionId);
  } finally {
    release();
  }
}

export async function unregisterParallelLoop(sessionId: string, turnId: string): Promise<void> {
  const release = await acquireSessionLock(sessionId);
  try {
    const sessionLoops = activeLoops.get(sessionId);
    if (!sessionLoops) return;
    sessionLoops.delete(turnId);
    if (sessionLoops.size === 0) {
      activeLoops.delete(sessionId);
      activeLoopSessions.delete(sessionId);
      // Also clear persisted flag
      const state = getState(sessionId);
      if (state) state.isLoopRunning = false;
    }
    updateSessionActivity(sessionId);
  } finally {
    release();
  }
}

const MAX_ACTIONS_PER_LOOP = 50;

export function appendLoopAction(
  sessionId: string,
  turnId: string,
  action: ParallelLoopAction,
): void {
  const entry = activeLoops.get(sessionId)?.get(turnId);
  if (!entry) return;
  entry.actions.push(action);
  // Trim oldest actions if over limit
  if (entry.actions.length > MAX_ACTIONS_PER_LOOP) {
    entry.actions = entry.actions.slice(-MAX_ACTIONS_PER_LOOP);
  }
}

export function getOtherLoopContexts(
  sessionId: string,
  excludeTurnId: string,
): ParallelLoopEntry[] {
  const sessionLoops = activeLoops.get(sessionId);
  if (!sessionLoops) return [];
  const entries: ParallelLoopEntry[] = [];
  for (const [turnId, entry] of sessionLoops) {
    if (turnId !== excludeTurnId) entries.push(entry);
  }
  return entries;
}

export async function updateLoopStatus(
  sessionId: string,
  turnId: string,
  status: 'completed' | 'aborted',
  finalAnswer?: string,
): Promise<void> {
  const release = await acquireSessionLock(sessionId);
  try {
    const entry = activeLoops.get(sessionId)?.get(turnId);
    if (!entry) return;
    entry.status = status;
    if (finalAnswer) entry.finalAnswer = finalAnswer;
    updateSessionActivity(sessionId);
  } finally {
    release();
  }

  // Auto-cleanup after 5 minutes (outside lock to avoid blocking)
  setTimeout(() => {
    void (async () => {
      const cleanupRelease = await acquireSessionLock(sessionId);
      try {
        const sessions = activeLoops.get(sessionId);
        if (sessions) {
          sessions.delete(turnId);
          if (sessions.size === 0) {
            activeLoops.delete(sessionId);
            activeLoopSessions.delete(sessionId);
            // Clean up session from memory after all loops done
            deleteState(sessionId);
          }
        }
      } finally {
        cleanupRelease();
      }
    })();
  }, 5 * 60 * 1000);
}

export function updateLoopLabel(
  sessionId: string,
  turnId: string,
  taskLabel: string,
): void {
  const entry = activeLoops.get(sessionId)?.get(turnId);
  if (entry) entry.taskLabel = taskLabel;
}

export function getActiveLoopCount(sessionId: string): number {
  const sessionLoops = activeLoops.get(sessionId);
  if (!sessionLoops) return 0;
  let count = 0;
  for (const entry of sessionLoops.values()) {
    if (entry.status === 'running') count++;
  }
  return count;
}

export async function abortAllLoops(sessionId: string): Promise<string[]> {
  const release = await acquireSessionLock(sessionId);
  try {
    const sessionLoops = activeLoops.get(sessionId);
    if (!sessionLoops) return [];
    const turnIds: string[] = [];
    for (const [turnId, entry] of sessionLoops) {
      if (entry.status === 'running') {
        entry.status = 'aborted';
        turnIds.push(turnId);
      }
    }
    updateSessionActivity(sessionId);
    return turnIds;
  } finally {
    release();
  }
}

// --- Approvals ---

export function grantApproval(sessionId: string): void {
  const state = getOrCreateState(sessionId);
  state.taskContext.approvalGranted = true;
  state.taskContext.approvalTimestamp = new Date().toISOString();
  schedulePersist(sessionId);
}

export function isApprovalGranted(sessionId: string): boolean {
  const state = getState(sessionId);
  return state?.taskContext.approvalGranted ?? false;
}

// History Management
export function addHistoryEntry(
  sessionId: string,
  agent: AgentName,
  action: AgentAction,
  input: unknown,
  output: unknown,
  options?: {
    toolCalls?: AgentToolCall[];
    duration?: number;
    status?: 'success' | 'error' | 'escalated' | 'waiting';
  },
): AgentHistoryEntry {
  const state = getOrCreateState(sessionId);

  const entry: AgentHistoryEntry = {
    entryId: nanoid(),
    timestamp: new Date().toISOString(),
    agent,
    action,
    input,
    output,
    toolCalls: options?.toolCalls,
    duration: options?.duration ?? 0,
    status: options?.status ?? 'success',
  };

  state.agentHistory.push(entry);
  schedulePersist(sessionId);
  return entry;
}

export function getHistory(sessionId: string): AgentHistoryEntry[] {
  const state = getState(sessionId);
  return state?.agentHistory ?? [];
}

export function getHistoryByAgent(
  sessionId: string,
  agent: AgentName,
): AgentHistoryEntry[] {
  const history = getHistory(sessionId);
  return history.filter((entry) => entry.agent === agent);
}

export function getRecentHistory(
  sessionId: string,
  count: number = 10,
): AgentHistoryEntry[] {
  const history = getHistory(sessionId);
  return history.slice(-count);
}

// Pending Approvals
export function addPendingApproval(
  sessionId: string,
  approval: ApprovalRequest,
): void {
  const state = getOrCreateState(sessionId);
  state.pendingApprovals.push(approval);
  schedulePersist(sessionId);
}

export function removePendingApproval(
  sessionId: string,
  approvalId: string,
): ApprovalRequest | undefined {
  const state = getState(sessionId);
  if (!state) return undefined;

  const index = state.pendingApprovals.findIndex((a) => a.approvalId === approvalId);
  if (index !== -1) {
    const removed = state.pendingApprovals.splice(index, 1)[0];
    schedulePersist(sessionId);
    return removed;
  }
  return undefined;
}

export function getPendingApprovals(sessionId: string): ApprovalRequest[] {
  const state = getState(sessionId);
  return state?.pendingApprovals ?? [];
}

// Pending Questions
export function addPendingQuestion(
  sessionId: string,
  question: UserQuestion,
): void {
  const state = getOrCreateState(sessionId);
  state.pendingQuestions.push(question);
  schedulePersist(sessionId);
}

export function removePendingQuestion(
  sessionId: string,
  questionId: string,
): UserQuestion | undefined {
  const state = getState(sessionId);
  if (!state) return undefined;

  const index = state.pendingQuestions.findIndex((q) => q.questionId === questionId);
  if (index !== -1) {
    const removed = state.pendingQuestions.splice(index, 1)[0];
    schedulePersist(sessionId);
    return removed;
  }
  return undefined;
}

export function getPendingQuestions(sessionId: string): UserQuestion[] {
  const state = getState(sessionId);
  return state?.pendingQuestions ?? [];
}

// State Summary (for debugging/UI)
export function getStateSummary(sessionId: string): {
  sessionId: string;
  phase: AgentPhase;
  activeAgent: AgentName;
  historyCount: number;
  pendingApprovals: number;
  pendingQuestions: number;
  approvalGranted: boolean;
} | null {
  const state = getState(sessionId);
  if (!state) return null;

  return {
    sessionId: state.sessionId,
    phase: state.currentPhase,
    activeAgent: state.activeAgent,
    historyCount: state.agentHistory.length,
    pendingApprovals: state.pendingApprovals.length,
    pendingQuestions: state.pendingQuestions.length,
    approvalGranted: state.taskContext.approvalGranted,
  };
}
