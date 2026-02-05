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

export interface NewProcessRequestOptions {
  sessionId: string;
  userMessage: string;
  projectRoot: string | null;
  sendEvent: SendEventFn;
}

/**
 * Process a user request through the new capability-based system
 */
export async function processRequestNew(options: NewProcessRequestOptions): Promise<string> {
  const { sessionId, userMessage, projectRoot, sendEvent } = options;

  console.info('[newRouter] Processing request', { sessionId, messageLength: userMessage.length });

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
    sendEvent({
      type: 'user_question',
      question: {
        questionId: sessionId,
        question: routing.question!,
        fromAgent: 'chapo',
        timestamp: new Date().toISOString(),
      },
    });
    return routing.question!;
  }

  // Handle error
  if (routing.type === 'error') {
    sendEvent({ type: 'error', agent: 'chapo', error: routing.error! });
    return `Fehler: ${routing.error}`;
  }

  // Phase 3: Execute tasks
  const tasks = routing.tasks!;
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
      });

      results.set(task.index, result);

      // If agent signals uncertainty, ask user
      if (result.uncertain) {
        sendEvent({
          type: 'user_question',
          question: {
            questionId: `${sessionId}-${task.index}`,
            question: result.uncertaintyReason!,
            fromAgent: task.agent,
            timestamp: new Date().toISOString(),
          },
        });
        return result.uncertaintyReason!;
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
