/**
 * Command Dispatcher — unified ingress for all WS workflow commands.
 *
 * Replaces the 4 duplicated branches in routes.ts with a single
 * dispatch path. Each command type has a dedicated handler that:
 *   1. Sets up session context (logger, state, history)
 *   2. Creates a bridge sendEvent (legacy → domain events)
 *   3. Calls the existing router function
 *   4. Constructs and emits the terminal response
 *   5. Persists messages to DB
 */

import { nanoid } from 'nanoid';
import { resolve } from 'path';
import type {
  WorkflowCommand,
  UserRequestCommand,
  UserQuestionAnsweredCommand,
  UserApprovalDecidedCommand,
  UserPlanApprovalDecidedCommand,
} from './types.js';
import type { RequestContext } from '../context/requestContext.js';
import { createRequestContext } from '../context/requestContext.js';
import { workflowBus } from '../events/bus.js';
import { createEvent } from '../events/envelope.js';
import type { EventContext } from '../events/envelope.js';
import {
  LEGACY_TYPE_MAP,
  WF_TURN_STARTED,
  WF_COMPLETED,
  WF_FAILED,
  GATE_QUESTION_RESOLVED,
  GATE_APPROVAL_RESOLVED,
  GATE_PLAN_APPROVAL_RESOLVED,
} from '../events/catalog.js';
import {
  processRequest,
  handleUserApproval,
  handleUserResponse,
  handlePlanApproval,
} from '../../agents/router.js';
import type { AgentStreamEvent, InboxMessage } from '../../agents/types.js';
import { pushToInbox } from '../../agents/inbox.js';
import { SessionLogger } from '../../audit/sessionLogger.js';
import {
  createSession,
  getMessages,
  saveMessage,
  updateSessionTitleIfEmpty,
} from '../../db/queries.js';
import {
  ensureStateLoaded,
  getState,
  getOrCreateState,
  setGatheredInfo,
  setPhase,
  isLoopActive,
} from '../../agents/stateManager.js';
import { getPendingActions } from '../../actions/manager.js';
import { emitChatEvent } from '../../websocket/chatGateway.js';
import { config } from '../../config.js';
import type { ChatMessage } from '@devai/shared';
import { buildUserfileContext } from '../../services/userfileContext.js';
import type { ContentBlock, TextContentBlock } from '../../llm/types.js';
import { buildConversationHistoryContext } from '../../agents/conversationHistory.js';

/** Result returned after dispatching a command. */
export type DispatchResult =
  | { type: 'success'; sessionId: string; responseMessage: ChatMessage }
  | { type: 'queued'; sessionId: string }
  | { type: 'error'; sessionId: string; responseMessage: ChatMessage };

/** Lightweight tool event collected during a request for DB persistence. */
interface CollectedToolEvent {
  id: string;
  type: 'status' | 'tool_call' | 'tool_result' | 'thinking';
  name?: string;
  arguments?: unknown;
  result?: unknown;
  completed?: boolean;
  agent?: string;
}

/** Event types worth persisting as tool events. */
const COLLECTIBLE_TYPES = new Set([
  'status', 'tool_call', 'tool_result', 'tool_result_chunk',
  'agent_thinking', 'agent_start', 'agent_switch',
]);

type JoinSessionFn = (id: string) => void;

interface DispatchOptions {
  /** Callback to join/rebind the WS socket to a session. */
  joinSession: JoinSessionFn;
}

type WorkspaceSessionMode = 'main' | 'shared';

function normalizeWorkspaceSessionMode(value: unknown): WorkspaceSessionMode | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'main' || normalized === 'shared') return normalized;
  return null;
}

function buildSessionTitle(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed) return null;
  return trimmed.length > 60 ? trimmed.slice(0, 57) + '...' : trimmed;
}

function buildApprovalDecisionText(command: UserApprovalDecidedCommand): string {
  return `/approval ${command.approved ? 'yes' : 'no'} (${command.approvalId})`;
}

function buildPlanApprovalDecisionText(command: UserPlanApprovalDecidedCommand): string {
  const base = `/plan_approval ${command.approved ? 'yes' : 'no'} (${command.planId})`;
  const reason = typeof command.reason === 'string' ? command.reason.trim() : '';
  return reason ? `${base} reason: ${reason}` : base;
}

