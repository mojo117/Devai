import { nanoid } from 'nanoid';
import type { ContentBlock } from '../../llm/types.js';
import { getTextContent } from '../../llm/types.js';
import { getTrustMode, setDefaultEngine } from '../../db/queries.js';
import { rememberNote } from '../../memory/workspaceMemory.js';
import * as stateManager from '../stateManager.js';
import { warmSystemContextForSession } from '../systemContext.js';
import { resolveModelSelection } from '../../llm/modelSelector.js';
import { isValidEngine, formatEngineStatus, type EngineName } from '../../llm/engineProfiles.js';
import { getAgent } from './agentAccess.js';
import { ChapoLoop } from '../chapo-loop.js';
import type {
  AgentName,
  UserResponse,
} from '../types.js';
import {
  extractExplicitRememberNote,
  getProjectRootFromState,
  loadRecentConversationHistory,
  looksLikeContinuePrompt,
  parseYesNo,
} from './requestUtils.js';
import type { SendEventFn } from './shared.js';

/**
 * Main entry point: Process a user request through the multi-agent system
 */
export async function processRequest(
  sessionId: string,
  userMessage: string | ContentBlock[],
  conversationHistory: Array<{ role: string; content: string }> | undefined,
  projectRoot: string | null,
  sendEvent: SendEventFn,
): Promise<string> {
  await stateManager.ensureStateLoaded(sessionId);
  const traceId = nanoid(12);
  // Default to empty array if not provided
  const history = conversationHistory ?? [];

  // If the user typed a simple yes/no while we're waiting on an approval, treat it as the approval decision.
  // This prevents "yes is too vague" when the new router asks "Should I continue?".
  const decision = parseYesNo(getTextContent(userMessage));
  const gateState = stateManager.getOrCreateState(sessionId);
  const pendingApprovals = gateState.pendingApprovals ?? [];
  if (decision !== null && pendingApprovals.length > 0) {
    const latest = pendingApprovals[pendingApprovals.length - 1];
    return handleUserApproval(sessionId, latest.approvalId, decision, sendEvent);
  }

  // If we're waiting for the user to answer a clarification question, treat the next message as the answer.
  const pendingQuestions = gateState.pendingQuestions ?? [];
  if (gateState.currentPhase === 'waiting_user' && pendingQuestions.length > 0) {
    const latestQ = pendingQuestions[pendingQuestions.length - 1];
    return handleUserResponse(sessionId, latestQ.questionId, getTextContent(userMessage), sendEvent);
  }

  // Fallback: if state was lost (restart) but the last assistant prompt was a "continue?" gate,
  // interpret "yes" as "continue the previous request".
  if (decision === true && pendingApprovals.length === 0) {
    const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant')?.content || '';
    if (looksLikeContinuePrompt(lastAssistant)) {
      const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content || '';
      if (lastUser.trim()) {
        stateManager.setOriginalRequest(sessionId, lastUser);
        userMessage = lastUser;
      }
    }
  }

  const explicitRemember = extractExplicitRememberNote(getTextContent(userMessage));
  if (explicitRemember) {
    try {
      const saved = await rememberNote(explicitRemember.note, {
        sessionId,
        source: 'chat.explicit_remember',
      });
      return `Notiert. Gespeichert in ${saved.daily.filePath}.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return `Ich konnte die Notiz nicht speichern: ${message}`;
    }
  }

  // Handle /engine command — switch LLM engine profile (no LLM call needed)
  const engineMatch = getTextContent(userMessage).trim().match(/^\/engine(?:\s+(.*))?$/i);
  if (engineMatch) {
    const arg = engineMatch[1]?.trim().toLowerCase();
    if (!arg) {
      const currentEngine = (stateManager.getState(sessionId)
        ?.taskContext.gatheredInfo.engineProfile as string) || 'glm';
      return formatEngineStatus(currentEngine as EngineName);
    }
    if (isValidEngine(arg)) {
      stateManager.setGatheredInfo(sessionId, 'engineProfile', arg);
      await stateManager.flushState(sessionId);
      await setDefaultEngine(arg);
      return `Engine switched to **${arg.toUpperCase()}**.\n\n${formatEngineStatus(arg)}`;
    }
    return `Unknown engine "${arg}". Available: glm, gemini, claude.\nUsage: /engine <glm|gemini|claude>`;
  }

  // Keep the last actual request for approval/resume flows.
  stateManager.setOriginalRequest(sessionId, getTextContent(userMessage));
  await warmSystemContextForSession(sessionId, projectRoot || getProjectRootFromState(sessionId));

  const chapo = getAgent('chapo');
  const modelSelection = resolveModelSelection(chapo, sessionId);

  console.info(`[trace:${traceId}] processRequest start`, {
    sessionId,
    projectRoot: projectRoot || null,
    messageLength: getTextContent(userMessage).length,
    selectedModel: `${modelSelection.provider}/${modelSelection.model}`,
  });

  // Initialize or get state
  const state = stateManager.getOrCreateState(sessionId);
  stateManager.setOriginalRequest(sessionId, getTextContent(userMessage));
  stateManager.setGatheredInfo(sessionId, 'modelSelection', modelSelection);
  const trustMode = await getTrustMode();
  stateManager.setGatheredInfo(sessionId, 'trustMode', trustMode);

  try {
    const loopProjectRoot = projectRoot || getProjectRootFromState(sessionId);
    const loop = new ChapoLoop(sessionId, sendEvent, loopProjectRoot, modelSelection, {
      maxIterations: 30,
    }, traceId);
    const loopResult = await loop.run(userMessage, history);

    if (loopResult.status === 'error') {
      stateManager.setPhase(sessionId, 'error');
    }

    return loopResult.answer;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[trace:${traceId}] ChapoLoop crashed, attempting recovery:`, errorMessage);

    // Attempt recovery: let CHAPO process the error intelligently
    try {
      const recoveryLoop = new ChapoLoop(sessionId, sendEvent, projectRoot || getProjectRootFromState(sessionId), modelSelection, {
        maxIterations: 3,
      }, traceId);
      // Sanitize history to prevent re-triggering crashes from oversized/malformed messages
      const sanitizedHistory = history.slice(-6).map(msg => ({
        ...msg,
        content: typeof msg.content === 'string'
          ? msg.content.slice(0, 5000)
          : String(msg.content).slice(0, 5000),
      }));
      const errorHistory = [
        ...sanitizedHistory,
        { role: 'user', content: getTextContent(userMessage) },
        { role: 'system', content: `[CRITICAL ERROR] The previous processing attempt crashed with: ${errorMessage}. Explain what happened to the user in plain language and suggest next steps. Do NOT retry the same operation that caused the crash.` },
      ];
      const recovery = await recoveryLoop.run(
        `Erkläre dem User was schiefgelaufen ist: ${errorMessage}`,
        errorHistory,
      );
      if (recovery.status !== 'error') {
        return recovery.answer;
      }
    } catch (recoveryErr) {
      console.error('[agents] Recovery loop also failed:', recoveryErr);
    }

    // Absolute fallback if recovery also fails
    stateManager.setPhase(sessionId, 'error');

    stateManager.addHistoryEntry(
      sessionId,
      state.activeAgent,
      'respond',
      userMessage,
      errorMessage,
      { status: 'error' },
    );

    sendEvent({ type: 'error', agent: state.activeAgent, error: errorMessage });

    return `Fehler aufgetreten: ${errorMessage}\n\nBitte hilf mir, dieses Problem zu lösen.`;
  }
}

