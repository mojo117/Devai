import { nanoid } from 'nanoid';
import { resolve } from 'path';
import type {
  UserRequestCommand,
  UserQuestionAnsweredCommand,
  UserApprovalDecidedCommand,
  UserPlanApprovalDecidedCommand,
} from './types.js';
import type { RequestContext } from '../context/requestContext.js';
import { workflowBus } from '../events/bus.js';
import { createEvent } from '../events/envelope.js';
import {
  WF_TURN_STARTED,
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
  ensureSessionExists,
  getMessages,
  updateSessionTitleIfEmpty,
} from '../../db/queries.js';
import {
  ensureStateLoaded,
  getState,
  getOrCreateState,
  setGatheredInfo,
  setActiveTurnId,
  getActiveTurnId,
  setPhase,
  isLoopActive,
  addUserRequestObligations,
  waiveObligationsExceptTurn,
} from '../../agents/stateManager.js';
import { config } from '../../config.js';
import type { ChatMessage } from '@devai/shared';
import { buildUserfileContext } from '../../services/userfileContext.js';
import type { ContentBlock, TextContentBlock } from '../../llm/types.js';
import { buildConversationHistoryContext } from '../../agents/conversationHistory.js';
import { createCollectingBridge, persistAndEmitTerminalResponse } from './eventBridge.js';
import { classifyInboundText } from '../../agents/intakeClassifier.js';

/** Result returned after dispatching a command. */
export type DispatchResult =
  | { type: 'success'; sessionId: string; responseMessage: ChatMessage }
  | { type: 'queued'; sessionId: string }
  | { type: 'error'; sessionId: string; responseMessage: ChatMessage };

type JoinSessionFn = (id: string) => void;

export interface DispatchOptions {
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

export class CommandHandlers {
  async handleRequest(
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
    const initialTitle = buildSessionTitle(message) || undefined;
    await ensureSessionExists(activeSessionId, initialTitle);
    opts.joinSession(activeSessionId);
    await ensureStateLoaded(activeSessionId);
    const stateSnapshot = getState(activeSessionId);
    const pendingApprovals = stateSnapshot?.pendingApprovals ?? [];
    const pendingQuestions = stateSnapshot?.pendingQuestions ?? [];
    const latestQuestion = pendingQuestions[pendingQuestions.length - 1];
    const intake = classifyInboundText(message, {
      hasPendingApprovals: pendingApprovals.length > 0,
      hasPendingQuestions: pendingQuestions.length > 0,
      latestPendingQuestion: typeof latestQuestion?.question === 'string' ? latestQuestion.question : '',
    });
    setGatheredInfo(activeSessionId, 'requestIntakeKind', intake.kind);
    setGatheredInfo(activeSessionId, 'requestIntakeReason', intake.reason);

    // Multi-message: if a loop is already running, queue instead of starting a new one
    if (isLoopActive(activeSessionId)) {
      const activeTurnId = getActiveTurnId(activeSessionId) || command.requestId;
      const queuedObligationCount = intake.shouldCreateObligation
        ? addUserRequestObligations(activeSessionId, message, {
          turnId: activeTurnId,
          origin: 'inbox',
          blocking: true,
        }).length
        : 0;
      setGatheredInfo(activeSessionId, 'queuedObligationCount', queuedObligationCount);
      setGatheredInfo(activeSessionId, 'queuedIntakeKind', intake.kind);
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

    // Fresh explicit request => start a new turn and waive unresolved obligations from older turns.
    const turnId = command.requestId;
    setActiveTurnId(activeSessionId, turnId);
    const waivedCount = waiveObligationsExceptTurn(
      activeSessionId,
      turnId,
      `Waived: superseded by explicit request turn ${turnId}.`,
    );
    setGatheredInfo(activeSessionId, 'waivedObligationCount', waivedCount);
    setGatheredInfo(activeSessionId, 'activeTurnId', turnId);
    const seededObligationCount = intake.shouldCreateObligation
      ? addUserRequestObligations(activeSessionId, message, {
        turnId,
        origin: 'primary',
        blocking: true,
      }).length
      : 0;
    setGatheredInfo(activeSessionId, 'obligationCount', seededObligationCount);

    const historyMessages = await getMessages(activeSessionId);
    const recentHistory = buildConversationHistoryContext(historyMessages);

    const state = getOrCreateState(activeSessionId);
    if (validatedProjectRoot) {
      state.taskContext.gatheredInfo.projectRoot = validatedProjectRoot;
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

  async handleQuestionAnswer(
    command: UserQuestionAnsweredCommand,
    ctx: RequestContext,
    opts: DispatchOptions,
  ): Promise<DispatchResult> {
    opts.joinSession(command.sessionId);
    await ensureSessionExists(command.sessionId);
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

  async handleApproval(
    command: UserApprovalDecidedCommand,
    ctx: RequestContext,
    opts: DispatchOptions,
  ): Promise<DispatchResult> {
    opts.joinSession(command.sessionId);
    await ensureSessionExists(command.sessionId);
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

  async handlePlanApproval(
    command: UserPlanApprovalDecidedCommand,
    ctx: RequestContext,
    opts: DispatchOptions,
  ): Promise<DispatchResult> {
    opts.joinSession(command.sessionId);
    await ensureSessionExists(command.sessionId);
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
