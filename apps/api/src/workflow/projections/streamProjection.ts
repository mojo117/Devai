/**
 * Stream Projection — maps domain events to WS stream events.
 *
 * Preserves the existing frontend event contract. The browser never sees
 * domain events directly — only the stable WS stream format via chatGateway.
 */

import type { Projection } from '../events/bus.js';
import type { WorkflowEventEnvelope } from '../events/envelope.js';
import { emitChatEvent } from '../../websocket/chatGateway.js';
import {
  AGENT_STARTED,
  AGENT_THINKING,
  AGENT_SWITCHED,
  AGENT_DELEGATED,
  AGENT_COMPLETED,
  AGENT_FAILED,
  AGENT_HISTORY,
  TOOL_CALL_STARTED,
  TOOL_CALL_COMPLETED,
  TOOL_CALL_FAILED,
  TOOL_ACTION_PENDING,
  GATE_QUESTION_QUEUED,
  GATE_APPROVAL_QUEUED,
  PLAN_STARTED,
  PLAN_READY,
  PLAN_APPROVAL_REQUESTED,
  PLAN_APPROVED,
  PLAN_REJECTED,
  TASK_CREATED,
  TASK_UPDATED,
  TASK_COMPLETED,
  TASK_FAILED,
  WF_COMPLETED,
  WF_FAILED,
} from '../events/catalog.js';

type PayloadMap = Record<string, unknown>;
type StreamMapper = (p: PayloadMap) => Record<string, unknown> | null;

/** Maps domain event types to WS stream event constructors. */
const EVENT_TO_STREAM: Record<string, StreamMapper> = {
  [AGENT_STARTED]: (p) => ({ type: 'agent_start', agent: p.agent, phase: p.phase }),
  [AGENT_THINKING]: (p) => ({ type: 'agent_thinking', agent: p.agent, status: p.status }),
  [AGENT_SWITCHED]: (p) => ({ type: 'agent_switch', from: p.from, to: p.to, reason: p.reason }),
  [AGENT_DELEGATED]: (p) => ({ type: 'delegation', from: p.from, to: p.to, task: p.task }),
  [AGENT_COMPLETED]: (p) => ({ type: 'agent_complete', agent: p.agent, result: p.result }),
  [AGENT_FAILED]: (p) => ({ type: 'error', agent: p.agent, error: p.error }),
  [AGENT_HISTORY]: (p) => ({ type: 'agent_history', entries: p.entries }),
  [TOOL_CALL_STARTED]: (p) => ({ type: 'tool_call', agent: p.agent, toolName: p.toolName, args: p.args }),
  [TOOL_CALL_COMPLETED]: (p) => ({ type: 'tool_result', agent: p.agent, toolName: p.toolName, result: p.result, success: p.success }),
  [TOOL_CALL_FAILED]: (p) => ({ type: 'tool_result', agent: p.agent, toolName: p.toolName, result: p.error, success: false }),
  [TOOL_ACTION_PENDING]: (p) => ({ type: 'action_pending', actionId: p.actionId, toolName: p.toolName, toolArgs: p.toolArgs, description: p.description, preview: p.preview }),
  [GATE_QUESTION_QUEUED]: (p) => ({ type: 'user_question', question: p }),
  [GATE_APPROVAL_QUEUED]: (p) => ({ type: 'approval_request', request: p, sessionId: p.sessionId }),
  [PLAN_STARTED]: (p) => ({ type: 'plan_start', sessionId: p.sessionId }),
  [PLAN_READY]: (p) => ({ type: 'plan_ready', plan: p.plan }),
  [PLAN_APPROVAL_REQUESTED]: (p) => ({ type: 'plan_approval_request', plan: p.plan }),
  [PLAN_APPROVED]: (p) => ({ type: 'plan_approved', planId: p.planId }),
  [PLAN_REJECTED]: (p) => ({ type: 'plan_rejected', planId: p.planId, reason: p.reason }),
  [TASK_CREATED]: (p) => ({ type: 'task_created', task: p.task }),
  [TASK_UPDATED]: (p) => ({ type: 'task_update', taskId: p.taskId, status: p.status, progress: p.progress, activeForm: p.activeForm }),
  [TASK_COMPLETED]: (p) => ({ type: 'task_completed', taskId: p.taskId, result: p.result }),
  [TASK_FAILED]: (p) => ({ type: 'task_failed', taskId: p.taskId, error: p.error }),
};

export class StreamProjection implements Projection {
  name = 'stream';

  handle(event: WorkflowEventEnvelope): void {
    if (event.visibility === 'internal') return;

    // Terminal events (workflow.completed / workflow.failed) emit the
    // final `response` event — handled separately by the command dispatcher
    // to compose the full response payload with message + pendingActions.
    if (event.eventType === WF_COMPLETED || event.eventType === WF_FAILED) return;

    const mapper = EVENT_TO_STREAM[event.eventType];
    if (!mapper) return;

    const streamEvent = mapper(event.payload as PayloadMap);
    if (!streamEvent) return;

    emitChatEvent(event.sessionId, {
      ...streamEvent,
      requestId: event.requestId,
    });
  }
}
