/**
 * Agent System Types
 *
 * Single agent: CHAPO — handles all tasks directly.
 */

import type { ActionPreview } from '../actions/types.js';

export type AgentName = 'chapo';

export type AgentRole = 'AI Assistant';

export type TaskType = 'code_change' | 'devops' | 'exploration' | 'mixed' | 'unclear';

export type RiskLevel = 'low' | 'medium' | 'high';

export type TaskComplexity = 'simple' | 'moderate' | 'complex';

export type LLMProviderName = 'anthropic' | 'openai' | 'gemini' | 'zai' | 'moonshot';

export interface ModelSelection {
  provider: LLMProviderName;
  model: string;
  reason: string;
  /** Models to try on the same provider before falling back cross-provider. */
  sameProviderFallbacks?: string[];
}

export type AgentPhase =
  | 'idle'
  | 'qualification'
  | 'execution'
  | 'review'
  | 'error'
  | 'waiting_user';

export type AgentStatus = 'idle' | 'thinking' | 'executing' | 'waiting' | 'done' | 'error';

// Agent Definition
export interface AgentDefinition {
  name: AgentName;
  role: AgentRole;
  model: string;
  fastModel?: string;
  fallbackModel?: string;
  tools: string[];
  systemPrompt: string;
  capabilities: AgentCapabilities;
}

export interface AgentCapabilities {
  canWriteFiles?: boolean;
  canEditFiles?: boolean;
  canDeleteFiles?: boolean;
  canCreateDirectories?: boolean;
  canExecuteBash?: boolean;
  canSSH?: boolean;
  canGitCommit?: boolean;
  canGitPush?: boolean;
  canTriggerWorkflows?: boolean;
  canManagePM2?: boolean;
  canManageScheduler?: boolean;
  canSendNotifications?: boolean;
  canSendEmail?: boolean;
  canManageTaskForge?: boolean;
  canAskUser?: boolean;
  canRequestApproval?: boolean;
}

// Task Qualification
export interface QualificationResult {
  taskType: TaskType;
  riskLevel: RiskLevel;
  complexity: TaskComplexity;
  targetAgent: AgentName | null;
  requiresApproval: boolean;
  requiresClarification: boolean;
  clarificationQuestion?: string;
  gatheredContext: GatheredContext;
  reasoning: string;
}

export interface GatheredContext {
  relevantFiles: string[];
  fileContents: Record<string, string>;
  gitStatus?: {
    branch: string;
    staged: string[];
    modified: string[];
    untracked: string[];
  };
  projectInfo?: Record<string, unknown>;
}

// User Interaction
export interface UserQuestion {
  questionId: string;
  question: string;
  options?: string[];
  context?: string;
  fromAgent: AgentName;
  timestamp: string;
  turnId?: string;
  questionKind?: 'continue' | 'clarification' | 'generic';
  fingerprint?: string;
  expiresAt?: string;
}

export interface UserResponse {
  questionId: string;
  answer: string;
  selectedOption?: string;
  timestamp: string;
}

export interface ApprovalRequest {
  approvalId: string;
  description: string;
  riskLevel: RiskLevel;
  actions: PlannedAction[];
  fromAgent: AgentName;
  timestamp: string;
  /**
   * Optional machine-readable metadata for non-risk approvals (e.g. "continue").
   * Safe to ignore in the UI.
   */
  context?: Record<string, unknown>;
}

export interface PlannedAction {
  toolName: string;
  toolArgs: Record<string, unknown>;
  description: string;
  preview?: string;
}

export interface ApprovalResponse {
  approvalId: string;
  approved: boolean;
  timestamp: string;
}

// Session Inbox
export interface InboxMessage {
  id: string;
  content: string;
  receivedAt: Date;
  acknowledged: boolean;
  source: 'websocket' | 'telegram';
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

// Conversation State
export interface ConversationState {
  sessionId: string;
  currentPhase: AgentPhase;
  activeAgent: AgentName;
  agentHistory: AgentHistoryEntry[];
  taskContext: TaskContext;
  pendingApprovals: ApprovalRequest[];
  pendingQuestions: UserQuestion[];

  todos: TodoItem[];

