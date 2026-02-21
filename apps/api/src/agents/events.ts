/**
 * Unified Event System
 *
 * Provides typed factory functions for creating stream events
 * with consistent structure (id, timestamp, category, sessionId).
 */

import { nanoid } from 'nanoid';
import type {
  AgentName,
  AgentPhase,
  DelegationDomain,
  TaskStatus,
  PlanTask,
  ExecutionPlan,
  ScoutResult,
  ScoutScope,
  EscalationIssue,
  UserQuestion,
  ApprovalRequest,
  AgentPerspective,
  DelegationResult,
  AgentHistoryEntry,
} from './types.js';

// ============================================
// BASE EVENT
// ============================================

export type EventCategory =
  | 'agent'
  | 'tool'
  | 'plan'
  | 'task'
  | 'scout'
  | 'user'
  | 'inbox'
  | 'system';

export interface BaseStreamEvent {
  id: string;
  timestamp: string;
  category: EventCategory;
  sessionId?: string;
}

function createBaseEvent(category: EventCategory, sessionId?: string): BaseStreamEvent {
  return {
    id: nanoid(12),
    timestamp: new Date().toISOString(),
    category,
    sessionId,
  };
}

// ============================================
// AGENT EVENTS
// ============================================

export const AgentEvents = {
  /** Agent started processing */
  start: (sessionId: string, agent: AgentName, phase: AgentPhase) => ({
    ...createBaseEvent('agent', sessionId),
    type: 'agent_start' as const,
    agent,
    phase,
  }),

  /** Agent phase changed */
  phaseChange: (sessionId: string, phase: AgentPhase, agent?: AgentName) => ({
    ...createBaseEvent('agent', sessionId),
    type: 'agent_phase_change' as const,
    phase,
    agent,
  }),

  /** Agent is thinking/processing */
  thinking: (sessionId: string, agent: AgentName, status: string) => ({
    ...createBaseEvent('agent', sessionId),
    type: 'agent_thinking' as const,
    agent,
    status,
  }),

  /** Agent switching to another agent */
  switch: (sessionId: string, from: AgentName, to: AgentName, reason: string) => ({
    ...createBaseEvent('agent', sessionId),
    type: 'agent_switch' as const,
    from,
    to,
    reason,
  }),

  /** Agent delegating task to another agent */
  delegation: (
    sessionId: string,
    from: AgentName,
    to: AgentName,
    task: string,
    details?: {
      domain?: DelegationDomain;
      objective?: string;
      constraints?: string[];
      expectedOutcome?: string;
    },
  ) => ({
    ...createBaseEvent('agent', sessionId),
    type: 'delegation' as const,
    from,
    to,
    task,
    ...details,
  }),

  /** Agent escalating an issue */
  escalation: (sessionId: string, from: AgentName, issue: EscalationIssue) => ({
    ...createBaseEvent('agent', sessionId),
    type: 'escalation' as const,
    from,
    issue,
  }),

  /** Agent response (streaming or final) */
  response: (sessionId: string, agent: AgentName, content: string, isPartial = false) => ({
    ...createBaseEvent('agent', sessionId),
    type: 'agent_response' as const,
    agent,
    content,
    isPartial,
  }),

  /** Agent completed its work */
  complete: (sessionId: string, agent: AgentName, result: unknown) => ({
    ...createBaseEvent('agent', sessionId),
    type: 'agent_complete' as const,
    agent,
    result,
  }),

  /** Agent history snapshot */
  history: (sessionId: string, entries: AgentHistoryEntry[]) => ({
    ...createBaseEvent('agent', sessionId),
    type: 'agent_history' as const,
    entries,
  }),

  /** Agent error occurred */
  error: (sessionId: string, agent: AgentName, error: string, recoverable = false) => ({
    ...createBaseEvent('agent', sessionId),
    type: 'error' as const,
    agent,
    error,
    recoverable,
  }),
};

// ============================================
// TOOL EVENTS
// ============================================

export const ToolEvents = {
  /** Tool call started */
  call: (
    sessionId: string,
    agent: AgentName,
    toolName: string,
    args: Record<string, unknown>,
    toolId?: string
  ) => ({
    ...createBaseEvent('tool', sessionId),
    type: 'tool_call' as const,
    agent,
    toolName,
    args,
    toolId: toolId ?? nanoid(8),
  }),

  /** Tool call completed */
  result: (
    sessionId: string,
    agent: AgentName,
    toolName: string,
    result: unknown,
    success: boolean,
    toolId?: string
  ) => ({
    ...createBaseEvent('tool', sessionId),
    type: 'tool_result' as const,
    agent,
    toolName,
    result,
    success,
    toolId,
  }),

  /** Tool requires user approval */
  approvalRequired: (
    sessionId: string,
    toolName: string,
    args: Record<string, unknown>,
    toolId: string
  ) => ({
    ...createBaseEvent('tool', sessionId),
    type: 'tool_approval_required' as const,
    toolName,
    args,
    toolId,
  }),

  /** Tool approved by user */
  approved: (sessionId: string, toolId: string) => ({
    ...createBaseEvent('tool', sessionId),
    type: 'tool_approved' as const,
    toolId,
  }),

  /** Tool rejected by user */
  rejected: (sessionId: string, toolId: string, reason?: string) => ({
    ...createBaseEvent('tool', sessionId),
    type: 'tool_rejected' as const,
    toolId,
    reason,
  }),
};

