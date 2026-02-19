/**
 * Event Catalog — all domain event type constants and payload interfaces.
 *
 * Naming: {domain}.{entity}.{verb_past_tense}
 *   command.*    — ingress commands
 *   workflow.*   — domain lifecycle
 *   agent.*      — agent lifecycle
 *   tool.*       — tool execution
 *   gate.*       — ASK/approval/plan gates
 *   plan.*       — plan mode
 *   task.*       — plan tasks
 *   system.*     — infrastructure
 */

// ── Command events ──────────────────────────────────────────────

export const CMD_USER_REQUEST_SUBMITTED = 'command.user.request_submitted' as const;
export const CMD_USER_QUESTION_ANSWERED = 'command.user.question_answered' as const;
export const CMD_USER_APPROVAL_DECIDED = 'command.user.approval_decided' as const;
export const CMD_USER_PLAN_APPROVAL_DECIDED = 'command.user.plan_approval_decided' as const;

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
export const GATE_PLAN_APPROVAL_QUEUED = 'gate.plan_approval.queued' as const;
export const GATE_PLAN_APPROVAL_RESOLVED = 'gate.plan_approval.resolved' as const;

// ── Plan events ─────────────────────────────────────────────────

export const PLAN_STARTED = 'plan.started' as const;
export const PLAN_READY = 'plan.ready' as const;
export const PLAN_APPROVAL_REQUESTED = 'plan.approval_requested' as const;
export const PLAN_APPROVED = 'plan.approved' as const;
export const PLAN_REJECTED = 'plan.rejected' as const;

// ── Task events ─────────────────────────────────────────────────

export const TASK_CREATED = 'task.created' as const;
export const TASK_UPDATED = 'task.updated' as const;
export const TASK_COMPLETED = 'task.completed' as const;
export const TASK_FAILED = 'task.failed' as const;

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

export interface GatePlanApprovalResolvedPayload {
  planId: string;
  approved: boolean;
  reason?: string;
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

export interface PlanStartedPayload {
  sessionId: string;
}

export interface PlanReadyPayload {
  plan: unknown;
}

export interface TaskCreatedPayload {
  task: unknown;
}

export interface TaskUpdatedPayload {
  taskId: string;
  status: string;
  progress?: number;
  activeForm?: string;
}

export interface TaskCompletedPayload {
  taskId: string;
  result: unknown;
}

export interface TaskFailedPayload {
  taskId: string;
  error: string;
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
  plan_start: PLAN_STARTED,
  plan_ready: PLAN_READY,
  plan_approval_request: PLAN_APPROVAL_REQUESTED,
  plan_approved: PLAN_APPROVED,
  plan_rejected: PLAN_REJECTED,
  task_created: TASK_CREATED,
  task_update: TASK_UPDATED,
  task_started: TASK_UPDATED,
  task_completed: TASK_COMPLETED,
  task_failed: TASK_FAILED,
};
