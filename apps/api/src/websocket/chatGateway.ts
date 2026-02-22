import type { WebSocket } from 'ws';
import { triggerSessionEndExtraction } from '../memory/service.js';
import { renderRecentFocusMd } from '../memory/recentFocusRenderer.js';
import { cleanupSession } from '../memory/topicTagger.js';
import { getMessages } from '../db/queries.js';

/** Per-session state: connected clients, event ring buffer, sequence counter. */
interface ChatSessionState {
  clients: Set<WebSocket>;
  events: Array<Record<string, unknown> & { seq: number }>;
  currentSeq: number;
}

const MAX_EVENTS_PER_SESSION = 500;

const chatSessions = new Map<string, ChatSessionState>();

function getOrCreateSession(sessionId: string): ChatSessionState {
  let session = chatSessions.get(sessionId);
  if (!session) {
    session = { clients: new Set(), events: [], currentSeq: 0 };
    chatSessions.set(sessionId, session);
  }
  return session;
}

/**
 * Register a WebSocket client for chat event streaming in a session.
 */
export function registerChatClient(ws: WebSocket, sessionId: string): void {
  const session = getOrCreateSession(sessionId);
  session.clients.add(ws);
  console.log(`[ChatGW] Client registered for session ${sessionId}. Clients: ${session.clients.size}`);
}

/**
 * Unregister a WebSocket client from a chat session.
 */
export function unregisterChatClient(ws: WebSocket, sessionId: string): void {
  const session = chatSessions.get(sessionId);
  if (!session) return;
  session.clients.delete(ws);

  if (session.clients.size === 0) {
    // Session ended — trigger async memory extraction
    getMessages(sessionId).then((messages) => {
      if (messages.length < 3) return; // Skip trivial sessions
      const conversationText = messages
        .map((m: { role: string; content: string }) => `[${m.role}]: ${m.content}`)
        .join('\n\n');
      triggerSessionEndExtraction(conversationText, sessionId);
    }).catch((err) => {
      console.error('[ChatGW] session-end extraction failed:', err);
    });

    // Render RECENT_FOCUS.md from current DB state
    renderRecentFocusMd().catch((err) => {
      console.error('[ChatGW] RECENT_FOCUS.md render failed:', err);
    });

    // Cleanup tagger debounce state
    cleanupSession(sessionId);

    if (session.events.length === 0) {
      chatSessions.delete(sessionId);
    }
  }

  console.log(`[ChatGW] Client unregistered from session ${sessionId}. Remaining: ${session?.clients.size ?? 0}`);
}

/**
 * Assign a sequence number, store in ring buffer, and broadcast to all
 * connected clients in the given session.
 */
export function emitChatEvent(sessionId: string, event: Record<string, unknown>): void {
  const session = getOrCreateSession(sessionId);
  session.currentSeq += 1;
  const seqEvent = { ...event, seq: session.currentSeq };

  // Ring buffer: keep last N events
  session.events.push(seqEvent);
  if (session.events.length > MAX_EVENTS_PER_SESSION) {
    session.events = session.events.slice(-MAX_EVENTS_PER_SESSION);
  }

  const message = JSON.stringify(seqEvent);
  for (const ws of session.clients) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      try {
        ws.send(message);
      } catch (err) {
        console.error('[ChatGW] Failed to send event:', err);
      }
    }
  }
}

/**
 * Return all stored events with seq > sinceSeq for replay on reconnect.
 */
export function getEventsSince(sessionId: string, sinceSeq: number): Array<Record<string, unknown> & { seq: number }> {
  const session = chatSessions.get(sessionId);
  if (!session) return [];
  return session.events.filter((e) => e.seq > sinceSeq);
}

/**
 * Return the current sequence number for a session (0 if unknown).
 */
export function getCurrentSeq(sessionId: string): number {
  return chatSessions.get(sessionId)?.currentSeq ?? 0;
}

/**
 * Return connection and event stats for debugging.
 */
export function getChatGatewayStats(): {
  totalSessions: number;
  totalClients: number;
  totalBufferedEvents: number;
} {
  let totalClients = 0;
  let totalBufferedEvents = 0;
  for (const session of chatSessions.values()) {
    totalClients += session.clients.size;
    totalBufferedEvents += session.events.length;
  }
  return {
    totalSessions: chatSessions.size,
    totalClients,
    totalBufferedEvents,
  };
}