/**
 * Handle user response to a question
 */
export async function handleUserResponse(
  sessionId: string,
  questionId: string,
  answer: string,
  sendEvent: SendEventFn,
): Promise<string> {
  await stateManager.ensureStateLoaded(sessionId);
  const question = stateManager.removePendingQuestion(sessionId, questionId);
  if (!question) {
    return 'Frage nicht gefunden.';
  }

  const activeTurnId = stateManager.getActiveTurnId(sessionId);
  const turnMismatch = Boolean(question.turnId && activeTurnId && question.turnId !== activeTurnId);
  const expired = Boolean(
    question.expiresAt
    && Number.isFinite(Date.parse(question.expiresAt))
    && Date.parse(question.expiresAt) <= Date.now(),
  );
  if (turnMismatch || expired) {
    const history = await loadRecentConversationHistory(sessionId);
    const projectRoot = getProjectRootFromState(sessionId);
    return processRequest(
      sessionId,
      answer,
      history,
      projectRoot,
      sendEvent,
    );
  }

  const historyAgent: AgentName =
    question.fromAgent === 'chapo' || question.fromAgent === 'devo' || question.fromAgent === 'scout' || question.fromAgent === 'caio'
      ? question.fromAgent
      : 'chapo';

  const userResponse: UserResponse = {
    questionId,
    answer,
    timestamp: new Date().toISOString(),
  };

  stateManager.addHistoryEntry(
    sessionId,
    historyAgent,
    'respond',
    question,
    userResponse,
    { status: 'success' },
  );
  await stateManager.flushState(sessionId);

  // Continue processing with the new information
  const state = stateManager.getState(sessionId);
  if (state) {
    const history = await loadRecentConversationHistory(sessionId);
    const projectRoot = getProjectRootFromState(sessionId);
    return processRequest(
      sessionId,
      `${state.taskContext.originalRequest}\n\nZusätzliche Info: ${answer}`,
      history,
      projectRoot,
      sendEvent,
    );
  }

  return 'Session nicht gefunden.';
}

/**
 * Handle user approval
 */
export async function handleUserApproval(
  sessionId: string,
  approvalId: string,
  approved: boolean,
  sendEvent: SendEventFn,
): Promise<string> {
  await stateManager.ensureStateLoaded(sessionId);
  console.info('[agents] handleUserApproval', { sessionId, approvalId, approved });
  const approval = stateManager.removePendingApproval(sessionId, approvalId);
  if (!approval) {
    console.warn('[agents] approval not found', { sessionId, approvalId });
    return 'Freigabe-Anfrage nicht gefunden.';
  }

  if (!approved) {
    stateManager.setPhase(sessionId, 'error');
    await stateManager.flushState(sessionId);
    return 'Task abgebrochen durch User.';
  }

  stateManager.grantApproval(sessionId);
  await stateManager.flushState(sessionId);

  const state = stateManager.getState(sessionId);
  if (state) {
    const history = await loadRecentConversationHistory(sessionId);
    const projectRoot = getProjectRootFromState(sessionId);
    return processRequest(
      sessionId,
      state.taskContext.originalRequest,
      history,
      projectRoot,
      sendEvent,
    );
  }

  return 'Session nicht gefunden.';
}
