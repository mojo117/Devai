/**
 * State Projection — applies domain events to stateManager.
 *
 * Single writer for workflow state transitions. No direct WS emission.
 * Flushes critical gate events immediately (question/approval queued/resolved).
 */

import type { Projection } from '../events/bus.js';
import type { WorkflowEventEnvelope } from '../events/envelope.js';
import * as stateManager from '../../agents/stateManager.js';
import type { AgentPhase, AgentName, UserQuestion, ApprovalRequest } from '../../agents/types.js';
import {
  AGENT_STARTED,
  AGENT_SWITCHED,
  AGENT_DELEGATED,
  GATE_QUESTION_QUEUED,
  GATE_APPROVAL_QUEUED,
  WF_TURN_STARTED,
  WF_FAILED,
} from '../events/catalog.js';

export class StateProjection implements Projection {
  name = 'state';

  async handle(event: WorkflowEventEnvelope): Promise<void> {
    const { sessionId, eventType } = event;
    const p = event.payload as Record<string, unknown>;

    switch (eventType) {
      case AGENT_STARTED:
        stateManager.setPhase(sessionId, p.phase as AgentPhase);
        stateManager.setActiveAgent(sessionId, p.agent as AgentName);
        break;

      case AGENT_SWITCHED:
        stateManager.setActiveAgent(sessionId, p.to as AgentName);
        break;

      case AGENT_DELEGATED:
        stateManager.setGatheredInfo(sessionId, 'lastDelegation', {
          from: p.from,
          to: p.to,
          task: p.task,
          domain: p.domain,
          objective: p.objective,
          constraints: p.constraints,
          expectedOutcome: p.expectedOutcome,
        });
        break;

      case GATE_QUESTION_QUEUED:
        stateManager.addPendingQuestion(
          sessionId,
          ((p.question && typeof p.question === 'object') ? p.question : p) as unknown as UserQuestion,
        );
        stateManager.setPhase(sessionId, 'waiting_user');
        await stateManager.flushState(sessionId);
        break;

      case GATE_APPROVAL_QUEUED:
        stateManager.addPendingApproval(
          sessionId,
          ((p.request && typeof p.request === 'object') ? p.request : p) as unknown as ApprovalRequest,
        );
        stateManager.setPhase(sessionId, 'waiting_user');
        await stateManager.flushState(sessionId);
        break;

      // NOTE: Gate RESOLUTION events (question.resolved, approval.resolved) are NOT handled here
      // during the transition period. The router handlers (handleUserResponse, handleUserApproval)
      // manage state directly via read-and-remove patterns.
      // These events are emitted by the dispatcher for audit/stream projection consumption only.

      case WF_TURN_STARTED:
        stateManager.setOriginalRequest(sessionId, p.userMessage as string);
        break;

      case WF_FAILED:
        stateManager.setPhase(sessionId, 'error');
        break;
    }
  }
}
