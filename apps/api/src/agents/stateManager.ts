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
  // Plan Mode types
  ExecutionPlan,
  PlanStatus,
  ChapoPerspective,
  KodaPerspective,
  DevoPerspective,
  RiskLevel,
  // Task Tracking types
  PlanTask,
  TaskStatus,
  TaskPriority,
  ExecutedTool,
  PlannedToolCall,
} from './types.js';

// In-memory state storage (per session)
const stateStore = new Map<string, ConversationState>();

// Auto-cleanup after 24 hours
const STATE_TTL_MS = 24 * 60 * 60 * 1000;

// Context cache TTL (5 minutes)
const CACHE_TTL_MS = 5 * 60 * 1000;

// ============================================
// CONTEXT CACHE TYPES
// ============================================

export interface CachedFile {
  content: string;
  size: number;
  cachedAt: number;
}

export interface CachedGitStatus {
  branch: string;
  staged: string[];
  modified: string[];
  untracked: string[];
  cachedAt: number;
}

export interface ContextCache {
  files: Map<string, CachedFile>;
  gitStatus?: CachedGitStatus;
  ttlMs: number;
}

// Context cache storage (per session)
const contextCacheStore = new Map<string, ContextCache>();

// ============================================
// CONTEXT CACHE FUNCTIONS
// ============================================

function getOrCreateContextCache(sessionId: string): ContextCache {
  let cache = contextCacheStore.get(sessionId);
  if (!cache) {
    cache = {
      files: new Map(),
      ttlMs: CACHE_TTL_MS,
    };
    contextCacheStore.set(sessionId, cache);
  }
  return cache;
}

/**
 * Get a cached file if it exists and is not expired
 */
export function getCachedFile(sessionId: string, path: string): CachedFile | undefined {
  const cache = contextCacheStore.get(sessionId);
  if (!cache) return undefined;

  const cached = cache.files.get(path);
  if (!cached) return undefined;

  // Check TTL
  if (Date.now() - cached.cachedAt > cache.ttlMs) {
    cache.files.delete(path);
    return undefined;
  }

  return cached;
}

/**
 * Cache a file for future use
 */
export function cacheFile(
  sessionId: string,
  path: string,
  content: string,
  size: number
): void {
  const cache = getOrCreateContextCache(sessionId);
  cache.files.set(path, {
    content,
    size,
    cachedAt: Date.now(),
  });
}

/**
 * Get cached git status if exists and not expired
 */
export function getCachedGitStatus(sessionId: string): CachedGitStatus | undefined {
  const cache = contextCacheStore.get(sessionId);
  if (!cache?.gitStatus) return undefined;

  // Check TTL (shorter for git status - 1 minute)
  if (Date.now() - cache.gitStatus.cachedAt > 60 * 1000) {
    cache.gitStatus = undefined;
    return undefined;
  }

  return cache.gitStatus;
}

/**
 * Cache git status for future use
 */
export function cacheGitStatus(
  sessionId: string,
  status: { branch: string; staged: string[]; modified: string[]; untracked: string[] }
): void {
  const cache = getOrCreateContextCache(sessionId);
  cache.gitStatus = {
    ...status,
    cachedAt: Date.now(),
  };
}

/**
 * Clear all cached context for a session
 */
export function clearContextCache(sessionId: string): void {
  contextCacheStore.delete(sessionId);
}

/**
 * Get cache statistics for a session
 */
export function getCacheStats(sessionId: string): {
  fileCount: number;
  hasGitStatus: boolean;
  oldestFile?: number;
} {
  const cache = contextCacheStore.get(sessionId);
  if (!cache) {
    return { fileCount: 0, hasGitStatus: false };
  }

  let oldestFile: number | undefined;
  for (const [, file] of cache.files) {
    if (!oldestFile || file.cachedAt < oldestFile) {
      oldestFile = file.cachedAt;
    }
  }

  return {
    fileCount: cache.files.size,
    hasGitStatus: !!cache.gitStatus,
    oldestFile,
  };
}

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
    // Plan Mode state
    currentPlan: undefined,
    planHistory: [],
    // Task Tracking state
    tasks: [],
    taskOrder: [],
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

// ============================================
// PLAN MODE MANAGEMENT
// ============================================

