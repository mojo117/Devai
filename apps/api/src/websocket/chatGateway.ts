import type { WebSocket } from 'ws';

export type ChatGatewayEvent = Record<string, unknown> & { type: string };

export interface SequencedChatEvent extends ChatGatewayEvent {
  seq: number;
  sessionId: string;
  timestamp: string;
}

const clientsBySession = new Map<string, Set<WebSocket>>();

// Per-session ring buffer for reconnect/replay.
const buffers = new Map<string, SequencedChatEvent[]>();
const seqBySession = new Map<string, number>();

const BUFFER_LIMIT = 600;

function getNextSeq(sessionId: string): number {
  const next = (seqBySession.get(sessionId) ?? 0) + 1;
  seqBySession.set(sessionId, next);
  return next;
}

function pushToBuffer(sessionId: string, event: SequencedChatEvent): void {
  const buf = buffers.get(sessionId) ?? [];
  buf.push(event);
  if (buf.length > BUFFER_LIMIT) {
    buf.splice(0, buf.length - BUFFER_LIMIT);
  }
  buffers.set(sessionId, buf);
}

function safeSend(ws: WebSocket, data: string): void {
  if (ws.readyState !== 1) return; // WebSocket.OPEN
  try {
    ws.send(data);
  } catch {
    // Ignore send errors; caller unregisters on close/error.
  }
}

export function registerChatClient(ws: WebSocket, sessionId: string): void {
  const set = clientsBySession.get(sessionId) ?? new Set<WebSocket>();
  set.add(ws);
  clientsBySession.set(sessionId, set);
}

export function unregisterChatClient(ws: WebSocket, sessionId: string): void {
  const set = clientsBySession.get(sessionId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) {
    clientsBySession.delete(sessionId);
  }
}

export function emitChatEvent(sessionId: string, event: ChatGatewayEvent): SequencedChatEvent {
  const seq = getNextSeq(sessionId);
  const enriched: SequencedChatEvent = {
    ...event,
    sessionId,
    seq,
    timestamp: new Date().toISOString(),
  };

  pushToBuffer(sessionId, enriched);

  const payload = JSON.stringify(enriched);
  const clients = clientsBySession.get(sessionId);
  if (clients) {
    for (const ws of clients) {
      safeSend(ws, payload);
    }
  }

  return enriched;
}

export function getEventsSince(sessionId: string, sinceSeq: number): SequencedChatEvent[] {
  const buf = buffers.get(sessionId);
  if (!buf || buf.length === 0) return [];
  return buf.filter((e) => e.seq > sinceSeq);
}

export function getCurrentSeq(sessionId: string): number {
  return seqBySession.get(sessionId) ?? 0;
}

export function getChatGatewayStats(): { sessions: number; clients: number; buffers: number } {
  let clients = 0;
  for (const set of clientsBySession.values()) clients += set.size;
  return {
    sessions: clientsBySession.size,
    clients,
    buffers: buffers.size,
  };
}