  // Multi-message state
  isLoopRunning: boolean;
}

export interface GatheredInfo {
  // Project context
  projectRoot?: string;
  claudeMdProjectRoot?: string;
  platform?: string;
  uiHost?: string;

  // Context blocks (cached per session)
  devaiMdBlock?: string;
  devaiMdSourcePath?: string;
  claudeMdBlock?: string;
  claudeMdSourcePaths?: string[];
  workspaceMdBlock?: string;
  workspaceMdSourcePaths?: string[];
  workspaceMdMode?: string;
  workspaceMdDiagnostics?: unknown;
  globalContextBlock?: string;
  globalContextSource?: string;
  memoryBlock?: string;
  memoryQualityBlock?: string;
  memoryNamespaces?: string[];
  memoryRetrievedHits?: number;
  activeTurnId?: string;

  // Request qualification
  taskComplexity?: string;
  modelSelection?: unknown;
  trustMode?: string;

  // Workspace/channel modes
  workspaceContextMode?: string;
  chatMode?: string;
  sessionMode?: string;
  visibility?: string;

  // Parallel loop mode (serial | parallel) — separate from workspace sessionMode
  loopMode?: string;

  // Allow additional keys for forward compatibility
  [key: string]: unknown;
}

export interface TaskContext {
  originalRequest: string;
  qualificationResult?: QualificationResult;
  gatheredFiles: string[];
  gatheredInfo: GatheredInfo;
  approvalGranted: boolean;
  approvalTimestamp?: string;
}

export interface AgentHistoryEntry {
  entryId: string;
  timestamp: string;
  agent: AgentName;
  action: AgentAction;
  input: unknown;
  output: unknown;
  toolCalls?: AgentToolCall[];
  duration: number;
  status: 'success' | 'error' | 'escalated' | 'waiting';
}

export type AgentAction =
  | 'qualify_task'
  | 'gather_context'
  | 'execute_tool'
  | 'ask_user'
  | 'request_approval'
  | 'respond'
  | 'review';

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string;
  duration?: number;
}

// Streaming Events
export type AgentStreamEvent =
  // Agent lifecycle events
  | { type: 'agent_start'; agent: AgentName; phase: AgentPhase }
  | { type: 'agent_thinking'; agent: AgentName; status: string }
  | { type: 'agent_complete'; agent: AgentName; result: unknown; durationMs?: number; toolCount?: number }
  | { type: 'error'; agent: AgentName; error: string }
  // Tool events
  | { type: 'tool_call'; agent: AgentName; toolName: string; args: Record<string, unknown> }
  | { type: 'tool_result'; agent: AgentName; toolName: string; result: unknown; success: boolean }
  // User interaction events
  | { type: 'user_question'; question: UserQuestion }
  | { type: 'approval_request'; request: ApprovalRequest; sessionId?: string }
  | { type: 'action_pending'; actionId: string; toolName: string; toolArgs: Record<string, unknown>; description: string; preview?: ActionPreview }
  // History & state events
  | { type: 'agent_history'; entries: AgentHistoryEntry[] }
  // Intermediate response events
  | { type: 'partial_response'; message: string; inReplyTo?: string }
  | { type: 'todo_updated'; todos: TodoItem[] }
  // Inbox events
  | { type: 'message_queued'; messageId: string; preview: string }
  | { type: 'inbox_processing'; count: number }
  // Parallel loop events
  | { type: 'loop_started'; turnId: string; taskLabel: string }
  | { type: 'loop_completed'; turnId: string; taskLabel: string }
  | { type: 'mode_changed'; mode: 'serial' | 'parallel' };

// Agent Response
export interface AgentResponse {
  agent: AgentName;
  content: string;
  toolCalls?: AgentToolCall[];
  userQuestion?: UserQuestion;
  approvalRequest?: ApprovalRequest;
  finished: boolean;
}

// ============================================
// CHAPO LOOP TYPES
// ============================================

export interface ChapoLoopResult {
  answer: string;
  status: 'completed' | 'waiting_for_user' | 'error' | 'aborted';
  totalIterations: number;
  question?: string; // if status === 'waiting_for_user'
}