/**
 * Create a new execution plan with CHAPO's initial perspective
 */
export function createPlan(
  sessionId: string,
  chapoPerspective: ChapoPerspective
): ExecutionPlan {
  const state = getOrCreateState(sessionId);

  const plan: ExecutionPlan = {
    planId: nanoid(),
    sessionId,
    status: 'draft',
    chapoPerspective,
    summary: '',
    tasks: [],
    estimatedDuration: '',
    overallRisk: chapoPerspective.riskAssessment,
    createdAt: new Date().toISOString(),
  };

  state.currentPlan = plan;
  state.currentPhase = 'planning';
  return plan;
}

/**
 * Add KODA's code-focused perspective to the current plan
 */
export function addKodaPerspective(
  sessionId: string,
  perspective: KodaPerspective
): ExecutionPlan | undefined {
  const state = getState(sessionId);
  if (!state?.currentPlan) return undefined;

  state.currentPlan.kodaPerspective = perspective;
  return state.currentPlan;
}

/**
 * Add DEVO's ops-focused perspective to the current plan
 */
export function addDevoPerspective(
  sessionId: string,
  perspective: DevoPerspective
): ExecutionPlan | undefined {
  const state = getState(sessionId);
  if (!state?.currentPlan) return undefined;

  state.currentPlan.devoPerspective = perspective;
  return state.currentPlan;
}

/**
 * Finalize the plan with summary and tasks, ready for approval
 */
export function finalizePlan(
  sessionId: string,
  summary: string,
  tasks: PlanTask[],
  estimatedDuration?: string
): ExecutionPlan | undefined {
  const state = getState(sessionId);
  if (!state?.currentPlan) return undefined;

  state.currentPlan.summary = summary;
  state.currentPlan.tasks = tasks;
  state.currentPlan.status = 'pending_approval';
  state.currentPhase = 'waiting_plan_approval';

  if (estimatedDuration) {
    state.currentPlan.estimatedDuration = estimatedDuration;
  }

  // Calculate overall risk from all perspectives
  const risks: RiskLevel[] = [state.currentPlan.chapoPerspective.riskAssessment];
  // KODA and DEVO don't have riskAssessment, but their concerns affect overall risk
  if (state.currentPlan.kodaPerspective?.potentialBreakingChanges?.length) {
    risks.push('medium');
  }
  if (state.currentPlan.devoPerspective?.infrastructureChanges?.length) {
    risks.push('medium');
  }
  state.currentPlan.overallRisk = risks.includes('high')
    ? 'high'
    : risks.includes('medium')
      ? 'medium'
      : 'low';

  // Store tasks in state for tracking
  state.tasks = tasks;
  state.taskOrder = tasks.map((t) => t.taskId);

  return state.currentPlan;
}

/**
 * Approve the current plan and move to execution phase
 */
export function approvePlan(sessionId: string): ExecutionPlan | undefined {
  const state = getState(sessionId);
  if (!state?.currentPlan) return undefined;
  if (state.currentPlan.status !== 'pending_approval') return undefined;

  state.currentPlan.status = 'approved';
  state.currentPlan.approvedAt = new Date().toISOString();
  state.currentPhase = 'execution';

  return state.currentPlan;
}

/**
 * Reject the current plan
 */
export function rejectPlan(
  sessionId: string,
  reason: string
): ExecutionPlan | undefined {
  const state = getState(sessionId);
  if (!state?.currentPlan) return undefined;

  state.currentPlan.status = 'rejected';
  state.currentPlan.rejectedAt = new Date().toISOString();
  state.currentPlan.rejectionReason = reason;

  // Move plan to history
  state.planHistory.push(state.currentPlan);
  state.currentPlan = undefined;
  state.currentPhase = 'qualification'; // Reset to allow new approach

  // Clear tasks
  state.tasks = [];
  state.taskOrder = [];

  return state.planHistory[state.planHistory.length - 1];
}

/**
 * Get the current execution plan
 */
export function getCurrentPlan(sessionId: string): ExecutionPlan | undefined {
  const state = getState(sessionId);
  return state?.currentPlan;
}

/**
 * Get plan history
 */
export function getPlanHistory(sessionId: string): ExecutionPlan[] {
  const state = getState(sessionId);
  return state?.planHistory ?? [];
}

