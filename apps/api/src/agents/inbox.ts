/**
 * SessionInbox — Per-session message queue + event bus
 *
 * Messages arriving while a ChapoLoop is running are pushed here.
 * The loop drains the inbox between iterations.
 * The event bus provides reactive notification via onInboxMessage/offInboxMessage.
 */

import type { InboxMessage } from './types.js';

type InboxHandler = (msg: InboxMessage) => void;

// Per-session message queues
const inboxes = new Map<string, InboxMessage[]>();

// Per-session event handlers
const handlers = new Map<string, Set<InboxHandler>>();

export function pushToInbox(sessionId: string, message: InboxMessage): void {
  let queue = inboxes.get(sessionId);
  if (!queue) {
    queue = [];
    inboxes.set(sessionId, queue);
  }
  queue.push(message);

  const sessionHandlers = handlers.get(sessionId);
  if (sessionHandlers) {
    for (const handler of sessionHandlers) {
      handler(message);
    }
  }
}

export function drainInbox(sessionId: string): InboxMessage[] {
  const queue = inboxes.get(sessionId);
  if (!queue || queue.length === 0) return [];
  const messages = [...queue];
  queue.length = 0;
  return messages;
}

export function peekInbox(sessionId: string): InboxMessage[] {
  return [...(inboxes.get(sessionId) || [])];
}

export function clearInbox(sessionId: string): void {
  inboxes.delete(sessionId);
  handlers.delete(sessionId);
}

export function onInboxMessage(sessionId: string, handler: InboxHandler): void {
  let sessionHandlers = handlers.get(sessionId);
  if (!sessionHandlers) {
    sessionHandlers = new Set();
    handlers.set(sessionId, sessionHandlers);
  }
  sessionHandlers.add(handler);
}

export function offInboxMessage(sessionId: string, handler: InboxHandler): void {
  const sessionHandlers = handlers.get(sessionId);
  if (!sessionHandlers) return;
  sessionHandlers.delete(handler);
  if (sessionHandlers.size === 0) {
    handlers.delete(sessionId);
  }
}
