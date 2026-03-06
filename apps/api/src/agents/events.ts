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
  UserQuestion,
  ApprovalRequest,
  AgentHistoryEntry,
} from './types.js';

// ============================================
// BASE EVENT
// ============================================

export type EventCategory =
  | 'agent'
  | 'tool'
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
    createdAt: Date.now(),
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
    createdAt: Date.now(),
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
    createdAt: Date.now(),
    completedAt: Date.now(),
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
};

// ============================================
// TODO EVENTS
// ============================================

export const TodoEvents = {
  /** Todo list updated */
  updated: (sessionId: string, todos: Array<{ content: string; status: string }>) => ({
    ...createBaseEvent('system', sessionId),
    type: 'todo_updated' as const,
    todos,
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
  | ReturnType<(typeof UserEvents)[keyof typeof UserEvents]>
  | ReturnType<(typeof InboxEvents)[keyof typeof InboxEvents]>
  | ReturnType<(typeof TodoEvents)[keyof typeof TodoEvents]>
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
