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
  // SCOUT types
  ScoutScope,
  ScoutConfidence,
  ScoutResult,
  WebFinding,
  ScoutStreamEvent,
} from './types.js';

// Agent Definitions
export { CHAPO_AGENT, CHAPO_META_TOOLS } from './chapo.js';
export { DEVO_AGENT, DEVO_META_TOOLS } from './devo.js';
export { SCOUT_AGENT, SCOUT_META_TOOLS } from './scout.js';

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
  setActiveTurnId,
  getActiveTurnId,
  ensureActiveTurnId,
  grantApproval,
  isApprovalGranted,
  getStateSummary,
  exportState,
  importState,
  clearAllStates,
} from './stateManager.js';

// Router
export { processRequest, spawnScout } from './router.js';

// Event System
export {
  // Event factories
  AgentEvents,
  ToolEvents,
  ScoutEvents,
  UserEvents,
  ParallelEvents,
  SystemEvents,
  // Types
  type EventCategory,
  type BaseStreamEvent,
  type StreamEvent,
  // Helpers
  sendEvent,
  createEventSender,
  isStreamEvent,
} from './events.js';