// ============================================
// PLAN EVENTS
// ============================================

export const PlanEvents = {
  /** Plan mode started */
  start: (sessionId: string) => ({
    ...createBaseEvent('plan', sessionId),
    type: 'plan_start' as const,
    sessionId,
  }),

  /** Agent perspective analysis started */
  perspectiveStart: (sessionId: string, agent: AgentName) => ({
    ...createBaseEvent('plan', sessionId),
    type: 'perspective_start' as const,
    agent,
  }),

  /** Agent perspective analysis completed */
  perspectiveComplete: (sessionId: string, agent: AgentName, perspective: AgentPerspective) => ({
    ...createBaseEvent('plan', sessionId),
    type: 'perspective_complete' as const,
    agent,
    perspective,
  }),

  /** Plan is ready for review */
  ready: (sessionId: string, plan: ExecutionPlan) => ({
    ...createBaseEvent('plan', sessionId),
    type: 'plan_ready' as const,
    plan,
  }),

  /** Plan requires user approval */
  approvalRequest: (sessionId: string, plan: ExecutionPlan) => ({
    ...createBaseEvent('plan', sessionId),
    type: 'plan_approval_request' as const,
    plan,
  }),

  /** Plan approved by user */
  approved: (sessionId: string, planId: string) => ({
    ...createBaseEvent('plan', sessionId),
    type: 'plan_approved' as const,
    planId,
  }),

  /** Plan rejected by user */
  rejected: (sessionId: string, planId: string, reason?: string) => ({
    ...createBaseEvent('plan', sessionId),
    type: 'plan_rejected' as const,
    planId,
    reason,
  }),

  /** Plan execution completed */
  complete: (sessionId: string, planId: string, summary: string) => ({
    ...createBaseEvent('plan', sessionId),
    type: 'plan_complete' as const,
    planId,
    summary,
  }),
};

// ============================================
// TASK EVENTS
// ============================================

export const TaskEvents = {
  /** Task created */
  created: (sessionId: string, task: PlanTask) => ({
    ...createBaseEvent('task', sessionId),
    type: 'task_created' as const,
    task,
  }),

  /** Task status updated */
  update: (
    sessionId: string,
    taskId: string,
    status: TaskStatus,
    options?: { progress?: number; activeForm?: string }
  ) => ({
    ...createBaseEvent('task', sessionId),
    type: 'task_update' as const,
    taskId,
    status,
    ...options,
  }),

  /** Task execution started */
  started: (sessionId: string, taskId: string, agent: AgentName) => ({
    ...createBaseEvent('task', sessionId),
    type: 'task_started' as const,
    taskId,
    agent,
  }),

  /** Task completed successfully */
  completed: (sessionId: string, taskId: string, result?: string) => ({
    ...createBaseEvent('task', sessionId),
    type: 'task_completed' as const,
    taskId,
    result,
  }),

  /** Task failed */
  failed: (sessionId: string, taskId: string, error: string) => ({
    ...createBaseEvent('task', sessionId),
    type: 'task_failed' as const,
    taskId,
    error,
  }),

  /** Full task list */
  list: (sessionId: string, tasks: PlanTask[]) => ({
    ...createBaseEvent('task', sessionId),
    type: 'tasks_list' as const,
    tasks,
  }),
};

// ============================================
// SCOUT EVENTS
// ============================================

export const ScoutEvents = {
  /** SCOUT agent started exploration */
  start: (sessionId: string, query: string, scope: ScoutScope) => ({
    ...createBaseEvent('scout', sessionId),
    type: 'scout_start' as const,
    query,
    scope,
  }),

  /** SCOUT using a tool */
  tool: (sessionId: string, tool: string) => ({
    ...createBaseEvent('scout', sessionId),
    type: 'scout_tool' as const,
    tool,
  }),

  /** SCOUT completed exploration */
  complete: (sessionId: string, summary: ScoutResult) => ({
    ...createBaseEvent('scout', sessionId),
    type: 'scout_complete' as const,
    summary,
  }),

  /** SCOUT encountered an error */
  error: (sessionId: string, error: string) => ({
    ...createBaseEvent('scout', sessionId),
    type: 'scout_error' as const,
    error,
  }),
};

// ============================================
// USER EVENTS
// ============================================

