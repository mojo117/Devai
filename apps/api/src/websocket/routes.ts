import type { FastifyPluginAsync } from 'fastify';
import type { WebSocket } from 'ws';
import { resolve } from 'path';
import { nanoid } from 'nanoid';
import { registerClient as registerActionClient, unregisterClient as unregisterActionClient, getConnectionStats } from './actionBroadcaster.js';
import {
  registerChatClient, unregisterChatClient, emitChatEvent,
  getEventsSince, getCurrentSeq, getChatGatewayStats
} from './chatGateway.js';
import { getPendingActions } from '../actions/manager.js';
import { verifyToken } from '../routes/auth.js';
import { config } from '../config.js';
import { createSession, getMessages, saveMessage, updateSessionTitleIfEmpty } from '../db/queries.js';
import { ensureStateLoaded, getState, getOrCreateState, setGatheredInfo, setPhase } from '../agents/stateManager.js';
import { processRequest, handleUserApproval, handleUserResponse, handlePlanApproval } from '../agents/router.js';
import type { AgentStreamEvent } from '../agents/types.js';
import type { ChatMessage } from '@devai/shared';
import { SessionLogger } from '../audit/sessionLogger.js';

type WorkspaceSessionMode = 'main' | 'shared';

function buildSessionTitle(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed) return null;
  return trimmed.length > 60 ? trimmed.slice(0, 57) + '...' : trimmed;
}

function normalizeWorkspaceSessionMode(value: unknown): WorkspaceSessionMode | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'main' || normalized === 'shared') return normalized;
  return null;
}