function createChatMessage(role: ChatMessage['role'], content: string): ChatMessage {
  return {
    id: nanoid(),
    role,
    content,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates a collecting bridge: wraps the legacy event bridge with tool event
 * collection for DB persistence. Returns both the sendEvent function and
 * the collected events array.
 */
function createCollectingBridge(ctx: EventContext): {
  sendEvent: (event: AgentStreamEvent | Record<string, unknown>) => void;
  collectedToolEvents: CollectedToolEvent[];
} {
  const baseSend = createLegacyBridgeRaw(ctx);
  const collectedToolEvents: CollectedToolEvent[] = [];
  let currentAgent: string | undefined;

  const sendEvent = (event: AgentStreamEvent | Record<string, unknown>) => {
    baseSend(event);

    const ev = event as Record<string, unknown>;
    const evType = ev?.type as string | undefined;
    if (!evType || !COLLECTIBLE_TYPES.has(evType)) return;

    if (evType === 'agent_start' || evType === 'agent_switch') {
      currentAgent = (ev.to ?? ev.agent) as string | undefined;
      return;
    }

    const agent = (ev.agent as string | undefined) || currentAgent;

    if (evType === 'agent_thinking') {
      collectedToolEvents.push({ id: nanoid(), type: 'thinking', result: ev.status, agent });
    } else if (evType === 'status') {
      collectedToolEvents.push({ id: nanoid(), type: 'status', result: ev.status, agent });
    } else if (evType === 'tool_call') {
      collectedToolEvents.push({
        id: String(ev.id || nanoid()),
        type: 'tool_call',
        name: (ev.toolName ?? ev.name) as string | undefined,
        arguments: ev.args ?? ev.arguments,
        agent,
      });
    } else if (evType === 'tool_result' || evType === 'tool_result_chunk') {
      collectedToolEvents.push({
        id: String(ev.id || nanoid()),
        type: 'tool_result',
        name: (ev.toolName ?? ev.name) as string | undefined,
        result: ev.result,
        completed: ev.completed as boolean | undefined,
        agent,
      });
    }
  };

  return { sendEvent, collectedToolEvents };
}

/**
 * Creates a bridge sendEvent function that translates legacy stream events
 * into domain events and emits them through the bus.
 *
 * During incremental migration (Phases 3-4), processRequest/ChapoLoop still
 * emit old-style `{ type: 'agent_start', ... }` events. This bridge maps
 * them to domain events so projections handle all side effects.
 */
function createLegacyBridgeRaw(ctx: EventContext): (event: AgentStreamEvent | Record<string, unknown>) => void {
  return (event: AgentStreamEvent | Record<string, unknown>) => {
    const eventObj = event as Record<string, unknown>;
    const legacyType = eventObj?.type as string | undefined;
    if (!legacyType) return;

    // Skip terminal 'response' events — the dispatcher handles those directly
    if (legacyType === 'response') return;

    const domainType = LEGACY_TYPE_MAP[legacyType];
    if (!domainType) {
      // Unrecognized legacy type — pass through as internal event
      // This covers one-off events like perspective_start, perspective_complete, etc.
      return;
    }

    // Strip the `type` field from the payload (it's now in eventType)
    const { type: _type, ...payload } = eventObj;

    // Determine visibility: agent.history is internal, rest are UI-visible
    const visibility = domainType === 'agent.history' ? 'internal' as const : 'ui' as const;

    const envelope = createEvent(ctx, domainType, payload, {
      source: 'chapo-loop',
      visibility,
    });

    // Fire-and-forget — projections handle side effects asynchronously
    workflowBus.emit(envelope).catch((err) => {
      console.error('[CommandDispatcher] Bridge emit failed:', err);
    });
  };
}

/**
 * Emits the terminal response event to:
 * 1. WS clients directly (StreamProjection skips terminal events)
 * 2. Domain event bus (for state/audit projections)
 */
async function emitTerminalResponse(
  ctx: EventContext,
  sessionId: string,
  responseMessage: ChatMessage,
  pendingActions: unknown[],
  agentHistory: unknown[],
  isError: boolean,
): Promise<void> {
  // 1. Emit WS response event directly (StreamProjection skips WF_COMPLETED/WF_FAILED)
  emitChatEvent(sessionId, {
    type: 'response',
    requestId: ctx.requestId,
    response: {
      message: responseMessage,
      pendingActions,
      sessionId,
      agentHistory,
    },
  });

  // 2. Emit domain event for state/audit projections
  const eventType = isError ? WF_FAILED : WF_COMPLETED;
  const payload = isError
    ? { error: responseMessage.content, agent: 'system', recoverable: false }
    : { answer: responseMessage.content, totalIterations: 0, status: 'completed' };

  await workflowBus.emit(createEvent(ctx, eventType, payload, {
    source: 'router',
    visibility: 'ui',
  }));
}

async function persistAndEmitTerminalResponse(params: {
  ctx: EventContext;
  sessionId: string;
  userMessage: ChatMessage;
  responseMessage: ChatMessage;
  collectedToolEvents: CollectedToolEvent[];
  isError: boolean;
}): Promise<void> {
  const {
    ctx,
    sessionId,
    userMessage,
    responseMessage,
    collectedToolEvents,
    isError,
  } = params;

  await saveMessage(sessionId, userMessage);
  await saveMessage(
    sessionId,
    responseMessage,
    collectedToolEvents.length > 0 ? collectedToolEvents : undefined,
  );

  const pendingActions = await getPendingActions();
  const agentHistory = getState(sessionId)?.agentHistory || [];
  await emitTerminalResponse(
    ctx,
    sessionId,
    responseMessage,
    pendingActions,
    agentHistory,
    isError,
  );
}

export class CommandDispatcher {
  async dispatch(command: WorkflowCommand, opts: DispatchOptions): Promise<DispatchResult> {
    const ctx = createRequestContext(command.sessionId, command.requestId);

    switch (command.type) {
      case 'user_request':
        return this.handleRequest(command, ctx, opts);
      case 'user_question_answered':
        return this.handleQuestionAnswer(command, ctx, opts);
      case 'user_approval_decided':
        return this.handleApproval(command, ctx, opts);
      case 'user_plan_approval_decided':
        return this.handlePlanApproval(command, ctx, opts);
    }
  }

  private async handleRequest(
    command: UserRequestCommand,
    ctx: RequestContext,
    opts: DispatchOptions,
  ): Promise<DispatchResult> {
    const { message, projectRoot, metadata } = command;

    // Session logger for MD file logging
    const pendingSessionId = command.sessionId || 'pending';
    const chatLogger = SessionLogger.getOrCreate(pendingSessionId, message, 'multi-agent');
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

    const activeSessionId = command.sessionId || (await createSession()).id;
    opts.joinSession(activeSessionId);
    await ensureStateLoaded(activeSessionId);

    // Multi-message: if a loop is already running, queue instead of starting a new one
    if (isLoopActive(activeSessionId)) {
      const inboxMsg: InboxMessage = {
        id: nanoid(),
        content: typeof command.message === 'string' ? command.message : '[multimodal content]',
        receivedAt: new Date(),
        acknowledged: false,
        source: (command.metadata?.platform === 'telegram') ? 'telegram' : 'websocket',
      };
      pushToInbox(activeSessionId, inboxMsg);
      return {
        type: 'queued',
        sessionId: activeSessionId,
      };
    }

    // An explicit 'request' is always a new user request, NOT an answer to a pending question.
    const preState = getState(activeSessionId);
    if (preState?.currentPhase === 'waiting_user') {
      preState.pendingQuestions = [];
      setPhase(activeSessionId, 'idle');
    }

    const historyMessages = await getMessages(activeSessionId);
    const recentHistory = buildConversationHistoryContext(historyMessages);

    const state = getOrCreateState(activeSessionId);
    if (validatedProjectRoot) {
      state.taskContext.gatheredInfo['projectRoot'] = validatedProjectRoot;
    }

    // Apply workspace/session modes from metadata
    if (metadata) {
      const modes = ['workspaceContextMode', 'chatMode', 'sessionMode', 'visibility'] as const;
      for (const key of modes) {
        const value = normalizeWorkspaceSessionMode(metadata[key]);
        if (value) setGatheredInfo(activeSessionId, key, value);
      }
      // Store communication platform for channel-aware routing
      if (typeof metadata.platform === 'string') {
        setGatheredInfo(activeSessionId, 'platform', metadata.platform);
      }
    }

    // Re-bind logger to actual session ID
    const sessionLogger = SessionLogger.getOrCreate(activeSessionId, message, 'multi-agent');
    if (pendingSessionId !== activeSessionId) {
      sessionLogger.logUser(message);
    }

    // Update context with real session ID
    ctx.sessionId = activeSessionId;

    // Emit workflow turn started event
    await workflowBus.emit(createEvent(ctx, WF_TURN_STARTED, {
      userMessage: message,
    }, { source: 'ws', visibility: 'internal' }));

    // Bridge sendEvent: legacy events → domain events via bus + event collection
    const { sendEvent, collectedToolEvents } = createCollectingBridge(ctx);

    // Emit initial agent switch event through the bridge
    sendEvent({
      type: 'agent_switch',
      from: 'chapo',
      to: 'chapo',
      reason: 'Initiating multi-agent workflow',
    });

    // Inject pinned userfile content into the message
    let augmentedMessage: string | ContentBlock[] = message;
    if (command.pinnedUserfileIds && command.pinnedUserfileIds.length > 0) {
      try {
        const fileBlocks = await buildUserfileContext(command.pinnedUserfileIds);
        if (fileBlocks.length > 0) {
          const hasImages = fileBlocks.some((b) => b.type === 'image_url');
          if (hasImages) {
            // Multimodal: keep as ContentBlock array so images pass through to the LLM
            augmentedMessage = [...fileBlocks, { type: 'text' as const, text: message }];
          } else {
            // Text-only: flatten to plain string for backwards compatibility
            const textContext = fileBlocks
              .filter((b): b is TextContentBlock => b.type === 'text')
              .map((b) => b.text)
              .join('\n\n');
            augmentedMessage = textContext ? textContext + '\n\n' + message : message;
          }
        }
      } catch (err) {
        console.error('[CommandDispatcher] Failed to build userfile context:', err);
      }
    }

    try {
      const result = await processRequest(
        activeSessionId,
        augmentedMessage,
        recentHistory,
        validatedProjectRoot || config.allowedRoots[0],
        sendEvent as (event: AgentStreamEvent) => void,
      );

      const responseMessage = createChatMessage('assistant', result);
      const userMessage = createChatMessage('user', message);

      await persistAndEmitTerminalResponse({
        ctx,
        sessionId: activeSessionId,
        userMessage,
        responseMessage,
        collectedToolEvents,
        isError: false,
      });

      const title = buildSessionTitle(message);
      if (title) {
        await updateSessionTitleIfEmpty(activeSessionId, title);
      }
      sessionLogger.finalize('completed');

      return { type: 'success', sessionId: activeSessionId, responseMessage };
    } catch (err) {
      const errorContent = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      const userMessage = createChatMessage('user', message);
      const responseMessage = createChatMessage('assistant', errorContent);

      await persistAndEmitTerminalResponse({
        ctx,
        sessionId: activeSessionId,
        userMessage,
        responseMessage,
        collectedToolEvents,
        isError: true,
      });

      const title = buildSessionTitle(message);
      if (title) {
        await updateSessionTitleIfEmpty(activeSessionId, title);
      }
      sessionLogger.finalize('error');

      return { type: 'error', sessionId: activeSessionId, responseMessage };
    }
  }

  private async handleQuestionAnswer(
    command: UserQuestionAnsweredCommand,
    ctx: RequestContext,
    opts: DispatchOptions,
  ): Promise<DispatchResult> {
    opts.joinSession(command.sessionId);
    await ensureStateLoaded(command.sessionId);

    // Emit gate resolution event (for audit trail — state is still handled by router directly)
    await workflowBus.emit(createEvent(ctx, GATE_QUESTION_RESOLVED, {
      questionId: command.questionId,
      answer: command.answer,
    }, { source: 'ws', visibility: 'ui' }));

    const { sendEvent, collectedToolEvents } = createCollectingBridge(ctx);

    const result = await handleUserResponse(
      command.sessionId,
      command.questionId,
      command.answer,
      sendEvent as (event: AgentStreamEvent) => void,
    );

    const responseMessage = createChatMessage('assistant', result);
    const userMessage = createChatMessage('user', command.answer);

    await persistAndEmitTerminalResponse({
      ctx,
      sessionId: command.sessionId,
      userMessage,
      responseMessage,
      collectedToolEvents,
      isError: false,
    });

    return { type: 'success', sessionId: command.sessionId, responseMessage };
  }

  private async handleApproval(
    command: UserApprovalDecidedCommand,
    ctx: RequestContext,
    opts: DispatchOptions,
  ): Promise<DispatchResult> {
    opts.joinSession(command.sessionId);
    await ensureStateLoaded(command.sessionId);

    // Emit gate resolution event (for audit trail)
    await workflowBus.emit(createEvent(ctx, GATE_APPROVAL_RESOLVED, {
      approvalId: command.approvalId,
      approved: command.approved,
    }, { source: 'ws', visibility: 'ui' }));

    const { sendEvent, collectedToolEvents } = createCollectingBridge(ctx);

    const result = await handleUserApproval(
      command.sessionId,
      command.approvalId,
      command.approved,
      sendEvent as (event: AgentStreamEvent) => void,
    );

    const responseMessage = createChatMessage('assistant', result);
    const userMessage = createChatMessage('user', buildApprovalDecisionText(command));

    await persistAndEmitTerminalResponse({
      ctx,
      sessionId: command.sessionId,
      userMessage,
      responseMessage,
      collectedToolEvents,
      isError: false,
    });

    return { type: 'success', sessionId: command.sessionId, responseMessage };
  }

  private async handlePlanApproval(
    command: UserPlanApprovalDecidedCommand,
    ctx: RequestContext,
    opts: DispatchOptions,
  ): Promise<DispatchResult> {
    opts.joinSession(command.sessionId);
    await ensureStateLoaded(command.sessionId);

    // Emit gate resolution event (for audit/state projections)
    await workflowBus.emit(createEvent(ctx, GATE_PLAN_APPROVAL_RESOLVED, {
      planId: command.planId,
      approved: command.approved,
      reason: command.reason,
    }, { source: 'ws', visibility: 'ui' }));

    const { sendEvent, collectedToolEvents } = createCollectingBridge(ctx);

    const result = await handlePlanApproval(
      command.sessionId,
      command.planId,
      command.approved,
      command.reason,
      sendEvent as (event: AgentStreamEvent) => void,
    );

    const responseMessage = createChatMessage('assistant', result);
    const userMessage = createChatMessage('user', buildPlanApprovalDecisionText(command));

    await persistAndEmitTerminalResponse({
      ctx,
      sessionId: command.sessionId,
      userMessage,
      responseMessage,
      collectedToolEvents,
      isError: false,
    });

    return { type: 'success', sessionId: command.sessionId, responseMessage };
  }
}

/** Singleton command dispatcher. */
export const commandDispatcher = new CommandDispatcher();

/**
 * Maps a raw WS message to a typed WorkflowCommand.
 * Returns null for non-workflow messages (ping, hello, etc.).
 */
export function mapWsMessageToCommand(
  msg: Record<string, unknown>,
  currentSessionId: string | null,
  requestId: string,
): WorkflowCommand | null {
  const msgType = msg?.type;

  if (msgType === 'request') {
    const userMeta = (msg.metadata && typeof msg.metadata === 'object' && !Array.isArray(msg.metadata))
      ? msg.metadata as Record<string, unknown>
      : {};
    return {
      type: 'user_request',
      sessionId: (typeof msg.sessionId === 'string' ? msg.sessionId : currentSessionId) || '',
      requestId,
      message: typeof msg.message === 'string' ? msg.message : '',
      projectRoot: typeof msg.projectRoot === 'string' ? msg.projectRoot : undefined,
      metadata: { platform: 'web', ...userMeta },
      pinnedUserfileIds: Array.isArray(msg.pinnedUserfileIds)
        ? (msg.pinnedUserfileIds as unknown[]).filter((id): id is string => typeof id === 'string')
        : undefined,
    };
  }

  if (msgType === 'question') {
    return {
      type: 'user_question_answered',
      sessionId: (typeof msg.sessionId === 'string' ? msg.sessionId : currentSessionId) || '',
      requestId,
      questionId: typeof msg.questionId === 'string' ? msg.questionId : '',
      answer: typeof msg.answer === 'string' ? msg.answer : '',
    };
  }

  if (msgType === 'approval') {
    return {
      type: 'user_approval_decided',
      sessionId: (typeof msg.sessionId === 'string' ? msg.sessionId : currentSessionId) || '',
      requestId,
      approvalId: typeof msg.approvalId === 'string' ? msg.approvalId : '',
      approved: Boolean(msg.approved),
    };
  }

  if (msgType === 'plan_approval') {
    return {
      type: 'user_plan_approval_decided',
      sessionId: (typeof msg.sessionId === 'string' ? msg.sessionId : currentSessionId) || '',
      requestId,
      planId: typeof msg.planId === 'string' ? msg.planId : '',
      approved: Boolean(msg.approved),
      reason: typeof msg.reason === 'string' ? msg.reason : undefined,
    };
  }

  return null;
}
