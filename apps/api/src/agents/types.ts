/**
 * Multi-Agent System Types
 *
 * Three agents: CHAPO (Coordinator), KODA (Developer), DEVO (DevOps)
 */

export type AgentName = 'chapo' | 'koda' | 'devo';

export type AgentRole = 'Task Coordinator' | 'Senior Developer' | 'DevOps Engineer';

export type TaskType = 'code_change' | 'devops' | 'mixed' | 'unclear';

export type RiskLevel = 'low' | 'medium' | 'high';

export type TaskComplexity = 'simple' | 'moderate' | 'complex';

export type AgentPhase = 'qualification' | 'execution' | 'review' | 'error' | 'waiting_user';

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
  canDelegateToKoda?: boolean;
  canDelegateToDevo?: boolean;
  canAskUser?: boolean;
  canRequestApproval?: boolean;
  canEscalate?: boolean;
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
}

export interface TaskContext {
  originalRequest: string;
  qualificationResult?: QualificationResult;
  gatheredFiles: string[];
  gatheredInfo: Record<string, unknown>;
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
  | { type: 'agent_start'; agent: AgentName; phase: AgentPhase }
  | { type: 'agent_thinking'; agent: AgentName; status: string }
  | { type: 'agent_switch'; from: AgentName; to: AgentName; reason: string }
  | { type: 'delegation'; from: AgentName; to: AgentName; task: string }
  | { type: 'escalation'; from: AgentName; issue: EscalationIssue }
  | { type: 'tool_call'; agent: AgentName; toolName: string; args: Record<string, unknown> }
  | { type: 'tool_result'; agent: AgentName; toolName: string; result: unknown; success: boolean }
  | { type: 'user_question'; question: UserQuestion }
  | { type: 'approval_request'; request: ApprovalRequest }
  | { type: 'agent_history'; entries: AgentHistoryEntry[] }
  | { type: 'parallel_start'; agents: AgentName[]; tasks: string[] }
  | { type: 'parallel_progress'; agent: AgentName; progress: string }
  | { type: 'parallel_complete'; results: DelegationResult[] }
  | { type: 'agent_complete'; agent: AgentName; result: unknown }
  | { type: 'error'; agent: AgentName; error: string };

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
