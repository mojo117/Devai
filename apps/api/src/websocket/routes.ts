import type { FastifyPluginAsync } from 'fastify';
import type { WebSocket } from 'ws';
import { nanoid } from 'nanoid';
import { registerClient as registerActionClient, unregisterClient as unregisterActionClient, getConnectionStats } from './actionBroadcaster.js';
import {
  registerChatClient, unregisterChatClient,
  getEventsSince, getCurrentSeq, getChatGatewayStats
} from './chatGateway.js';
import { getPendingActions } from '../actions/manager.js';
import { verifyToken } from '../routes/auth.js';
import { ensureStateLoaded, getState } from '../agents/stateManager.js';
import { commandDispatcher, mapWsMessageToCommand } from '../workflow/commands/dispatcher.js';

export const websocketRoutes: FastifyPluginAsync = async (app) => {
  // WebSocket endpoint for real-time action updates
  app.get('/ws/actions', { websocket: true }, (socket: WebSocket, request) => {
    // Parse session ID from query params
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const sessionId = url.searchParams.get('sessionId') || undefined;

    // Register client
    registerActionClient(socket, sessionId);

    // Send initial pending actions on connect
    (async () => {
      try {
        const pendingActions = await getPendingActions();
        if (pendingActions.length > 0) {
          socket.send(JSON.stringify({
            type: 'initial_sync',
            actions: pendingActions,
            timestamp: new Date().toISOString(),
          }));
        }
      } catch (err) {
        console.error('[WS] Failed to send initial pending actions:', err);
      }
    })();

    // Handle incoming messages (ping/pong, acknowledgments)
    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        }

        // Could add acknowledgment handling here for guaranteed delivery
      } catch (err) {
        console.error('[WS] Failed to parse message:', err);
      }
    });

    // Handle disconnect
    socket.on('close', () => {
      unregisterActionClient(socket, sessionId);
    });

    socket.on('error', (err) => {
      console.error('[WS] Socket error:', err);
      unregisterActionClient(socket, sessionId);
    });
  });

  // HTTP endpoint to check WebSocket stats (useful for debugging)
  app.get('/ws/stats', async () => {
    return getConnectionStats();
  });

  // WebSocket control plane for multi-agent chat streaming + resume/replay.
  // Auth: requires ?token=<JWT> because browsers can't set Authorization headers for WS upgrades.
  app.get('/ws/chat', { websocket: true }, (socket: WebSocket, request) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const token = url.searchParams.get('token') || '';
    if (!verifyToken(token)) {
      try {
        socket.send(JSON.stringify({ type: 'error', error: 'Invalid or expired token' }));
      } catch { /* ignore */ }
      socket.close();
      return;
    }

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
        socket.send(JSON.stringify({
          type: 'initial_sync',
          actions: pendingActions,
          timestamp: new Date().toISOString(),
        }));
      } catch (err) {
        console.error('[WS] Failed to send initial pending actions (chat ws):', err);
      }
    })();

    socket.on('message', async (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString()) as Record<string, unknown>;
      } catch {
        return;
      }

      if (msg?.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
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
          socket.send(JSON.stringify(ev));
        }

        // Send a lightweight resync snapshot as well (pending gates + pending actions).
        try {
          await ensureStateLoaded(id);
          const state = getState(id);
          const pendingActions = await getPendingActions();
          socket.send(JSON.stringify({
            type: 'hello_ack',
            sessionId: id,
            currentSeq: getCurrentSeq(id),
            pendingApprovals: state?.pendingApprovals ?? [],
            pendingQuestions: state?.pendingQuestions ?? [],
            pendingActions,
            timestamp: new Date().toISOString(),
          }));
        } catch (err) {
          socket.send(JSON.stringify({
            type: 'hello_ack',
            sessionId: id,
            currentSeq: getCurrentSeq(id),
            pendingApprovals: [],
            pendingQuestions: [],
            pendingActions: [],
            error: err instanceof Error ? err.message : 'resync failed',
            timestamp: new Date().toISOString(),
          }));
        }
        return;
      }

      // ── Unified command dispatch ───────────────────────────────
      // All workflow commands (request, approval, question, plan_approval)
      // go through the CommandDispatcher which handles session setup,
      // legacy bridge, response construction, and DB persistence.
      const requestId = typeof msg.requestId === 'string' ? msg.requestId : nanoid();

      const command = mapWsMessageToCommand(msg, sessionId, requestId);
      if (command) {
        // Validate required fields per command type
        if (command.type === 'user_request' && !command.message.trim()) {
          socket.send(JSON.stringify({ type: 'error', requestId, error: 'Missing message' }));
          return;
        }
        if (command.type === 'user_approval_decided' && (!command.sessionId || !command.approvalId)) {
          socket.send(JSON.stringify({ type: 'error', requestId, error: 'Missing sessionId or approvalId' }));
          return;
        }
        if (command.type === 'user_question_answered' && (!command.sessionId || !command.questionId)) {
          socket.send(JSON.stringify({ type: 'error', requestId, error: 'Missing sessionId or questionId' }));
          return;
        }
        if (command.type === 'user_plan_approval_decided' && (!command.sessionId || !command.planId)) {
          socket.send(JSON.stringify({ type: 'error', requestId, error: 'Missing sessionId or planId' }));
          return;
        }

        try {
          await commandDispatcher.dispatch(command, { joinSession });
        } catch (err) {
          console.error('[WS] Command dispatch error:', err);
          socket.send(JSON.stringify({
            type: 'error',
            requestId,
            error: err instanceof Error ? err.message : 'Command dispatch failed',
          }));
        }
        return;
      }
    });

    socket.on('close', () => {
      if (sessionId) {
        unregisterChatClient(socket, sessionId);
        unregisterActionClient(socket, sessionId);
      }
      unregisterActionClient(socket);
    });

    socket.on('error', () => {
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
