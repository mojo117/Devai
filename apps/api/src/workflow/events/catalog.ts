/**
 * Event Catalog — all domain event type constants and payload interfaces.
 *
 * Naming: {domain}.{entity}.{verb_past_tense}
 *   command.*    — ingress commands
 *   workflow.*   — domain lifecycle
 *   agent.*      — agent lifecycle
 *   tool.*       — tool execution
 *   gate.*       — ASK/approval gates
 *   system.*     — infrastructure
 */

// ── Command events ──────────────────────────────────────────────

export const CMD_USER_REQUEST_SUBMITTED = 'command.user.request_submitted' as const;
export const CMD_USER_QUESTION_ANSWERED = 'command.user.question_answered' as const;
export const CMD_USER_APPROVAL_DECIDED = 'command.user.approval_decided' as const;

// ── Workflow events ─────────────────────────────────────────────

export const WF_TURN_STARTED = 'workflow.turn.started' as const;
export const WF_CONTEXT_WARMED = 'workflow.context.warmed' as const;
export const WF_MODEL_SELECTED = 'workflow.model.selected' as const;
export const WF_COMPLETED = 'workflow.completed' as const;
export const WF_FAILED = 'workflow.failed' as const;

// ── Agent events ────────────────────────────────────────────────

export const AGENT_STARTED = 'agent.started' as const;
export const AGENT_THINKING = 'agent.thinking' as const;
export const AGENT_SWITCHED = 'agent.switched' as const;
export const AGENT_DELEGATED = 'agent.delegated' as const;
export const AGENT_COMPLETED = 'agent.completed' as const;
export const AGENT_FAILED = 'agent.failed' as const;
export const AGENT_HISTORY = 'agent.history' as const;

// ── Tool events ─────────────────────────────────────────────────

export const TOOL_CALL_STARTED = 'tool.call.started' as const;
export const TOOL_CALL_COMPLETED = 'tool.call.completed' as const;
export const TOOL_CALL_FAILED = 'tool.call.failed' as const;
export const TOOL_ACTION_PENDING = 'tool.action.pending' as const;

// ── Gate events ─────────────────────────────────────────────────

export const GATE_QUESTION_QUEUED = 'gate.question.queued' as const;
export const GATE_QUESTION_RESOLVED = 'gate.question.resolved' as const;
export const GATE_APPROVAL_QUEUED = 'gate.approval.queued' as const;
export const GATE_APPROVAL_RESOLVED = 'gate.approval.resolved' as const;

// ── System events ───────────────────────────────────────────────

export const SYSTEM_HEARTBEAT = 'system.heartbeat' as const;

// ── Payload interfaces ──────────────────────────────────────────

export interface AgentStartedPayload {
  agent: string;
  phase: string;
}

export interface AgentThinkingPayload {
  agent: string;
  status: string;
}

export interface AgentSwitchedPayload {
  from: string;
  to: string;
  reason: string;
}

export interface AgentDelegatedPayload {
  from: string;
  to: string;
  task: string;
  domain?: string;
  objective?: string;
  constraints?: string[];
  expectedOutcome?: string;
}

export interface AgentCompletedPayload {
  agent: string;
  result: unknown;
}

export interface AgentFailedPayload {
  agent: string;
  error: string;
  recoverable: boolean;
}

export interface AgentHistoryPayload {
  entries: unknown[];
}

export interface ToolCallStartedPayload {
  agent: string;
  toolName: string;
  args: Record<string, unknown>;
  toolId?: string;
}

export interface ToolCallCompletedPayload {
  agent: string;
  toolName: string;
  result: unknown;
  success: boolean;
  toolId?: string;
}

export interface ToolCallFailedPayload {
  agent: string;
  toolName: string;
  error: string;
  toolId?: string;
}

export interface ToolActionPendingPayload {
  actionId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  description: string;
  preview?: unknown;
}

export interface GateQuestionQueuedPayload {
  questionId: string;
  question: string;
  fromAgent: string;
  turnId?: string;
  questionKind?: string;
  fingerprint?: string;
  expiresAt?: string;
}

export interface GateQuestionResolvedPayload {
  questionId: string;
  answer: string;
}

export interface GateApprovalQueuedPayload {
  approvalId: string;
  description: string;
  riskLevel?: string;
}

export interface GateApprovalResolvedPayload {
  approvalId: string;
  approved: boolean;
}

export interface WorkflowTurnStartedPayload {
  userMessage: string;
  taskComplexity?: string;
  modelSelection?: Record<string, unknown>;
}

export interface WorkflowCompletedPayload {
  answer: string;
  totalIterations: number;
  status: string;
}

export interface WorkflowFailedPayload {
  error: string;
  agent?: string;
  recoverable: boolean;
}

/**
 * Maps legacy stream event type strings to domain event types.
 * Used during incremental migration (Phase 5).
 */
export const LEGACY_TYPE_MAP: Record<string, string> = {
  agent_start: AGENT_STARTED,
  agent_thinking: AGENT_THINKING,
  agent_switch: AGENT_SWITCHED,
  delegation: AGENT_DELEGATED,
  agent_complete: AGENT_COMPLETED,
  agent_history: AGENT_HISTORY,
  error: AGENT_FAILED,
  tool_call: TOOL_CALL_STARTED,
  tool_result: TOOL_CALL_COMPLETED,
  action_pending: TOOL_ACTION_PENDING,
  user_question: GATE_QUESTION_QUEUED,
  approval_request: GATE_APPROVAL_QUEUED,
};
