/**
 * Reflexion — fast self-review of CHAPO answers before delivery.
 *
 * Uses the fast model to evaluate whether an answer actually addresses
 * the user's question. Fires once per answer, only for non-trivial responses.
 */

import { llmRouter } from '../llm/router.js';
import type { LLMProvider } from '../llm/types.js';

export interface ReflexionResult {
  approved: boolean;
  feedback?: string;
}

const REFLEXION_PROMPT = `You are a quality reviewer. The user asked a question and an AI assistant generated an answer.

Evaluate the answer on these criteria:
1. Does it actually answer the question? (not just related information)
2. Are there factual claims that seem wrong or hallucinated?
3. Is important information missing that the user clearly needs?
4. Is the answer coherent and well-structured?

If the answer is acceptable, respond with exactly: APPROVED
If there are issues, respond with: ISSUES: <brief description of what's wrong>

Be strict but fair. Minor style issues are not worth flagging.`;

/**
 * Quick self-review of an answer before delivering to the user.
 * Uses the fast model to minimize latency and cost.
 */
export async function reviewAnswer(
  userQuery: string,
  answer: string,
  provider: LLMProvider,
  fastModel?: string,
): Promise<ReflexionResult> {
  // Skip for very short answers (confirmations, status updates)
  if (answer.length < 200) {
    return { approved: true };
  }

  const model = fastModel || 'glm-4.7-flash';

  try {
    const response = await llmRouter.generateWithFallback(provider, {
      model,
      messages: [
        {
          role: 'user',
          content: `User question: ${userQuery.slice(0, 1000)}\n\nAssistant answer:\n${answer.slice(0, 3000)}`,
        },
      ],
      systemPrompt: REFLEXION_PROMPT,
      maxTokens: 256,
    });

    const text = response.content.trim();

    if (text.startsWith('APPROVED')) {
      return { approved: true };
    }

    // Extract feedback after "ISSUES:"
    const issueMatch = text.match(/ISSUES:\s*(.*)/s);
    if (issueMatch) {
      return { approved: false, feedback: issueMatch[1].trim() };
    }

    // Ambiguous response -> approve (don't block on parsing issues)
    return { approved: true };
  } catch {
    // Reflexion failed -> don't block the answer
    console.warn('[reflexion] Self-review failed, approving by default');
    return { approved: true };
  }
}
