/**
 * Multi-Agent System Types
 *
 * Three agents: CHAPO (Coordinator), DEVO (Developer & DevOps), SCOUT (Explorer)
 */

import type { ActionPreview } from '../actions/types.js';

export type AgentName = 'chapo' | 'devo' | 'scout' | 'caio';

export type AgentRole = 'Task Coordinator' | 'Developer & DevOps Engineer' | 'Exploration Specialist' | 'Communications & Administration Officer';

export type TaskType = 'code_change' | 'devops' | 'exploration' | 'mixed' | 'unclear';
export type DelegationDomain = 'development' | 'communication' | 'research';

export type RiskLevel = 'low' | 'medium' | 'high';

export type TaskComplexity = 'simple' | 'moderate' | 'complex';

// Smart model selection - for performance optimization
export type TaskComplexityLevel = 'trivial' | 'simple' | 'moderate' | 'complex';

export type LLMProviderName = 'anthropic' | 'openai' | 'gemini' | 'zai';

export interface ModelSelection {
  provider: LLMProviderName;
  model: string;
  reason: string;
}

export interface ModelTier {
  provider: LLMProviderName;
  model: string;
}

export type AgentPhase =
  | 'idle'
  | 'qualification'
  | 'execution'
  | 'review'
  | 'error'
  | 'waiting_user';

export type EscalationIssueType = 'error' | 'clarification' | 'blocker';

export type AgentStatus = 'idle' | 'thinking' | 'executing' | 'waiting' | 'done' | 'error';

// Agent Definition
export interface AgentDefinition {
  name: AgentName;
  role: AgentRole;
  model: string;
  fallbackModel?: string;
  tools: string[];
  systemPrompt: string;
  capabilities: AgentCapabilities;
}

export interface AgentCapabilities {
  readOnly?: boolean;
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
  canDelegateToDevo?: boolean;
  canDelegateToScout?: boolean;
  canAskUser?: boolean;
  canRequestApproval?: boolean;
  canEscalate?: boolean;
  canManageScheduler?: boolean;
  canSendNotifications?: boolean;
  canSendEmail?: boolean;
  canManageTaskForge?: boolean;
  canDelegateToCaio?: boolean;
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
  // Delegation context (when CHAPO delegates to another agent)
  delegationTask?: string;
  delegationDomain?: DelegationDomain;
  delegationObjective?: string;
  delegationContext?: unknown;
  delegationFiles?: string[];
}

// Delegation
export interface DelegationTask {
  taskId: string;
  description: string;
  originalRequest: string;
  context: GatheredContext;
  constraints: string[];
  fromAgent: AgentName;
  toAgent: AgentName;
  timestamp: string;
}

export interface DelegationResult {
  taskId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  toolsExecuted: ExecutedTool[];
  fromAgent: AgentName;
  timestamp: string;
}

export interface ExecutedTool {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  success: boolean;
  duration: number;
  timestamp: string;
}

// Escalation
export interface EscalationIssue {
  issueId: string;
  fromAgent: AgentName;
  issueType: EscalationIssueType;
  description: string;
  context: Record<string, unknown>;
  suggestedSolutions?: string[];
  timestamp: string;
}

export interface EscalationResponse {
  issueId: string;
  resolved: boolean;
  action: 'retry' | 'alternative' | 'ask_user' | 'abort';
  instructions?: string;
  alternativeApproach?: string;
  userQuestion?: UserQuestion;
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

export type ObligationType = 'user_request' | 'delegation';
export type ObligationStatus = 'open' | 'satisfied' | 'waived' | 'failed';
export type ObligationOrigin = 'primary' | 'inbox' | 'delegation';

export interface SessionObligation {
  obligationId: string;
  type: ObligationType;
  description: string;
  requiredOutcome?: string;
  sourceAgent: AgentName;
  status: ObligationStatus;
  evidence: string[];
  fingerprint?: string;
  turnId?: string;
  origin?: ObligationOrigin;
  blocking?: boolean;
  createdAt: string;
  resolvedAt?: string;
  metadata?: Record<string, unknown>;
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
  parallelExecutions: ParallelExecution[];

  // Lightweight obligation ledger (coverage guard)
  obligations: SessionObligation[];

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

