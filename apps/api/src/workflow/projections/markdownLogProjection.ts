/**
 * Markdown Log Projection — writes session traces to var/logs/*.md.
 *
 * Normalizes domain events into human-readable markdown sections.
 * Noisy events (agent.thinking, system.heartbeat) are skipped.
 */

import type { Projection } from '../events/bus.js';
import type { WorkflowEventEnvelope } from '../events/envelope.js';
import { SessionLogger } from '../../audit/sessionLogger.js';
import {
  AGENT_STARTED,
  AGENT_SWITCHED,
  AGENT_DELEGATED,
  AGENT_COMPLETED,
  AGENT_FAILED,
  TOOL_CALL_STARTED,
  TOOL_CALL_COMPLETED,
  TOOL_CALL_FAILED,
  TOOL_ACTION_PENDING,
  GATE_QUESTION_QUEUED,
  GATE_APPROVAL_QUEUED,
  PLAN_READY,
  TASK_UPDATED,
  WF_COMPLETED,
  WF_FAILED,
} from '../events/catalog.js';

/** Events that are too noisy for markdown logs. */
const SKIP_EVENTS = new Set([
  'agent.thinking',
  'agent.history',
  'system.heartbeat',
]);

function normalizeUserQuestionPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const nested = payload.question;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }

  const normalized: Record<string, unknown> = {};
  if (typeof payload.questionId === 'string') normalized.questionId = payload.questionId;
  if (typeof payload.question === 'string') normalized.question = payload.question;
  if (typeof payload.fromAgent === 'string') normalized.fromAgent = payload.fromAgent;
  if (typeof payload.timestamp === 'string') normalized.timestamp = payload.timestamp;
  return normalized;
}

export class MarkdownLogProjection implements Projection {
  name = 'markdown';

  handle(event: WorkflowEventEnvelope): void {
    if (event.visibility === 'internal') return;
    if (SKIP_EVENTS.has(event.eventType)) return;

    const logger = SessionLogger.getActive(event.sessionId);
    if (!logger) return;

    const p = event.payload as Record<string, unknown>;

    switch (event.eventType) {
      case AGENT_STARTED:
        logger.logAgentEvent({ type: 'agent_start', agent: p.agent, phase: p.phase });
        break;

      case AGENT_SWITCHED:
        logger.logAgentEvent({ type: 'agent_switch', from: p.from, to: p.to, reason: p.reason });
        break;

      case AGENT_DELEGATED:
        logger.logAgentEvent({
          type: 'delegation',
          from: p.from,
          to: p.to,
          task: p.task,
          ...(typeof p.domain === 'string' ? { domain: p.domain } : {}),
          ...(typeof p.objective === 'string' ? { objective: p.objective } : {}),
          ...(Array.isArray(p.constraints) ? { constraints: p.constraints } : {}),
          ...(typeof p.expectedOutcome === 'string' ? { expectedOutcome: p.expectedOutcome } : {}),
        });
        break;

      case AGENT_COMPLETED:
        logger.logAgentEvent({ type: 'agent_complete', agent: p.agent });
        break;

      case TOOL_CALL_STARTED:
        logger.logAgentEvent({ type: 'tool_call', agent: p.agent, toolName: p.toolName, args: p.args });
        break;

      case TOOL_CALL_COMPLETED:
        logger.logAgentEvent({ type: 'tool_result', agent: p.agent, toolName: p.toolName, result: p.result, success: true });
        break;

      case TOOL_CALL_FAILED:
        logger.logAgentEvent({ type: 'tool_result', agent: p.agent, toolName: p.toolName, result: p.error, success: false });
        break;

      case TOOL_ACTION_PENDING:
        logger.logAgentEvent({ type: 'action_pending', toolName: p.toolName, description: p.description });
        break;

      case GATE_QUESTION_QUEUED:
        logger.logAgentEvent({ type: 'user_question', question: normalizeUserQuestionPayload(p) });
        break;

      case GATE_APPROVAL_QUEUED:
        logger.logAgentEvent({ type: 'approval_request', request: p });
        break;

      case PLAN_READY:
        logger.logAgentEvent({ type: 'plan_ready', plan: p.plan });
        break;

      case TASK_UPDATED:
        logger.logAgentEvent({ type: 'task_update', taskId: p.taskId, status: p.status });
        break;

      case AGENT_FAILED:
        logger.logAgentEvent({ type: 'error', agent: p.agent, error: p.error });
        break;

      case WF_COMPLETED:
        logger.logAssistant(String(p.answer));
        logger.finalize('completed');
        break;

      case WF_FAILED:
        logger.logAgentEvent({ type: 'error', error: p.error });
        logger.finalize('error');
        break;
    }
  }
}
