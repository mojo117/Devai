import type { WebSocket } from 'ws';
import type { Action } from '../actions/types.js';

// Store connected WebSocket clients by session ID
const clients = new Map<string, Set<WebSocket>>();

// Global broadcast (for all clients)
const globalClients = new Set<WebSocket>();

export interface ActionEvent {
  type: 'action_created' | 'action_updated' | 'action_pending';
  action: Action;
  timestamp: string;
}

/**
 * Register a WebSocket client for a specific session
 */
export function registerClient(ws: WebSocket, sessionId?: string): void {
  if (sessionId) {
    if (!clients.has(sessionId)) {
      clients.set(sessionId, new Set());
    }
    clients.get(sessionId)!.add(ws);
  }

  // Also add to global clients
  globalClients.add(ws);

  console.log(`[WS] Client connected. Session: ${sessionId || 'global'}. Total: ${globalClients.size}`);
}

/**
 * Unregister a WebSocket client
 */
export function unregisterClient(ws: WebSocket, sessionId?: string): void {
  if (sessionId) {
    const sessionClients = clients.get(sessionId);
    if (sessionClients) {
      sessionClients.delete(ws);
      if (sessionClients.size === 0) {
        clients.delete(sessionId);
      }
    }
  }

  globalClients.delete(ws);
  console.log(`[WS] Client disconnected. Total: ${globalClients.size}`);
}

/**
 * Broadcast an action event to all connected clients
 */
export function broadcastActionEvent(event: ActionEvent): void {
  const message = JSON.stringify(event);

  let sent = 0;
  for (const ws of globalClients) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      try {
        ws.send(message);
        sent++;
      } catch (err) {
        console.error('[WS] Failed to send message:', err);
      }
    }
  }

  console.log(`[WS] Broadcast ${event.type} to ${sent} clients`);
}

/**
 * Broadcast to clients in a specific session
 */
export function broadcastToSession(sessionId: string, event: ActionEvent): void {
  const sessionClients = clients.get(sessionId);
  if (!sessionClients) return;

  const message = JSON.stringify(event);

  for (const ws of sessionClients) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      try {
        ws.send(message);
      } catch (err) {
        console.error('[WS] Failed to send message:', err);
      }
    }
  }
}

/**
 * Notify clients of a new pending action
 */
export function notifyActionPending(action: Action): void {
  broadcastActionEvent({
    type: 'action_pending',
    action,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Notify clients of an action update (approved, rejected, executed)
 */
export function notifyActionUpdated(action: Action): void {
  broadcastActionEvent({
    type: 'action_updated',
    action,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Get connection stats
 */
export function getConnectionStats(): { totalClients: number; sessions: number } {
  return {
    totalClients: globalClients.size,
    sessions: clients.size,
  };
}