  // Delegation tracking
  lastDelegation?: {
    from: string;
    to: string;
    task: string;
    domain: string;
    objective: string;
    constraints: string[];
  };

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
  | 'delegate'
  | 'execute_tool'
  | 'escalate'
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

export interface ParallelExecution {
  executionId: string;
  agents: AgentName[];
  tasks: DelegationTask[];
  status: 'running' | 'completed' | 'partial_failure' | 'failed';
  results: DelegationResult[];
  startTime: string;
  endTime?: string;
}

// Streaming Events
export type AgentStreamEvent =
  // Existing agent events
  | { type: 'agent_start'; agent: AgentName; phase: AgentPhase }
  | { type: 'agent_thinking'; agent: AgentName; status: string }
  | { type: 'agent_switch'; from: AgentName; to: AgentName; reason: string }
  | {
      type: 'delegation';
      from: AgentName;
      to: AgentName;
      task: string;
      domain?: DelegationDomain;
      objective?: string;
      constraints?: string[];
      expectedOutcome?: string;
    }
  | { type: 'escalation'; from: AgentName; issue: EscalationIssue }
  | { type: 'tool_call'; agent: AgentName; toolName: string; args: Record<string, unknown> }
  | { type: 'tool_result'; agent: AgentName; toolName: string; result: unknown; success: boolean }
  | { type: 'user_question'; question: UserQuestion }
  | { type: 'approval_request'; request: ApprovalRequest; sessionId?: string }
  | { type: 'action_pending'; actionId: string; toolName: string; toolArgs: Record<string, unknown>; description: string; preview?: ActionPreview }
  | { type: 'agent_history'; entries: AgentHistoryEntry[] }
  | { type: 'parallel_start'; agents: AgentName[]; tasks: string[] }
  | { type: 'parallel_progress'; agent: AgentName; progress: string }
  | { type: 'parallel_complete'; results: DelegationResult[] }
  | { type: 'agent_complete'; agent: AgentName; result: unknown }
  | { type: 'error'; agent: AgentName; error: string }
  // SCOUT events
  | { type: 'scout_start'; query: string; scope: ScoutScope }
  | { type: 'scout_tool'; tool: string }
  | { type: 'scout_complete'; summary: ScoutResult }
  | { type: 'scout_error'; error: string }
  // Intermediate response events
  | { type: 'partial_response'; message: string; inReplyTo?: string }
  | { type: 'todo_updated'; todos: TodoItem[] }
  // Inbox events
  | { type: 'message_queued'; messageId: string; preview: string }
  | { type: 'inbox_processing'; count: number };

// Agent Response
export interface AgentResponse {
  agent: AgentName;
  content: string;
  toolCalls?: AgentToolCall[];
  delegation?: DelegationTask;
  escalation?: EscalationIssue;
  userQuestion?: UserQuestion;
  approvalRequest?: ApprovalRequest;
  finished: boolean;
}

// ============================================
// SCOUT AGENT TYPES
// ============================================

export type ScoutScope = 'codebase' | 'web' | 'both';

export type ScoutConfidence = 'high' | 'medium' | 'low';

export interface WebFinding {
  title: string;
  url: string;
  relevance: string;
  claim?: string;
  evidence?: Array<{
    url: string;
    snippet?: string;
    publishedAt?: string;
  }>;
  freshness?: string;
  confidence?: ScoutConfidence;
  gaps?: string[];
}

export interface ScoutResult {
  summary: string;
  relevantFiles: string[];
  codePatterns: Record<string, string>;
  webFindings: WebFinding[];
  recommendations: string[];
  confidence: ScoutConfidence;
}

// ============================================
// UNIFIED DELEGATION PROTOCOL (Ralph Verification)
// ============================================

export type LoopDelegationStatus = 'success' | 'partial' | 'failed' | 'escalated';

export interface ToolEvidence {
  tool: string;
  success: boolean;
  summary: string;
  pendingApproval?: boolean;
  externalId?: string;
  nextStep?: string;
}

export interface ScoutFindings {
  relevantFiles: string[];
  codePatterns: Record<string, string>;
  webFindings: WebFinding[];
  recommendations: string[];
  confidence: ScoutConfidence;
}

export interface LoopDelegationResult {
  status: LoopDelegationStatus;
  summary: string;
  toolEvidence: ToolEvidence[];
  escalation?: string;
  findings?: ScoutFindings;
}

// ============================================
// CHAPO LOOP TYPES
// ============================================

export interface ValidationResult {
  isComplete: boolean;
  confidence: number;
  issues: string[];
  suggestion?: string;
}

export interface ChapoLoopResult {
  answer: string;
  status: 'completed' | 'waiting_for_user' | 'error';
  totalIterations: number;
  question?: string; // if status === 'waiting_for_user'
}

// SCOUT-specific stream events (extend AgentStreamEvent)
export type ScoutStreamEvent =
  | { type: 'scout_start'; query: string; scope: ScoutScope }
  | { type: 'scout_tool'; tool: string }
  | { type: 'scout_complete'; summary: ScoutResult }
  | { type: 'scout_error'; error: string };
