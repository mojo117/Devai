/**
 * Audit Projection — forwards selected domain events to the audit log.
 *
 * Only events with security/compliance relevance are audited.
 * Payloads are sanitized via the existing sanitize() function.
 */

import type { Projection } from '../events/bus.js';
import type { WorkflowEventEnvelope } from '../events/envelope.js';
import { auditLog } from '../../audit/logger.js';
import {
  WF_TURN_STARTED,
  WF_COMPLETED,
  WF_FAILED,
  GATE_QUESTION_QUEUED,
  GATE_APPROVAL_RESOLVED,
  TOOL_CALL_COMPLETED,
  TOOL_CALL_FAILED,
} from '../events/catalog.js';

/** Events that warrant an audit trail entry. */
const AUDITED_EVENTS = new Set<string>([
  WF_TURN_STARTED,
  WF_COMPLETED,
  WF_FAILED,
  GATE_QUESTION_QUEUED,
  GATE_APPROVAL_RESOLVED,
  TOOL_CALL_COMPLETED,
  TOOL_CALL_FAILED,
]);

export class AuditProjection implements Projection {
  name = 'audit';

  async handle(event: WorkflowEventEnvelope): Promise<void> {
    if (!AUDITED_EVENTS.has(event.eventType)) return;

    await auditLog({
      action: event.eventType,
      sessionId: event.sessionId,
      requestId: event.requestId,
      turnId: event.turnId,
      eventId: event.eventId,
      source: event.source,
      payload: event.payload as Record<string, unknown>,
      timestamp: event.timestamp,
    });
  }
}
