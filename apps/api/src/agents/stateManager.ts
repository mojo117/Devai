/**
 * Agent State Manager
 *
 * Manages conversation state across all agents, including history,
 * context, pending approvals/questions, and parallel executions.
 */

import { nanoid } from 'nanoid';
import type {
  AgentName,
  AgentPhase,
  AgentHistoryEntry,
  AgentAction,
  AgentToolCall,
  ConversationState,
  TaskContext,
  QualificationResult,
  ApprovalRequest,
  UserQuestion,
  ParallelExecution,
  DelegationTask,
  DelegationResult,
} from './types.js';

// In-memory state storage (per session)
const stateStore = new Map<string, ConversationState>();

// Auto-cleanup after 24 hours
const STATE_TTL_MS = 24 * 60 * 60 * 1000;

export function createState(sessionId: string): ConversationState {
  const state: ConversationState = {
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
  };

  stateStore.set(sessionId, state);

  // Schedule cleanup
  setTimeout(() => {
    stateStore.delete(sessionId);
  }, STATE_TTL_MS);

  return state;
}

export function getState(sessionId: string): ConversationState | undefined {
  return stateStore.get(sessionId);
}

export function getOrCreateState(sessionId: string): ConversationState {
  return getState(sessionId) || createState(sessionId);
}

export function updateState(
  sessionId: string,
  updates: Partial<ConversationState>
): ConversationState {
  const state = getOrCreateState(sessionId);
  Object.assign(state, updates);
  stateStore.set(sessionId, state);
  return state;
}

export function deleteState(sessionId: string): void {
  stateStore.delete(sessionId);
}

// Phase Management
export function setPhase(sessionId: string, phase: AgentPhase): void {
  const state = getOrCreateState(sessionId);
  state.currentPhase = phase;
}

export function setActiveAgent(sessionId: string, agent: AgentName): void {
  const state = getOrCreateState(sessionId);
  state.activeAgent = agent;
}

// Task Context
export function setOriginalRequest(sessionId: string, request: string): void {
  const state = getOrCreateState(sessionId);
  state.taskContext.originalRequest = request;
}

export function setQualificationResult(
  sessionId: string,
  result: QualificationResult
): void {
  const state = getOrCreateState(sessionId);
  state.taskContext.qualificationResult = result;
}

export function addGatheredFile(sessionId: string, filePath: string): void {
  const state = getOrCreateState(sessionId);
  if (!state.taskContext.gatheredFiles.includes(filePath)) {
    state.taskContext.gatheredFiles.push(filePath);
  }
}

export function setGatheredInfo(
  sessionId: string,
  key: string,
  value: unknown
): void {
  const state = getOrCreateState(sessionId);
  state.taskContext.gatheredInfo[key] = value;
}

export function grantApproval(sessionId: string): void {
  const state = getOrCreateState(sessionId);
  state.taskContext.approvalGranted = true;
  state.taskContext.approvalTimestamp = new Date().toISOString();
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
  }
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
  return entry;
}

export function getHistory(sessionId: string): AgentHistoryEntry[] {
  const state = getState(sessionId);
  return state?.agentHistory ?? [];
}

export function getHistoryByAgent(
  sessionId: string,
  agent: AgentName
): AgentHistoryEntry[] {
  const history = getHistory(sessionId);
  return history.filter((entry) => entry.agent === agent);
}

export function getRecentHistory(
  sessionId: string,
  count: number = 10
): AgentHistoryEntry[] {
  const history = getHistory(sessionId);
  return history.slice(-count);
}

// Pending Approvals
export function addPendingApproval(
  sessionId: string,
  approval: ApprovalRequest
): void {
  const state = getOrCreateState(sessionId);
  state.pendingApprovals.push(approval);
}

export function removePendingApproval(
  sessionId: string,
  approvalId: string
): ApprovalRequest | undefined {
  const state = getState(sessionId);
  if (!state) return undefined;

  const index = state.pendingApprovals.findIndex(
    (a) => a.approvalId === approvalId
  );
  if (index !== -1) {
    return state.pendingApprovals.splice(index, 1)[0];
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
  question: UserQuestion
): void {
  const state = getOrCreateState(sessionId);
  state.pendingQuestions.push(question);
}

export function removePendingQuestion(
  sessionId: string,
  questionId: string
): UserQuestion | undefined {
  const state = getState(sessionId);
  if (!state) return undefined;

  const index = state.pendingQuestions.findIndex(
    (q) => q.questionId === questionId
  );
  if (index !== -1) {
    return state.pendingQuestions.splice(index, 1)[0];
  }
  return undefined;
}

export function getPendingQuestions(sessionId: string): UserQuestion[] {
  const state = getState(sessionId);
  return state?.pendingQuestions ?? [];
}

// Parallel Executions
export function startParallelExecution(
  sessionId: string,
  agents: AgentName[],
  tasks: DelegationTask[]
): ParallelExecution {
  const state = getOrCreateState(sessionId);

  const execution: ParallelExecution = {
    executionId: nanoid(),
    agents,
    tasks,
    status: 'running',
    results: [],
    startTime: new Date().toISOString(),
  };

  state.parallelExecutions.push(execution);
  return execution;
}

export function addParallelResult(
  sessionId: string,
  executionId: string,
  result: DelegationResult
): void {
  const state = getState(sessionId);
  if (!state) return;

  const execution = state.parallelExecutions.find(
    (e) => e.executionId === executionId
  );
  if (execution) {
    execution.results.push(result);

    // Check if all tasks are complete
    if (execution.results.length === execution.tasks.length) {
      const hasFailure = execution.results.some((r) => !r.success);
      execution.status = hasFailure ? 'partial_failure' : 'completed';
      execution.endTime = new Date().toISOString();
    }
  }
}

export function getParallelExecution(
  sessionId: string,
  executionId: string
): ParallelExecution | undefined {
  const state = getState(sessionId);
  return state?.parallelExecutions.find((e) => e.executionId === executionId);
}

export function getActiveParallelExecutions(
  sessionId: string
): ParallelExecution[] {
  const state = getState(sessionId);
  return (
    state?.parallelExecutions.filter((e) => e.status === 'running') ?? []
  );
}

// State Summary (for debugging/UI)
export function getStateSummary(sessionId: string): {
  sessionId: string;
  phase: AgentPhase;
  activeAgent: AgentName;
  historyCount: number;
  pendingApprovals: number;
  pendingQuestions: number;
  activeParallelExecutions: number;
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
    activeParallelExecutions: state.parallelExecutions.filter(
      (e) => e.status === 'running'
    ).length,
    approvalGranted: state.taskContext.approvalGranted,
  };
}

// Export full state for persistence/debugging
export function exportState(sessionId: string): ConversationState | null {
  return getState(sessionId) ?? null;
}

// Import state (for resuming sessions)
export function importState(state: ConversationState): void {
  stateStore.set(state.sessionId, state);
}

// Clear all states (for testing)
export function clearAllStates(): void {
  stateStore.clear();
}
