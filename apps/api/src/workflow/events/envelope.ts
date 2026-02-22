/**
 * Workflow Event Envelope — canonical wrapper for all domain events.
 *
 * Every workflow-relevant signal travels inside this envelope.
 * Projections (state, stream, markdown, audit) consume it.
 */

import { nanoid } from 'nanoid';

export type EventSource = 'ws' | 'router' | 'chapo-loop' | 'projection' | 'system';
export type EventVisibility = 'internal' | 'ui' | 'log' | 'audit';

export interface WorkflowEventEnvelope<TPayload = unknown> {
  eventId: string;
  sessionId: string;
  requestId: string;
  turnId: string;
  timestamp: string;
  source: EventSource;
  eventType: string;
  causationId?: string;
  correlationId?: string;
  payload: TPayload;
  visibility: EventVisibility;
}

export interface EventContext {
  sessionId: string;
  requestId: string;
  turnId: string;
}

export function createEvent<T>(
  ctx: EventContext,
  eventType: string,
  payload: T,
  opts?: {
    source?: EventSource;
    visibility?: EventVisibility;
    causationId?: string;
    correlationId?: string;
  },
): WorkflowEventEnvelope<T> {
  return {
    eventId: nanoid(16),
    sessionId: ctx.sessionId,
    requestId: ctx.requestId,
    turnId: ctx.turnId,
    timestamp: new Date().toISOString(),
    source: opts?.source ?? 'router',
    eventType,
    causationId: opts?.causationId,
    correlationId: opts?.correlationId,
    payload,
    visibility: opts?.visibility ?? 'ui',
  };
}
