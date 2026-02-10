// apps/api/src/agents/newRouter.ts
/**
 * New Agent Router - Capability-based routing
 *
 * Flow: Analyze -> Route -> Execute -> Synthesize
 */

import { analyzeRequest } from './analyzer/index.js';
import { routeAnalysis } from './deterministicRouter/index.js';
import { synthesizeResponse } from './synthesizer/index.js';
import type { AssignedTask, AgentExecutionResult } from './deterministicRouter/types.js';
import type { SendEventFn } from './router.js';
import { executeAgentTask } from './executor.js';
import { nanoid } from 'nanoid';
import * as stateManager from './stateManager.js';
import type { ApprovalRequest, UserQuestion } from './types.js';
import { config } from '../config.js';

export interface NewProcessRequestOptions {
  sessionId: string;
  userMessage: string;
  projectRoot: string | null;
  sendEvent: SendEventFn;
  conversationHistory?: Array<{ role: string; content: string }>;
}

/**
 * Process a user request through the new capability-based system
 */
export async function processRequestNew(options: NewProcessRequestOptions): Promise<string> {
  const { sessionId, userMessage, projectRoot, sendEvent, conversationHistory = [] } = options;

  // Keep state in sync even when using the new router (used by approval flows / persistence).
  await stateManager.ensureStateLoaded(sessionId);
  stateManager.setOriginalRequest(sessionId, userMessage);

  // Filter history to only valid roles (user/assistant) like legacy router
  const filteredHistory = conversationHistory
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
    }));

  console.info('[newRouter] Processing request', { sessionId, messageLength: userMessage.length });

  // If a continuation approval was granted, bump the executor turn budget for this run.
  const state = stateManager.getState(sessionId);
  const maxTurnsOverride = state?.taskContext.gatheredInfo['newRouterMaxTurnsOverride'];
  const effectiveMaxTurns = typeof maxTurnsOverride === 'number'
    ? maxTurnsOverride
    : config.newAgentExecutorMaxTurns;
  if (typeof maxTurnsOverride === 'number' && state) {
    // One-shot override: clear after consuming to avoid permanently raising the budget.
    delete state.taskContext.gatheredInfo['newRouterMaxTurnsOverride'];
  }

  // Phase 1: Analyze
  sendEvent({ type: 'agent_thinking', agent: 'chapo', status: 'Analysiere Anfrage...' });

  const analyzerResult = await analyzeRequest(userMessage, projectRoot || undefined);

  console.info('[newRouter] Analysis complete', {
    needs: analyzerResult.analysis.needs,
    taskCount: analyzerResult.analysis.tasks.length,
    confidence: analyzerResult.analysis.confidence,
    model: analyzerResult.model,
    durationMs: analyzerResult.durationMs,
  });

  // Phase 2: Route
  const routing = routeAnalysis(analyzerResult.analysis);

  // Handle clarification
  if (routing.type === 'question') {
    const question = routing.question ?? 'Kannst du deine Anfrage genauer beschreiben?';
    const q: UserQuestion = {
      questionId: nanoid(),
      question,
      fromAgent: 'chapo',
      timestamp: new Date().toISOString(),
    };
    stateManager.addPendingQuestion(sessionId, q);
    stateManager.setPhase(sessionId, 'waiting_user');
    sendEvent({ type: 'user_question', question: q });
    await stateManager.flushState(sessionId);
    return question;
  }

  // Handle error
  if (routing.type === 'error') {
    const errorMsg = routing.error ?? 'Unknown routing error';
    sendEvent({ type: 'error', agent: 'chapo', error: errorMsg });
    return `Fehler: ${errorMsg}`;
  }

  // Phase 3: Execute tasks
  const tasks = routing.tasks ?? [];
  if (tasks.length === 0) {
    const fallbackMsg = 'Keine Aufgaben zu bearbeiten.';
    sendEvent({ type: 'error', agent: 'chapo', error: fallbackMsg });
    return fallbackMsg;
  }
  const results = new Map<number, AgentExecutionResult>();

  for (const task of tasks) {
    sendEvent({
      type: 'agent_start',
      agent: task.agent,
      phase: 'execution',
    });
    sendEvent({
      type: 'agent_thinking',
      agent: task.agent,
      status: task.description,
    });

    // Get dependency results
    const dependencyData = task.depends_on !== undefined
      ? results.get(task.depends_on)?.data
      : undefined;

    try {
      const result = await executeAgentTask(task, dependencyData, {
        sessionId,
        projectRoot,
        sendEvent,
        conversationHistory: filteredHistory,
        maxTurns: effectiveMaxTurns,
      });

      results.set(task.index, result);

      // If agent signals uncertainty, ask user
      if (result.uncertain) {
        const reason = result.uncertaintyReason ?? 'Ich bin unsicher, wie ich fortfahren soll. Kannst du mir mehr Kontext geben?';

        // Special-case: executor hit an internal budget. Treat as an approval so "yes" can resume.
        if (result.budgetHit) {
          const budget = result.budgetHit;
          const budgetLabel =
            budget.type === 'turns' ? 'LLM turns' :
            budget.type === 'tool_calls' ? 'tool calls' :
            'time';
          const budgetValue = budget.type === 'time' ? `${budget.used}/${budget.limit}ms` : `${budget.used}/${budget.limit}`;

          const approval: ApprovalRequest = {
            approvalId: nanoid(),
            description:
              `The agent hit an internal budget (${budgetLabel}: ${budgetValue}) while working on:\n` +
              `- ${task.description}\n\n` +
              `Approve to retry this request with a higher limit.`,
            riskLevel: 'low',
            actions: [],
            fromAgent: task.agent,
            timestamp: new Date().toISOString(),
            context: {
              kind: 'new_router_continue',
              maxTurns: config.newAgentExecutorMaxTurnsOnContinue,
              budget,
              taskIndex: task.index,
            },
          };

          stateManager.addPendingApproval(sessionId, approval);
          stateManager.setPhase(sessionId, 'waiting_user');
          sendEvent({ type: 'approval_request', request: approval, sessionId });
          await stateManager.flushState(sessionId);

          return `I hit an internal budget while working on "${task.description}". Use the Continue prompt below to proceed.`;
        }

        const q: UserQuestion = {
          questionId: nanoid(),
          question: reason,
          fromAgent: task.agent,
          timestamp: new Date().toISOString(),
        };
        stateManager.addPendingQuestion(sessionId, q);
        stateManager.setPhase(sessionId, 'waiting_user');
        sendEvent({ type: 'user_question', question: q });
        await stateManager.flushState(sessionId);
        return reason;
      }

      sendEvent({ type: 'agent_complete', agent: task.agent, result: 'done' });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      results.set(task.index, { success: false, error: errorMsg });
      sendEvent({ type: 'error', agent: task.agent, error: errorMsg });
    }
  }

  // Phase 4: Synthesize
  sendEvent({ type: 'agent_thinking', agent: 'chapo', status: 'Erstelle Antwort...' });

  const response = await synthesizeResponse({
    originalRequest: userMessage,
    tasks,
    results,
  });

  sendEvent({ type: 'agent_complete', agent: 'chapo', result: response });

  return response;
}