function readRequestMode(msg: Record<string, unknown>): {
  workspaceContextMode: WorkspaceSessionMode | null;
  chatMode: WorkspaceSessionMode | null;
  sessionMode: WorkspaceSessionMode | null;
  visibility: WorkspaceSessionMode | null;
} {
  const metadata = (msg.metadata && typeof msg.metadata === 'object' && !Array.isArray(msg.metadata))
    ? (msg.metadata as Record<string, unknown>)
    : {};

  const workspaceContextMode = normalizeWorkspaceSessionMode(
    msg.workspaceContextMode ?? metadata.workspaceContextMode ?? null
  );
  const chatMode = normalizeWorkspaceSessionMode(
    msg.chatMode ?? metadata.chatMode ?? null
  );
  const sessionMode = normalizeWorkspaceSessionMode(
    msg.sessionMode ?? metadata.sessionMode ?? null
  );
  const visibility = normalizeWorkspaceSessionMode(
    msg.visibility ?? metadata.visibility ?? null
  );

  return { workspaceContextMode, chatMode, sessionMode, visibility };
}

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

      // Everything below is request/command execution and expects a session context.
      const requestId = typeof msg.requestId === 'string' ? msg.requestId : nanoid();

      const sendEvent = (event: AgentStreamEvent | Record<string, unknown>) => {
        // Broadcast to all clients in the session and add replay seq.
        // Also tag requestId so the initiating client can resolve its promise.
        if (!sessionId) return;
        const eventObj = event as Record<string, unknown>;
        const type = eventObj?.type;
        if (typeof type !== 'string' || !type) return;
        emitChatEvent(sessionId, { ...eventObj, type, requestId });
      };

      // Execute a multi-agent chat request (equivalent to POST /chat/agents).
      if (msg?.type === 'request') {
        const message = typeof msg.message === 'string' ? msg.message : '';
        const requestedSessionId = typeof msg.sessionId === 'string' ? msg.sessionId : undefined;
        const projectRoot = typeof msg.projectRoot === 'string' ? msg.projectRoot : undefined;
        if (!message.trim()) {
          socket.send(JSON.stringify({ type: 'error', requestId, error: 'Missing message' }));
          return;
        }

        // Session logger for MD file logging
        const activeSessionForLog = requestedSessionId || 'pending';
        const chatLogger = SessionLogger.getOrCreate(activeSessionForLog, message, 'multi-agent');
        chatLogger.logUser(message);

        // Validate project root
        let validatedProjectRoot: string | null = null;
        if (projectRoot) {
          try {
            const normalizedPath = resolve(projectRoot);
            const isAllowed = config.allowedRoots.some((root) => {
              const absoluteRoot = resolve(root);
              return normalizedPath.startsWith(absoluteRoot + '/') || normalizedPath === absoluteRoot;
            });
            if (isAllowed) {
              validatedProjectRoot = normalizedPath;
            }
          } catch {
            // ignore
          }
        }

        const activeSessionId = requestedSessionId || (await createSession()).id;
        joinSession(activeSessionId);
        await ensureStateLoaded(activeSessionId);

        // An explicit 'request' message is always a new user request, NOT an answer
        // to a pending clarification question. Clear the waiting_user state so
        // processRequest doesn't hijack this as a question response.
        const preState = getState(activeSessionId);
        if (preState?.currentPhase === 'waiting_user') {
          preState.pendingQuestions = [];
          setPhase(activeSessionId, 'idle');
        }

        const historyMessages = await getMessages(activeSessionId);
        const recentHistory = historyMessages.slice(-30).map((m) => ({ role: m.role, content: m.content }));

        const state = getOrCreateState(activeSessionId);
        if (validatedProjectRoot) {
          state.taskContext.gatheredInfo['projectRoot'] = validatedProjectRoot;
        }
        const mode = readRequestMode(msg);
        if (mode.workspaceContextMode) {
          setGatheredInfo(activeSessionId, 'workspaceContextMode', mode.workspaceContextMode);
        }
        if (mode.chatMode) {
          setGatheredInfo(activeSessionId, 'chatMode', mode.chatMode);
        }
        if (mode.sessionMode) {
          setGatheredInfo(activeSessionId, 'sessionMode', mode.sessionMode);
        }
        if (mode.visibility) {
          setGatheredInfo(activeSessionId, 'visibility', mode.visibility);
        }

        // Re-bind logger to actual session ID (may differ from initial 'pending')
        const sessionLogger = SessionLogger.getOrCreate(activeSessionId, message, 'multi-agent');
        if (activeSessionForLog !== activeSessionId) {
          sessionLogger.logUser(message);
        }

        const loggedSendEvent = (event: AgentStreamEvent | Record<string, unknown>) => {
          sendEvent(event);
          sessionLogger.logAgentEvent(event as Record<string, unknown>);
        };

        loggedSendEvent({
          type: 'agent_switch',
          from: 'chapo',
          to: 'chapo',
          reason: 'Initiating multi-agent workflow',
        });

        try {
          const result = await processRequest(
            activeSessionId,
            message,
            recentHistory,
            validatedProjectRoot || config.allowedRoots[0],
            loggedSendEvent as any
          );

          const responseMessage = {
            id: nanoid(),
            role: 'assistant' as const,
            content: result,
            timestamp: new Date().toISOString(),
          };

          const userMessage: ChatMessage = {
            id: nanoid(),
            role: 'user' as const,
            content: message,
            timestamp: new Date().toISOString(),
          };

          await saveMessage(activeSessionId, userMessage);
          await saveMessage(activeSessionId, responseMessage as ChatMessage);

          const title = buildSessionTitle(message);
          if (title) {
            await updateSessionTitleIfEmpty(activeSessionId, title);
          }

          const finalState = getState(activeSessionId);
          const pendingActions = await getPendingActions();

          loggedSendEvent({
            type: 'response',
            response: {
              message: responseMessage,
              pendingActions,
              sessionId: activeSessionId,
              agentHistory: finalState?.agentHistory || [],
            },
          });
          sessionLogger.finalize('completed');
        } catch (err) {
          loggedSendEvent({
            type: 'response',
            response: {
              message: {
                id: nanoid(),
                role: 'assistant',
                content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
                timestamp: new Date().toISOString(),
              },
              pendingActions: await getPendingActions(),
              sessionId: activeSessionId,
              agentHistory: getState(activeSessionId)?.agentHistory || [],
            },
          });
          sessionLogger.finalize('error');
        }
        return;
      }

      // Handle approval decisions (equivalent to POST /chat/agents/approval).
      if (msg?.type === 'approval') {
        const approvalId = typeof msg.approvalId === 'string' ? msg.approvalId : '';
        const approved = Boolean(msg.approved);
        const requestedSessionId = typeof msg.sessionId === 'string' ? msg.sessionId : sessionId || undefined;
        if (!requestedSessionId || !approvalId) {
          socket.send(JSON.stringify({ type: 'error', requestId, error: 'Missing sessionId or approvalId' }));
          return;
        }
        joinSession(requestedSessionId);
        await ensureStateLoaded(requestedSessionId);

        const result = await handleUserApproval(requestedSessionId, approvalId, approved, sendEvent as any);
        const responseMessage = {
          id: nanoid(),
          role: 'assistant' as const,
          content: result,
          timestamp: new Date().toISOString(),
        };
        const state = getState(requestedSessionId);
        if (state) {
          await saveMessage(requestedSessionId, responseMessage as ChatMessage);
        }
        const pendingActions = await getPendingActions();
        sendEvent({
          type: 'response',
          response: {
            message: responseMessage,
            pendingActions,
            sessionId: requestedSessionId,
            agentHistory: state?.agentHistory || [],
          },
        });
        return;
      }

      // Handle question responses (equivalent to POST /chat/agents/question).
      if (msg?.type === 'question') {
        const questionId = typeof msg.questionId === 'string' ? msg.questionId : '';
        const answer = typeof msg.answer === 'string' ? msg.answer : '';
        const requestedSessionId = typeof msg.sessionId === 'string' ? msg.sessionId : sessionId || undefined;
        if (!requestedSessionId || !questionId) {
          socket.send(JSON.stringify({ type: 'error', requestId, error: 'Missing sessionId or questionId' }));
          return;
        }
        joinSession(requestedSessionId);
        await ensureStateLoaded(requestedSessionId);

        const result = await handleUserResponse(requestedSessionId, questionId, answer, sendEvent as any);
        const responseMessage = {
          id: nanoid(),
          role: 'assistant' as const,
          content: result,
          timestamp: new Date().toISOString(),
        };
        const state = getState(requestedSessionId);
        if (state) {
          // Persist the user's clarification as a real message for session history.
          const userMsg: ChatMessage = {
            id: nanoid(),
            role: 'user' as const,
            content: answer,
            timestamp: new Date().toISOString(),
          };
          await saveMessage(requestedSessionId, userMsg);
          await saveMessage(requestedSessionId, responseMessage as ChatMessage);
        }
        const pendingActions = await getPendingActions();
        sendEvent({
          type: 'response',
          response: {
            message: responseMessage,
            pendingActions,
            sessionId: requestedSessionId,
            agentHistory: state?.agentHistory || [],
          },
        });
        return;
      }

      // Handle plan approval/rejection (equivalent to POST /chat/agents/plan/approval).
      if (msg?.type === 'plan_approval') {
        const planId = typeof msg.planId === 'string' ? msg.planId : '';
        const approved = Boolean(msg.approved);
        const reason = typeof msg.reason === 'string' ? msg.reason : '';
        const requestedSessionId = typeof msg.sessionId === 'string' ? msg.sessionId : sessionId || undefined;
        if (!requestedSessionId || !planId) {
          socket.send(JSON.stringify({ type: 'error', requestId, error: 'Missing sessionId or planId' }));
          return;
        }
        joinSession(requestedSessionId);
        await ensureStateLoaded(requestedSessionId);

        const result = await handlePlanApproval(requestedSessionId, planId, approved, reason, sendEvent as any);
        const responseMessage = {
          id: nanoid(),
          role: 'assistant' as const,
          content: result,
          timestamp: new Date().toISOString(),
        };
        const state = getState(requestedSessionId);
        if (state) {
          await saveMessage(requestedSessionId, responseMessage as ChatMessage);
        }
        const pendingActions = await getPendingActions();
        sendEvent({
          type: 'response',
          response: {
            message: responseMessage,
            pendingActions,
            sessionId: requestedSessionId,
            agentHistory: state?.agentHistory || [],
          },
        });
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
