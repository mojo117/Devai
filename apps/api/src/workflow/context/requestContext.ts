/**
 * Request Context — per-command correlation context.
 *
 * Created once per incoming WS command. Threaded through
 * the workflow engine and attached to every domain event.
 */

import { nanoid } from 'nanoid';

export interface RequestContext {
  sessionId: string;
  requestId: string;
  turnId: string;
}

/**
 * Create a new request context. One per incoming WS command.
 */
export function createRequestContext(
  sessionId: string,
  requestId?: string,
): RequestContext {
  return {
    sessionId,
    requestId: requestId ?? nanoid(),
    turnId: nanoid(12),
  };
}
