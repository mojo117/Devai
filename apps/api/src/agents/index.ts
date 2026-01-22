/**
 * Agents Module
 *
 * Exports all multi-agent system components.
 */

// Types
export type {
  AgentName,
  AgentRole,
  AgentCapabilities,
  AgentDefinition,
  DelegationTask,
  EscalationIssue,
  UserQuestion,
  ApprovalRequest,
  QualificationResult,
  AgentHistoryEntry,
  ParallelExecution,
  ConversationState,
  AgentStreamEvent,
} from './types.js';

// Agent Definitions
export { CHAPO_AGENT, CHAPO_META_TOOLS } from './chapo.js';
export { KODA_AGENT, KODA_META_TOOLS } from './koda.js';
export { DEVO_AGENT, DEVO_META_TOOLS } from './devo.js';

// State Management
export {
  getOrCreateState,
  getState,
  createState,
  updateState,
  deleteState,
  setPhase,
  setActiveAgent,
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
  setOriginalRequest,
  setQualificationResult,
  addGatheredFile,
  setGatheredInfo,
  grantApproval,
  isApprovalGranted,
  getStateSummary,
  exportState,
  importState,
  clearAllStates,
} from './stateManager.js';

// Router
export { processRequest } from './router.js';
