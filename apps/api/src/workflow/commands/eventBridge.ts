import { nanoid } from 'nanoid';
import { workflowBus } from '../events/bus.js';
import { createEvent } from '../events/envelope.js';
import type { EventContext } from '../events/envelope.js';
import {
  LEGACY_TYPE_MAP,
  WF_COMPLETED,
  WF_FAILED,
} from '../events/catalog.js';
import type { AgentStreamEvent } from '../../agents/types.js';
import { getPendingActions } from '../../actions/manager.js';
import { getState } from '../../agents/stateManager.js';
import { emitChatEvent } from '../../websocket/chatGateway.js';
import { saveMessage } from '../../db/queries.js';
import type { ChatMessage } from '@devai/shared';

/** Lightweight tool event collected during a request for DB persistence. */
export interface CollectedToolEvent {
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

/**
 * Creates a bridge sendEvent function that translates legacy stream events
 * into domain events and emits them through the bus.
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
 * Creates a collecting bridge: wraps the legacy event bridge with tool event
 * collection for DB persistence. Returns both the sendEvent function and
 * the collected events array.
 */
export function createCollectingBridge(ctx: EventContext): {
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
 * Emits the terminal response event to:
 * 1. WS clients directly (StreamProjection skips terminal events)
 * 2. Domain event bus (for state/audit projections)
 */
export async function emitTerminalResponse(
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

export async function persistAndEmitTerminalResponse(params: {
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
