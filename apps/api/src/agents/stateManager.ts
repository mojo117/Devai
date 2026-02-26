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

export type {
  ParallelLoopAction,
  ParallelLoopEntry,
  SessionMode,
} from './state-manager/sessionState.js';

export {
  setPhase,
  setActiveAgent,
  setOriginalRequest,
  setQualificationResult,
  addGatheredFile,
  setGatheredInfo,
  setActiveTurnId,
  getActiveTurnId,
  ensureActiveTurnId,
  setLoopRunning,
  isLoopActive,
  // Parallel loop management
  getSessionMode,
  setSessionMode,
  registerParallelLoop,
  unregisterParallelLoop,
  appendLoopAction,
  getOtherLoopContexts,
  updateLoopStatus,
  updateLoopLabel,
  getActiveLoopCount,
  abortAllLoops,
  // Approvals
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

// Test utilities
export { cleanupAllLocks } from './state-manager/loopLock.js';

