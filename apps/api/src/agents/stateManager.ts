/**
 * Agent State Manager
 *
 * Facade for session state/cache/persistence modules.
 */

export type {
  CachedFile,
  CachedGitStatus,
  ContextCache,
} from './state-manager/contextCache.js';

export {
  getCachedFile,
  cacheFile,
  getCachedGitStatus,
  cacheGitStatus,
  clearContextCache,
  getCacheStats,
} from './state-manager/contextCache.js';

export {
  createState,
  getState,
  getOrCreateState,
  ensureStateLoaded,
  flushState,
  updateState,
  deleteState,
  exportState,
  importState,
  clearAllStates,
} from './state-manager/core.js';

export {
  setPhase,
  setActiveAgent,
  setOriginalRequest,
  setQualificationResult,
  addGatheredFile,
  setGatheredInfo,
  setLoopRunning,
  isLoopActive,
  grantApproval,
  isApprovalGranted,
  addHistoryEntry,
  getHistory,
  getHistoryByAgent,
  getRecentHistory,
  addPendingApproval,
  removePendingApproval,
  getPendingApprovals,
  addPendingQuestion,
  removePendingQuestion,
  getPendingQuestions,
  startParallelExecution,
  addParallelResult,
  getParallelExecution,
  getActiveParallelExecutions,
  getStateSummary,
} from './state-manager/sessionState.js';

export {
  createPlan,
  addDevoPerspective,
  finalizePlan,
  approvePlan,
  rejectPlan,
  getCurrentPlan,
  getPlanHistory,
  startPlanExecution,
  completePlan,
} from './state-manager/planState.js';

export {
  createTask,
  getTask,
  getTasks,
  getTasksInOrder,
  getNextTask,
  updateTaskStatus,
  addTaskDependency,
  addExecutedTool,
  getTasksByStatus,
  getTasksByAgent,
  areAllTasksCompleted,
  getTaskProgress,
  skipBlockedTasks,
} from './state-manager/taskState.js';
