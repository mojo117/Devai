// apps/api/src/agents/synthesizer/index.ts
import { llmRouter } from '../../llm/router.js';
import { SYNTHESIZER_SYSTEM_PROMPT, SYNTHESIZER_USER_TEMPLATE } from './prompt.js';
import type { AgentExecutionResult } from '../deterministicRouter/types.js';
import type { AssignedTask } from '../deterministicRouter/types.js';

export interface SynthesizerInput {
  originalRequest: string;
  tasks: AssignedTask[];
  results: Map<number, AgentExecutionResult>;
}

/**
 * Synthesize agent results into a user-facing response
 */
export async function synthesizeResponse(input: SynthesizerInput): Promise<string> {
  const { originalRequest, tasks, results } = input;

  // If only one successful result with simple data, return directly
  if (tasks.length === 1 && results.size === 1) {
    const result = results.get(0);
    if (result?.success && typeof result.data === 'string') {
      return result.data;
    }
  }

  // Prepare results for synthesis
  const resultsArray = tasks.map((task) => {
    const result = results.get(task.index);
    return {
      task: task.description,
      success: result?.success ?? false,
      data: result?.data,
      error: result?.error,
    };
  });

  // Check if all failed
  const allFailed = resultsArray.every(r => !r.success);
  if (allFailed) {
    const errors = resultsArray.map(r => r.error).filter(Boolean).join(', ');
    return `Es ist ein Fehler aufgetreten: ${errors}`;
  }

  try {
    const response = await llmRouter.generate('anthropic', {
      model: 'claude-sonnet-4-20250514',
      messages: [
        { role: 'user', content: SYNTHESIZER_USER_TEMPLATE(originalRequest, resultsArray) },
      ],
      systemPrompt: SYNTHESIZER_SYSTEM_PROMPT,
      maxTokens: 2048,
    });

    return response.content;
  } catch (error) {
    // Fallback: return raw results
    console.error('[synthesizer] LLM failed, returning raw results', error);
    return resultsArray
      .filter(r => r.success)
      .map(r => `${r.task}: ${JSON.stringify(r.data)}`)
      .join('\n\n');
  }
}