/**
 * Mark plan as executing
 */
export function startPlanExecution(sessionId: string): ExecutionPlan | undefined {
  const state = getState(sessionId);
  if (!state?.currentPlan) return undefined;
  if (state.currentPlan.status !== 'approved') return undefined;

  state.currentPlan.status = 'executing';
  state.currentPhase = 'execution';
  return state.currentPlan;
}

/**
 * Mark plan as completed and move to history
 */
export function completePlan(sessionId: string): ExecutionPlan | undefined {
  const state = getState(sessionId);
  if (!state?.currentPlan) return undefined;

  state.currentPlan.status = 'completed';
  state.planHistory.push(state.currentPlan);

  const completedPlan = state.currentPlan;
  state.currentPlan = undefined;
  state.currentPhase = 'review';

  return completedPlan;
}

// ============================================
// TASK TRACKING MANAGEMENT
// ============================================

/**
 * Create a new task
 */
export function createTask(
  sessionId: string,
  taskData: {
    planId: string;
    subject: string;
    description: string;
    activeForm: string;
    assignedAgent: AgentName;
    priority?: TaskPriority;
    blockedBy?: string[];
    toolsToExecute?: PlannedToolCall[];
  }
): PlanTask {
  const state = getOrCreateState(sessionId);

  const task: PlanTask = {
    taskId: nanoid(),
    planId: taskData.planId,
    subject: taskData.subject,
    description: taskData.description,
    activeForm: taskData.activeForm,
    assignedAgent: taskData.assignedAgent,
    priority: taskData.priority ?? 'normal',
    status: 'pending',
    blockedBy: taskData.blockedBy ?? [],
    blocks: [],
    toolsToExecute: taskData.toolsToExecute,
    toolsExecuted: [],
    createdAt: new Date().toISOString(),
  };

  state.tasks.push(task);
  state.taskOrder.push(task.taskId);

  // Update blocks for dependencies
  for (const blockedById of task.blockedBy) {
    const blockerTask = state.tasks.find((t) => t.taskId === blockedById);
    if (blockerTask && !blockerTask.blocks.includes(task.taskId)) {
      blockerTask.blocks.push(task.taskId);
    }
  }

  return task;
}

/**
 * Get a task by ID
 */
export function getTask(
  sessionId: string,
  taskId: string
): PlanTask | undefined {
  const state = getState(sessionId);
  return state?.tasks.find((t) => t.taskId === taskId);
}

/**
 * Get all tasks for a session
 */
export function getTasks(sessionId: string): PlanTask[] {
  const state = getState(sessionId);
  return state?.tasks ?? [];
}

/**
 * Get tasks in execution order
 */
export function getTasksInOrder(sessionId: string): PlanTask[] {
  const state = getState(sessionId);
  if (!state) return [];

  return state.taskOrder
    .map((taskId) => state.tasks.find((t) => t.taskId === taskId))
    .filter((t): t is PlanTask => t !== undefined);
}

/**
 * Get the next task that is not blocked
 * Returns the first pending task whose blockedBy tasks are all completed
 */
export function getNextTask(sessionId: string): PlanTask | undefined {
  const state = getState(sessionId);
  if (!state) return undefined;

  // Get tasks in order
  const orderedTasks = getTasksInOrder(sessionId);

  for (const task of orderedTasks) {
    if (task.status !== 'pending') continue;

    // Check if all blocking tasks are completed
    const isBlocked = task.blockedBy.some((blockerId) => {
      const blocker = state.tasks.find((t) => t.taskId === blockerId);
      return blocker && blocker.status !== 'completed';
    });

    if (!isBlocked) {
      return task;
    }
  }

  return undefined;
}

/**
 * Update task status with optional additional data
 */
export function updateTaskStatus(
  sessionId: string,
  taskId: string,
  status: TaskStatus,
  options?: {
    progress?: number;
    result?: string;
    error?: string;
  }
): PlanTask | undefined {
  const state = getState(sessionId);
  const task = state?.tasks.find((t) => t.taskId === taskId);
  if (!task) return undefined;

  task.status = status;

  if (options?.progress !== undefined) {
    task.progress = options.progress;
  }

  if (options?.result !== undefined) {
    task.result = options.result;
  }

  if (options?.error !== undefined) {
    task.error = options.error;
  }

  // Update timestamps
  if (status === 'in_progress' && !task.startedAt) {
    task.startedAt = new Date().toISOString();
  }

  if (status === 'completed' || status === 'failed' || status === 'skipped') {
    task.completedAt = new Date().toISOString();
  }

  return task;
}