export const UserEvents = {
  /** Question for user */
  question: (sessionId: string, question: UserQuestion) => ({
    ...createBaseEvent('user', sessionId),
    type: 'user_question' as const,
    question,
  }),

  /** User input required */
  inputRequired: (sessionId: string, prompt: string, options?: string[]) => ({
    ...createBaseEvent('user', sessionId),
    type: 'user_input_required' as const,
    prompt,
    options,
  }),

  /** User input received */
  inputReceived: (sessionId: string, input: string) => ({
    ...createBaseEvent('user', sessionId),
    type: 'user_input_received' as const,
    input,
  }),

  /** Approval request for user */
  approvalRequest: (sessionId: string, request: ApprovalRequest) => ({
    ...createBaseEvent('user', sessionId),
    type: 'approval_request' as const,
    request,
  }),
};

// ============================================
// PARALLEL EXECUTION EVENTS
// ============================================

export const ParallelEvents = {
  /** Parallel execution started */
  start: (sessionId: string, agents: AgentName[], tasks: string[]) => ({
    ...createBaseEvent('agent', sessionId),
    type: 'parallel_start' as const,
    agents,
    tasks,
  }),

  /** Progress update from one agent */
  progress: (sessionId: string, agent: AgentName, progress: string) => ({
    ...createBaseEvent('agent', sessionId),
    type: 'parallel_progress' as const,
    agent,
    progress,
  }),

  /** Parallel execution completed */
  complete: (sessionId: string, results: DelegationResult[]) => ({
    ...createBaseEvent('agent', sessionId),
    type: 'parallel_complete' as const,
    results,
  }),
};

// ============================================
// INBOX EVENTS
// ============================================

export const InboxEvents = {
  /** User message queued while loop is running */
  messageQueued: (sessionId: string, messageId: string, preview: string) => ({
    ...createBaseEvent('inbox', sessionId),
    type: 'message_queued' as const,
    messageId,
    preview,
  }),

  /** Inbox messages being processed by CHAPO */
  processing: (sessionId: string, count: number) => ({
    ...createBaseEvent('inbox', sessionId),
    type: 'inbox_processing' as const,
    count,
  }),

  /** CHAPO classified an inbox message */
  classified: (sessionId: string, messageId: string, classification: 'parallel' | 'amendment' | 'expansion', summary: string) => ({
    ...createBaseEvent('inbox', sessionId),
    type: 'inbox_classified' as const,
    messageId,
    classification,
    summary,
  }),
};

// ============================================
// SYSTEM EVENTS
// ============================================

export const SystemEvents = {
  /** Session started */
  sessionStart: (sessionId: string) => ({
    ...createBaseEvent('system', sessionId),
    type: 'session_start' as const,
  }),

  /** Session ended */
  sessionEnd: (sessionId: string, reason: 'completed' | 'error' | 'timeout') => ({
    ...createBaseEvent('system', sessionId),
    type: 'session_end' as const,
    reason,
  }),

  /** Heartbeat for long-running operations */
  heartbeat: (sessionId: string) => ({
    ...createBaseEvent('system', sessionId),
    type: 'heartbeat' as const,
  }),

  /** System error */
  error: (sessionId: string, error: string, code?: string) => ({
    ...createBaseEvent('system', sessionId),
    type: 'system_error' as const,
    error,
    code,
  }),
};

// ============================================
// UNIFIED TYPE
// ============================================

export type StreamEvent =
  | ReturnType<(typeof AgentEvents)[keyof typeof AgentEvents]>
  | ReturnType<(typeof ToolEvents)[keyof typeof ToolEvents]>
  | ReturnType<(typeof PlanEvents)[keyof typeof PlanEvents]>
  | ReturnType<(typeof TaskEvents)[keyof typeof TaskEvents]>
  | ReturnType<(typeof ScoutEvents)[keyof typeof ScoutEvents]>
  | ReturnType<(typeof UserEvents)[keyof typeof UserEvents]>
  | ReturnType<(typeof ParallelEvents)[keyof typeof ParallelEvents]>
  | ReturnType<(typeof InboxEvents)[keyof typeof InboxEvents]>
  | ReturnType<(typeof SystemEvents)[keyof typeof SystemEvents]>;

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Send an event through a stream writer
 */
export function sendEvent(
  writer: { write: (s: string) => void | Promise<void> },
  event: StreamEvent
): void {
  writer.write(JSON.stringify(event) + '\n');
}

/**
 * Create a send function bound to a specific session
 */
export function createEventSender(
  sessionId: string,
  writer: { write: (s: string) => void | Promise<void> }
) {
  return (event: StreamEvent) => {
    // Ensure sessionId is set
    const eventWithSession = { ...event, sessionId };
    writer.write(JSON.stringify(eventWithSession) + '\n');
  };
}

/**
 * Type guard to check if an object is a StreamEvent
 */
export function isStreamEvent(obj: unknown): obj is StreamEvent {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'type' in obj &&
    'id' in obj &&
    'timestamp' in obj &&
    'category' in obj
  );
}
