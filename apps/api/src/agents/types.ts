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
  | 'planning'              // Multi-perspective planning phase
  | 'waiting_plan_approval' // Waiting for user to approve plan
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

  // Plan Mode state
  currentPlan?: ExecutionPlan;
  planHistory: ExecutionPlan[];

  // Task Tracking state
  tasks: PlanTask[];
  taskOrder: string[]; // Ordered list of taskIds

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
  claudeMdBlock?: string;
  workspaceMdBlock?: string;
  workspaceMdMode?: string;
  workspaceMdDiagnostics?: unknown;
  globalContextBlock?: string;
  memoryBlock?: string;
  memoryQualityBlock?: string;

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
  // Plan Mode events
  | { type: 'plan_start'; sessionId: string }
  | { type: 'perspective_start'; agent: AgentName }
  | { type: 'perspective_complete'; agent: AgentName; perspective: AgentPerspective }
  | { type: 'plan_ready'; plan: ExecutionPlan }
  | { type: 'plan_approval_request'; plan: ExecutionPlan }
  | { type: 'plan_approved'; planId: string }
  | { type: 'plan_rejected'; planId: string; reason: string }
  // Task tracking events
  | { type: 'task_created'; task: PlanTask }
  | { type: 'task_update'; taskId: string; status: TaskStatus; progress?: number; activeForm?: string }
  | { type: 'task_started'; taskId: string; agent: AgentName }
  | { type: 'task_completed'; taskId: string; result?: string }
  | { type: 'task_failed'; taskId: string; error: string }
  | { type: 'tasks_list'; tasks: PlanTask[] }
  // SCOUT events
  | { type: 'scout_start'; query: string; scope: ScoutScope }
  | { type: 'scout_tool'; tool: string }
  | { type: 'scout_complete'; summary: ScoutResult }
  | { type: 'scout_error'; error: string }
  // Inbox events
  | { type: 'message_queued'; messageId: string; preview: string }
  | { type: 'inbox_processing'; count: number }
  | { type: 'inbox_classified'; messageId: string; classification: 'parallel' | 'amendment' | 'expansion'; summary: string };

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
// PLAN MODE TYPES
// ============================================

export type PlanStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'completed';

export type EffortEstimate = 'trivial' | 'small' | 'medium' | 'large';

// Base perspective interface
export interface AgentPerspective {
  agent: AgentName;
  analysis: string;
  concerns: string[];
  recommendations: string[];
  estimatedEffort: EffortEstimate;
  dependencies?: string[];
  timestamp: string;
}

// CHAPO's strategic perspective
export interface ChapoPerspective extends AgentPerspective {
  agent: 'chapo';
  strategicAnalysis: string;
  riskAssessment: RiskLevel;
  impactAreas: string[];
  coordinationNeeds: string[];
}

// DEVO's ops-focused perspective
export interface DevoPerspective extends AgentPerspective {
  agent: 'devo';
  deploymentImpact: string[];
  rollbackStrategy: string;
  servicesAffected: string[];
  infrastructureChanges: string[];
}

// Combined execution plan
export interface ExecutionPlan {
  planId: string;
  sessionId: string;
  status: PlanStatus;

  // Multi-perspective analysis
  chapoPerspective: ChapoPerspective;
  devoPerspective?: DevoPerspective;

  // Synthesized plan
  summary: string;
  tasks: PlanTask[];
  estimatedDuration: string;
  overallRisk: RiskLevel;

  // Approval tracking
  createdAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
}

// ============================================
// TASK TRACKING TYPES
// ============================================

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';

export interface PlanTask {
  taskId: string;
  planId: string;

  // Task definition
  subject: string;
  description: string;
  activeForm: string; // Present continuous for spinner (e.g., "Creating file...")

  // Assignment and ownership
  assignedAgent: AgentName;
  priority: TaskPriority;

  // Status tracking
  status: TaskStatus;
  progress?: number; // 0-100 percentage

  // Dependencies
  blockedBy: string[]; // taskIds that must complete first
  blocks: string[];    // taskIds that are waiting on this

  // Execution details
  toolsToExecute?: PlannedToolCall[];
  toolsExecuted?: ExecutedTool[];

  // Timestamps
  createdAt: string;
  startedAt?: string;
  completedAt?: string;

  // Results
  result?: string;
  error?: string;
}

export interface PlannedToolCall {
  toolName: string;
  toolArgs: Record<string, unknown>;
  description: string;
  requiresApproval: boolean;
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
