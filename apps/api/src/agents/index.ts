/**
 * Agents Module
 *
 * Exports all agent system components.
 */

// Types
export type {
  AgentName,
  AgentRole,
  AgentCapabilities,
  AgentDefinition,
  UserQuestion,
  ApprovalRequest,
  QualificationResult,
  AgentHistoryEntry,
  ConversationState,
  AgentStreamEvent,
} from './types.js';

// Agent Definitions
export { CHAPO_AGENT, CHAPO_META_TOOLS } from './chapo.js';

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
export { processRequest } from './router.js';

// Event System
export {
  // Event factories
  AgentEvents,
  ToolEvents,
  UserEvents,
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
