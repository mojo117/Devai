import type { ContentBlock } from '../../llm/types.js';
import { getTextContent } from '../../llm/types.js';
import { getTrustMode } from '../../db/queries.js';
import { rememberNote } from '../../memory/workspaceMemory.js';
import * as stateManager from '../stateManager.js';
import { warmSystemContextForSession } from '../systemContext.js';
import {
  classifyTaskComplexity,
  selectModel,
} from '../../llm/modelSelector.js';
import { ChapoLoop } from '../chapo-loop.js';
import type {
  AgentName,
  UserResponse,
} from '../types.js';
import {
  extractExplicitRememberNote,
  getProjectRootFromState,
  isSmallTalk,
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

  // Lightweight small-talk response (avoid forcing project clarification on greetings).
  if (isSmallTalk(getTextContent(userMessage))) {
    return 'Hey. Womit soll ich dir helfen: Code aendern, Bug fixen, oder etwas nachschlagen?';
  }

  const explicitRemember = extractExplicitRememberNote(getTextContent(userMessage));
  if (explicitRemember) {
    try {
      const saved = await rememberNote(explicitRemember.note, {
        sessionId,
        source: 'chat.explicit_remember',
        promoteToLongTerm: explicitRemember.promoteToLongTerm,
      });
      const longTermInfo = saved.longTerm ? ` und zusaetzlich in ${saved.longTerm.filePath}` : '';
      return `Notiert. Gespeichert in ${saved.daily.filePath}${longTermInfo}.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return `Ich konnte die Notiz nicht speichern: ${message}`;
    }
  }

  // Keep the last actual request for approval/resume flows.
  stateManager.setOriginalRequest(sessionId, getTextContent(userMessage));
  await warmSystemContextForSession(sessionId, projectRoot || getProjectRootFromState(sessionId));

  // FAST PATH: Early task classification (no LLM call!)
  const taskComplexity = classifyTaskComplexity(getTextContent(userMessage));
  const modelSelection = selectModel(taskComplexity);

  console.info('[agents] processRequest start', {
    sessionId,
    projectRoot: projectRoot || null,
    messageLength: getTextContent(userMessage).length,
    taskComplexity,
    selectedModel: `${modelSelection.provider}/${modelSelection.model}`,
  });

  // Initialize or get state
  const state = stateManager.getOrCreateState(sessionId);
  stateManager.setOriginalRequest(sessionId, getTextContent(userMessage));
  stateManager.setGatheredInfo(sessionId, 'taskComplexity', taskComplexity);
  stateManager.setGatheredInfo(sessionId, 'modelSelection', modelSelection);
  const trustMode = await getTrustMode();
  stateManager.setGatheredInfo(sessionId, 'trustMode', trustMode);

  try {
    const loopProjectRoot = projectRoot || getProjectRootFromState(sessionId);
    const loop = new ChapoLoop(sessionId, sendEvent, loopProjectRoot, modelSelection, {
      selfValidationEnabled: taskComplexity !== 'trivial',
      maxIterations: taskComplexity === 'trivial' ? 8 : 20,
    });
    const loopResult = await loop.run(userMessage, history);

    if (loopResult.status === 'error') {
      stateManager.setPhase(sessionId, 'error');
    }

    return loopResult.answer;
  } catch (error) {
    stateManager.setPhase(sessionId, 'error');
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

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
