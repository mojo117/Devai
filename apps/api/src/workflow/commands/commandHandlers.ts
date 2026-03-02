import { nanoid } from 'nanoid';
import { resolve } from 'path';
import type {
  UserRequestCommand,
  UserQuestionAnsweredCommand,
  UserApprovalDecidedCommand,
} from './types.js';
import type { RequestContext } from '../context/requestContext.js';
import { workflowBus } from '../events/bus.js';
import { createEvent } from '../events/envelope.js';
import {
  WF_TURN_STARTED,
  GATE_QUESTION_RESOLVED,
  GATE_APPROVAL_RESOLVED,
} from '../events/catalog.js';
import {
  processRequest,
  handleUserApproval,
  handleUserResponse,
} from '../../agents/router.js';
import type { AgentStreamEvent, InboxMessage } from '../../agents/types.js';
import { pushToInbox, drainInbox } from '../../agents/inbox.js';
import { SessionLogger } from '../../audit/sessionLogger.js';
import {
  createSession,
  ensureSessionExists,
  getMessages,
  saveMessage,
  updateSessionTitleIfEmpty,
} from '../../db/queries.js';
import {
  ensureStateLoaded,
  getState,
  getOrCreateState,
  setGatheredInfo,
  setActiveTurnId,
  setPhase,
  isLoopActive,
  setLoopRunning,
  getSessionMode,
} from '../../agents/stateManager.js';
import { config } from '../../config.js';
import type { ChatMessage } from '@devai/shared';
import { buildUserfileContext } from '../../services/userfileContext.js';
import type { ContentBlock, TextContentBlock } from '../../llm/types.js';
import { buildConversationHistoryContext } from '../../agents/conversationHistory.js';
import { createCollectingBridge, persistAndEmitTerminalResponse, type CollectedToolEvent } from './eventBridge.js';
import { classifyInboundText } from '../../agents/intakeClassifier.js';
import { tryHandleSlashCommand } from '../../agents/router/slashCommands.js';

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
      } catch (err) {
        console.warn('[commandHandlers] Failed to validate project root:', err instanceof Error ? err.message : err);
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

    // Fast-path: slash commands bypass the LLM queue entirely
    const msgText = typeof command.message === 'string' ? command.message.trim() : '';
    const slashResult = await tryHandleSlashCommand(activeSessionId, msgText);
    if (slashResult !== null) {
      const userMsg = createChatMessage('user', msgText);
      const assistantMsg = createChatMessage('assistant', slashResult);

      await persistAndEmitTerminalResponse({
        ctx,
        sessionId: activeSessionId,
        userMessage: userMsg,
        responseMessage: assistantMsg,
        collectedToolEvents: [],
        isError: false,
      });

      return { type: 'success', sessionId: activeSessionId, responseMessage: assistantMsg };
    }

    // Multi-message: if a loop is already running...
    const loopActive = await isLoopActive(activeSessionId);
    if (loopActive) {
      const sessionMode = getSessionMode(activeSessionId);

      if (sessionMode === 'parallel') {
        // Parallel mode: fire-and-forget a new loop concurrently
        const parallelTurnId = command.requestId;

        // Snapshot history BEFORE persisting the new user message so the parallel
        // loop sees prior conversation context but not messages from other parallel loops.
        const historySnapshot = await getMessages(activeSessionId);
        const snapshotHistory = buildConversationHistoryContext(historySnapshot);

        // Persist user message immediately so it's visible in chat history
        const parallelUserMsg = createChatMessage('user', typeof command.message === 'string' ? command.message : '[multimodal content]');
        saveMessage(activeSessionId, parallelUserMsg).catch((err) =>
          console.error('[commandHandlers] Failed to persist parallel user message:', err),
        );

        const { sendEvent: pSendEvent, collectedToolEvents: pCollected } = createCollectingBridge(ctx);
        pSendEvent({ type: 'loop_started', turnId: parallelTurnId, taskLabel: buildSessionTitle(message) || 'Task' });

        // Build augmented message (userfile injection) for the parallel loop
        let parallelMessage: string | ContentBlock[] = message;
        if (command.pinnedUserfileIds && command.pinnedUserfileIds.length > 0) {
          try {
            const fileBlocks = await buildUserfileContext(command.pinnedUserfileIds);
            if (fileBlocks.length > 0) {
              const hasImages = fileBlocks.some((b) => b.type === 'image_url');
              if (hasImages) {
                parallelMessage = [...fileBlocks, { type: 'text' as const, text: message }];
              } else {
                const textContext = fileBlocks
                  .filter((b): b is TextContentBlock => b.type === 'text')
                  .map((b) => b.text)
                  .join('\n\n');
                parallelMessage = textContext ? textContext + '\n\n' + message : message;
              }
            }
          } catch { /* fallback to plain message */ }
        }

        // Start the parallel loop in background — don't await
        this.runParallelLoop(
          activeSessionId, parallelMessage, parallelTurnId,
          validatedProjectRoot, ctx, pSendEvent, pCollected, message, snapshotHistory,
        ).catch((err) => {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error';
          console.error('[commandHandlers] Parallel loop error:', errorMsg);
          // Surface error to user
          pSendEvent({
            type: 'error',
            agent: 'chapo',
            error: `Parallel loop failed: ${errorMsg}`,
          });
        });

        return { type: 'queued', sessionId: activeSessionId };
      }

      // Serial mode (status quo): queue to inbox
      setGatheredInfo(activeSessionId, 'queuedIntakeKind', intake.kind);
      const inboxMsg: InboxMessage = {
        id: nanoid(),
        content: typeof command.message === 'string' ? command.message : '[multimodal content]',
        receivedAt: new Date(),
        acknowledged: false,
        source: (command.metadata?.platform === 'telegram') ? 'telegram' : 'websocket',
      };
      pushToInbox(activeSessionId, inboxMsg);

      // Persist the user message so it survives page refreshes and appears in chat history
      const queuedUserMessage = createChatMessage('user', typeof command.message === 'string' ? command.message : '[multimodal content]');
      saveMessage(activeSessionId, queuedUserMessage).catch((err) =>
        console.error('[commandHandlers] Failed to persist queued message:', err),
      );

      return {
        type: 'queued',
        sessionId: activeSessionId,
      };
    }

    // Claim the loop EARLY so concurrent requests are queued/rejected
    // before the slow prep work (intake, userfiles, etc.) begins.
    // ChapoLoop.run() clears this flag; the catch block below is the safety net.
    await setLoopRunning(activeSessionId, true);

    // An explicit 'request' is always a new user request, NOT an answer to a pending question.
    const preState = getState(activeSessionId);
    if (preState?.currentPhase === 'waiting_user') {
      preState.pendingQuestions = [];
      setPhase(activeSessionId, 'idle');
    }

    // Fresh explicit request => start a new turn.
    const turnId = command.requestId;
    setActiveTurnId(activeSessionId, turnId);
    setGatheredInfo(activeSessionId, 'activeTurnId', turnId);

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
          console.info('[CommandDispatcher] Injected userfile context:', {
            fileCount: command.pinnedUserfileIds!.length,
            blockCount: fileBlocks.length,
            hasImages,
          });
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
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        augmentedMessage = `[System: ${command.pinnedUserfileIds!.length} pinned file(s) could not be loaded: ${errMsg}. Tell the user about this problem.]\n\n${message}`;
      }
    }

    // Persist user message immediately (before processRequest) so it gets the
    // arrival timestamp, not the completion timestamp. This keeps message order
    // correct when parallel loops save their user messages early too.
    const persistedContent = typeof augmentedMessage === 'string'
      ? augmentedMessage
      : augmentedMessage
          .filter((b): b is TextContentBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n\n');
    const userMessage = createChatMessage('user', persistedContent || message);
    saveMessage(activeSessionId, userMessage).catch((err) =>
      console.error('[commandHandlers] Failed to persist user message:', err),
    );

    try {
      const { answer, isError } = await processRequest(
        activeSessionId,
        augmentedMessage,
        recentHistory,
        validatedProjectRoot || config.allowedRoots[0],
        sendEvent as (event: AgentStreamEvent) => void,
      );

      // Guard: never persist an empty assistant response (e.g. from a stale/timed-out LLM call)
      if (!answer && !isError) {
        console.warn(`[commandHandlers] Empty answer for session ${activeSessionId}, skipping persist`);
        await setLoopRunning(activeSessionId, false);
        sessionLogger.finalize('empty');
        return { type: 'error', sessionId: activeSessionId };
      }

      const responseMessage = createChatMessage('assistant', answer);

      await persistAndEmitTerminalResponse({
        ctx,
        sessionId: activeSessionId,
        userMessage,
        responseMessage,
        collectedToolEvents,
        isError,
        skipUserMessage: true,
      });

      const title = buildSessionTitle(message);
      if (title) {
        await updateSessionTitleIfEmpty(activeSessionId, title);
      }
      sessionLogger.finalize('completed');

      // Process queued messages sequentially (simple queue model)
      let queuedMessages = drainInbox(activeSessionId);
      if (queuedMessages.length > 0) {
        sendEvent({ type: 'inbox_processing', count: queuedMessages.length });
      }
      while (queuedMessages.length > 0) {
        for (const queuedMsg of queuedMessages) {
          const queuedHistory = await getMessages(activeSessionId);
          const recentHistory = buildConversationHistoryContext(queuedHistory);
          const { sendEvent: qSendEvent, collectedToolEvents: qCollected } = createCollectingBridge(ctx);

          const { answer: qAnswer, isError: qIsError } = await processRequest(
            activeSessionId,
            queuedMsg.content,
            recentHistory,
            validatedProjectRoot || config.allowedRoots[0],
            qSendEvent as (event: AgentStreamEvent) => void,
          );

          // Guard: skip empty responses from queued messages too
          if (!qAnswer && !qIsError) {
            console.warn(`[commandHandlers] Empty queued answer for session ${activeSessionId}, skipping persist`);
            continue;
          }

          // User message was already persisted when it was queued (serial path, line ~231)
          const qUserMsg = createChatMessage('user', queuedMsg.content);
          const qResponseMsg = createChatMessage('assistant', qAnswer);
          await persistAndEmitTerminalResponse({
            ctx,
            sessionId: activeSessionId,
            userMessage: qUserMsg,
            responseMessage: qResponseMsg,
            collectedToolEvents: qCollected,
            isError: qIsError,
            skipUserMessage: true,
          });
        }
        // Check for more messages that arrived during processing
        queuedMessages = drainInbox(activeSessionId);
      }

      return { type: 'success', sessionId: activeSessionId, responseMessage };
    } catch (err) {
      // Ensure the loop flag is cleared if we never reached ChapoLoop.run()
      await setLoopRunning(activeSessionId, false);

      const errorContent = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      const responseMessage = createChatMessage('assistant', errorContent);

      await persistAndEmitTerminalResponse({
        ctx,
        sessionId: activeSessionId,
        userMessage,
        responseMessage,
        collectedToolEvents,
        skipUserMessage: true,
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

  /**
   * Run a parallel CHAPO loop in the background. Fire-and-forget from handleRequest.
   */
  private async runParallelLoop(
    sessionId: string,
    augmentedMessage: string | ContentBlock[],
    parallelTurnId: string,
    validatedProjectRoot: string | null,
    ctx: RequestContext,
    sendEvent: (event: AgentStreamEvent) => void,
    collectedToolEvents: CollectedToolEvent[],
    originalMessage: string,
    historySnapshot: Array<{ role: string; content: string }>,
  ): Promise<void> {
    // Use the pre-snapshotted history — captured before the parallel user message
    // was persisted, so this loop sees prior conversation but not other parallel loops.
    const recentHistory = historySnapshot;

    try {
      const { answer: pAnswer, isError: pIsError } = await processRequest(
        sessionId,
        augmentedMessage,
        recentHistory,
        validatedProjectRoot || config.allowedRoots[0],
        sendEvent,
        parallelTurnId,
      );

      // Guard: never persist an empty assistant response
      if (!pAnswer && !pIsError) {
        console.warn(`[commandHandlers] Empty parallel answer for session ${sessionId}, skipping persist`);
        return;
      }

      const responseMessage = createChatMessage('assistant', pAnswer);
      // User message was already persisted in handleRequest (line ~174) — don't save again
      const userMessage = createChatMessage('user', originalMessage);

      await persistAndEmitTerminalResponse({
        ctx,
        sessionId,
        userMessage,
        responseMessage,
        collectedToolEvents,
        isError: pIsError,
        skipUserMessage: true,
      });

      sendEvent({
        type: 'loop_completed',
        turnId: parallelTurnId,
        taskLabel: buildSessionTitle(originalMessage) || 'Task',
      });
    } catch (err) {
      const errorContent = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      const userMessage = createChatMessage('user', originalMessage);
      const responseMessage = createChatMessage('assistant', errorContent);

      await persistAndEmitTerminalResponse({
        ctx,
        sessionId,
        userMessage,
        responseMessage,
        collectedToolEvents,
        isError: true,
      });

      console.error('[commandHandlers] Parallel loop failed:', err instanceof Error ? err.message : err);
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

    const qaResult = await handleUserResponse(
      command.sessionId,
      command.questionId,
      command.answer,
      sendEvent as (event: AgentStreamEvent) => void,
    );

    const responseMessage = createChatMessage('assistant', qaResult);
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

    const approvalResult = await handleUserApproval(
      command.sessionId,
      command.approvalId,
      command.approved,
      sendEvent as (event: AgentStreamEvent) => void,
    );

    const responseMessage = createChatMessage('assistant', approvalResult);
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

}
