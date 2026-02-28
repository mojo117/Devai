import type { FastifyPluginAsync } from 'fastify'
import type { WebSocket } from 'ws'
import { nanoid } from 'nanoid'
import { registerClient as registerActionClient, unregisterClient as unregisterActionClient, getConnectionStats } from './actionBroadcaster.js'
import {
  registerChatClient, unregisterChatClient,
  getEventsSince, getCurrentSeq, getChatGatewayStats
} from './chatGateway.js'
import { getPendingActions } from '../actions/manager.js'
import { verifyToken } from '../services/authService.js'
import { ensureStateLoaded, getState } from '../agents/stateManager.js'
import { commandDispatcher, mapWsMessageToCommand } from '../workflow/commands/dispatcher.js'

const WS_RATE_LIMIT_MAX_MESSAGES = 120;
const WS_RATE_LIMIT_WINDOW_MS = 60_000;
const WS_HEARTBEAT_INTERVAL_MS = 30_000;
const WS_HEARTBEAT_TIMEOUT_MS = 95_000;

/** Send a message only if the socket is still open.  Returns false on failure. */
function safeSend(socket: WebSocket, data: unknown): boolean {
  if (socket.readyState !== 1 /* WebSocket.OPEN */) return false;
  try {
    socket.send(JSON.stringify(data));
    return true;
  } catch (err) {
    console.warn('[ws] safeSend failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

interface WsConnectionGuards {
  allowMessage: () => boolean;
  cleanup: () => void;
}

function createWsConnectionGuards(socket: WebSocket): WsConnectionGuards {
  let messageCount = 0;
  let windowStart = Date.now();
  let lastSeenAt = Date.now();
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeatTimer);
  };

  const closeWithError = (error: string, code: number) => {
    cleanup();
    safeSend(socket, { type: 'error', error });
    try {
      socket.close(code, error.slice(0, 120));
    } catch (err) {
      console.warn('[ws] Close failed:', err instanceof Error ? err.message : err);
    }
  };

  const heartbeatTimer = setInterval(() => {
    const now = Date.now();
    if (now - lastSeenAt > WS_HEARTBEAT_TIMEOUT_MS) {
      closeWithError('WebSocket heartbeat timeout. Please reconnect.', 4000);
      return;
    }
    safeSend(socket, { type: 'ping', timestamp: new Date().toISOString() });
  }, WS_HEARTBEAT_INTERVAL_MS);

  return {
    allowMessage: () => {
      lastSeenAt = Date.now();
      const now = Date.now();
      if (now - windowStart >= WS_RATE_LIMIT_WINDOW_MS) {
        windowStart = now;
        messageCount = 0;
      }
      messageCount += 1;
      if (messageCount > WS_RATE_LIMIT_MAX_MESSAGES) {
        closeWithError('WebSocket message rate limit exceeded.', 4008);
        return false;
      }
      return true;
    },
    cleanup,
  };
}

export const websocketRoutes: FastifyPluginAsync = async (app) => {
  // WebSocket endpoint for real-time action updates
  app.get('/ws/actions', { websocket: true }, (socket: WebSocket, request) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);

    // Auth: require valid JWT token (query param or httpOnly cookie)
    const token = request.cookies?.devai_token || url.searchParams.get('token') || '';
    if (!verifyToken(token)) {
      safeSend(socket, { type: 'error', error: 'Invalid or expired token' });
      socket.close();
      return;
    }

    const guards = createWsConnectionGuards(socket);
    const sessionId = url.searchParams.get('sessionId') || undefined;

    // Register client
    registerActionClient(socket, sessionId);

    // Send initial pending actions on connect
    (async () => {
      try {
        const pendingActions = await getPendingActions();
        if (pendingActions.length > 0) {
          safeSend(socket, {
            type: 'initial_sync',
            actions: pendingActions,
            timestamp: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error('[WS] Failed to send initial pending actions:', err);
      }
    })();

    // Handle incoming messages (ping/pong, acknowledgments)
    socket.on('message', (data) => {
      if (!guards.allowMessage()) return;
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'ping') {
          safeSend(socket, { type: 'pong', timestamp: new Date().toISOString() });
          return;
        }

        // Could add acknowledgment handling here for guaranteed delivery
      } catch (err) {
        console.error('[WS] Failed to parse message:', err);
      }
    });

    // Handle disconnect
    socket.on('close', () => {
      guards.cleanup();
      unregisterActionClient(socket, sessionId);
    });

    socket.on('error', (err) => {
      guards.cleanup();
      console.error('[WS] Socket error:', err);
      unregisterActionClient(socket, sessionId);
    });
  });

  // HTTP endpoint to check WebSocket stats (useful for debugging)
  app.get('/ws/stats', async () => {
    return getConnectionStats();
  });

  // WebSocket control plane for multi-agent chat streaming + resume/replay.
  // Auth: prefer httpOnly cookie, fallback to ?token=<JWT>.
  app.get('/ws/chat', { websocket: true }, (socket: WebSocket, request) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const token = request.cookies?.devai_token || url.searchParams.get('token') || '';
    if (!verifyToken(token)) {
      safeSend(socket, { type: 'error', error: 'Invalid or expired token' });
      socket.close();
      return;
    }

    const guards = createWsConnectionGuards(socket);
    let sessionId: string | null = url.searchParams.get('sessionId');

    const joinSession = (id: string) => {
      if (sessionId && sessionId !== id) {
        unregisterChatClient(socket, sessionId);
        unregisterActionClient(socket, sessionId);
      }
      sessionId = id;
      registerChatClient(socket, id);
      registerActionClient(socket, id);
    };

    if (sessionId) {
      joinSession(sessionId);
    }

    // Also register for global action broadcasts so the UI can run a single WebSocket.
    registerActionClient(socket);

    // Send initial pending actions on connect (same as /ws/actions)
    (async () => {
      try {
        const pendingActions = await getPendingActions();
        safeSend(socket, {
          type: 'initial_sync',
          actions: pendingActions,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[WS] Failed to send initial pending actions (chat ws):', err);
      }
    })();

    socket.on('message', async (data) => {
      if (!guards.allowMessage()) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString()) as Record<string, unknown>;
      } catch (err) {
        console.warn('[ws] Failed to parse incoming WS message:', err instanceof Error ? err.message : err);
        return;
      }

      if (msg?.type === 'ping') {
        safeSend(socket, { type: 'pong', timestamp: new Date().toISOString() });
        return;
      }

      // Client can re-attach to a session and ask for event replay.
      if (msg?.type === 'hello') {
        const id = typeof msg.sessionId === 'string' ? msg.sessionId : null;
        if (!id) return;
        joinSession(id);

        const sinceSeq = typeof msg.sinceSeq === 'number' ? msg.sinceSeq : 0;
        const replay = getEventsSince(id, sinceSeq);
        for (const ev of replay) {
          if (!safeSend(socket, ev)) break; // stop replay if socket closed mid-loop
        }

        // Send a lightweight resync snapshot as well (pending gates + pending actions).
        try {
          await ensureStateLoaded(id);
          const state = getState(id);
          const pendingActions = await getPendingActions();
          safeSend(socket, {
            type: 'hello_ack',
            sessionId: id,
            currentSeq: getCurrentSeq(id),
            pendingApprovals: state?.pendingApprovals ?? [],
            pendingQuestions: state?.pendingQuestions ?? [],
            pendingActions,
            timestamp: new Date().toISOString(),
          });
        } catch (err) {
          safeSend(socket, {
            type: 'hello_ack',
            sessionId: id,
            currentSeq: getCurrentSeq(id),
            pendingApprovals: [],
            pendingQuestions: [],
            pendingActions: [],
            error: err instanceof Error ? err.message : 'resync failed',
            timestamp: new Date().toISOString(),
          });
        }
        return;
      }

      // ── Unified command dispatch ───────────────────────────────
      // All workflow commands (request, approval, question) go through
      // the CommandDispatcher which handles session setup,
      // legacy bridge, response construction, and DB persistence.
      const requestId = typeof msg.requestId === 'string' ? msg.requestId : nanoid();

      const command = mapWsMessageToCommand(msg, sessionId, requestId);
      if (command) {
        // Validate required fields per command type
        if (command.type === 'user_request' && !command.message.trim()) {
          safeSend(socket, { type: 'error', requestId, error: 'Missing message' });
          return;
        }
        if (command.type === 'user_approval_decided' && (!command.sessionId || !command.approvalId)) {
          safeSend(socket, { type: 'error', requestId, error: 'Missing sessionId or approvalId' });
          return;
        }
        if (command.type === 'user_question_answered' && (!command.sessionId || !command.questionId)) {
          safeSend(socket, { type: 'error', requestId, error: 'Missing sessionId or questionId' });
          return;
        }

        try {
          const result = await commandDispatcher.dispatch(command, { joinSession });
          if (result.type === 'queued') {
            safeSend(socket, {
              type: 'response',
              requestId,
              response: {
                queued: true,
                pendingActions: [],
                sessionId: result.sessionId,
                agentHistory: getState(result.sessionId)?.agentHistory || [],
              },
            });
          }
        } catch (err) {
          console.error('[WS] Command dispatch error:', err);
          safeSend(socket, {
            type: 'error',
            requestId,
            error: err instanceof Error ? err.message : 'Command dispatch failed',
          });
        }
        return;
      }
    });

    socket.on('close', () => {
      guards.cleanup();
      if (sessionId) {
        unregisterChatClient(socket, sessionId);
        unregisterActionClient(socket, sessionId);
      }
      unregisterActionClient(socket);
    });

    socket.on('error', () => {
      guards.cleanup();
      if (sessionId) {
        unregisterChatClient(socket, sessionId);
        unregisterActionClient(socket, sessionId);
      }
      unregisterActionClient(socket);
    });
  });

  app.get('/ws/chat/stats', async () => {
    return getChatGatewayStats();
  });
};