/**
 * Add a dependency between tasks
 */
export function addTaskDependency(
  sessionId: string,
  taskId: string,
  blockedByTaskId: string
): boolean {
  const state = getState(sessionId);
  if (!state) return false;

  const task = state.tasks.find((t) => t.taskId === taskId);
  const blockerTask = state.tasks.find((t) => t.taskId === blockedByTaskId);

  if (!task || !blockerTask) return false;

  // Avoid circular dependencies
  if (blockerTask.blockedBy.includes(taskId)) {
    return false;
  }

  if (!task.blockedBy.includes(blockedByTaskId)) {
    task.blockedBy.push(blockedByTaskId);
  }

  if (!blockerTask.blocks.includes(taskId)) {
    blockerTask.blocks.push(taskId);
  }

  return true;
}

/**
 * Add an executed tool to a task
 */
export function addExecutedTool(
  sessionId: string,
  taskId: string,
  tool: ExecutedTool
): PlanTask | undefined {
  const state = getState(sessionId);
  const task = state?.tasks.find((t) => t.taskId === taskId);
  if (!task) return undefined;

  if (!task.toolsExecuted) {
    task.toolsExecuted = [];
  }

  task.toolsExecuted.push(tool);
  return task;
}

/**
 * Get tasks by status
 */
export function getTasksByStatus(
  sessionId: string,
  status: TaskStatus
): PlanTask[] {
  const state = getState(sessionId);
  return state?.tasks.filter((t) => t.status === status) ?? [];
}

/**
 * Get tasks assigned to a specific agent
 */
export function getTasksByAgent(
  sessionId: string,
  agent: AgentName
): PlanTask[] {
  const state = getState(sessionId);
  return state?.tasks.filter((t) => t.assignedAgent === agent) ?? [];
}

/**
 * Check if all tasks are completed
 */
export function areAllTasksCompleted(sessionId: string): boolean {
  const state = getState(sessionId);
  if (!state || state.tasks.length === 0) return false;

  return state.tasks.every(
    (t) => t.status === 'completed' || t.status === 'skipped'
  );
}

/**
 * Get task execution progress summary
 */
export function getTaskProgress(sessionId: string): {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
  skipped: number;
  percentComplete: number;
} {
  const state = getState(sessionId);
  const tasks = state?.tasks ?? [];

  const counts = {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === 'pending').length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    failed: tasks.filter((t) => t.status === 'failed').length,
    skipped: tasks.filter((t) => t.status === 'skipped').length,
  };

  const percentComplete =
    counts.total > 0
      ? Math.round(
          ((counts.completed + counts.skipped) / counts.total) * 100
        )
      : 0;

  return { ...counts, percentComplete };
}

/**
 * Skip all tasks that are blocked by a failed task
 */
export function skipBlockedTasks(
  sessionId: string,
  failedTaskId: string
): PlanTask[] {
  const state = getState(sessionId);
  if (!state) return [];

  const skippedTasks: PlanTask[] = [];
  const failedTask = state.tasks.find((t) => t.taskId === failedTaskId);

  if (!failedTask) return [];

  // Recursively skip all tasks blocked by this one
  const skipRecursive = (taskId: string) => {
    const task = state.tasks.find((t) => t.taskId === taskId);
    if (!task) return;

    for (const blockedId of task.blocks) {
      const blockedTask = state.tasks.find((t) => t.taskId === blockedId);
      if (blockedTask && blockedTask.status === 'pending') {
        blockedTask.status = 'skipped';
        blockedTask.completedAt = new Date().toISOString();
        blockedTask.error = `Skipped due to failed dependency: ${failedTask.subject}`;
        skippedTasks.push(blockedTask);
        skipRecursive(blockedId);
      }
    }
  };

  skipRecursive(failedTaskId);
  return skippedTasks;
}

// Clear all states (for testing)
export function clearAllStates(): void {
  stateStore.clear();
}
