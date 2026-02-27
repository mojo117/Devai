/**
 * Reflexion — fast self-review of CHAPO answers before delivery.
 *
 * Uses the fast model to evaluate whether an answer actually addresses
 * the user's question. Fires once per answer, only for non-trivial responses.
 */

import { llmRouter } from '../llm/router.js';
import type { LLMProvider } from '../llm/types.js';

export interface ReflexionIssue {
  description: string;
}

export interface ReflexionResult {
  approved: boolean;
  feedback?: string;
  issues?: ReflexionIssue[];
}

const REFLEXION_PROMPT = `You are a quality reviewer. The user asked a question and an AI assistant generated an answer.

Evaluate the answer on these criteria:
1. Does it actually answer the question? (not just related information)
2. Are there factual claims that seem wrong or hallucinated?
3. Is important information missing that the user clearly needs?
4. Is the answer coherent and well-structured?

If the answer is acceptable, respond with exactly: APPROVED

If there are issues, respond in this format:
ISSUES:
- <specific problem 1>
- <specific problem 2>
- <specific problem 3>

Be strict but fair. Minor style issues are not worth flagging.
Respond in the same language as the user's question (German or English).`;

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

  const model = fastModel || 'kimi-k2.5';

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

    // Extract bullet points after "ISSUES:"
    const issuesMatch = text.match(/ISSUES:\s*\n([\s\S]*)/i);
    if (issuesMatch) {
      const issuesText = issuesMatch[1];
      // Parse bullet points (- item or * item)
      const bulletPoints = issuesText
        .split(/\n/)
        .map(line => line.trim())
        .filter(line => line.startsWith('-') || line.startsWith('*'))
        .map(line => line.replace(/^[-*]\s*/, '').trim())
        .filter(line => line.length > 0);

      if (bulletPoints.length > 0) {
        const issues: ReflexionIssue[] = bulletPoints.map(desc => ({ description: desc }));
        const feedback = `Issues to fix:\n${bulletPoints.map(b => `- ${b}`).join('\n')}`;
        console.log(`[reflexion] Found ${issues.length} issues: ${bulletPoints.join(', ')}`);
        return { approved: false, feedback, issues };
      }

      // Fallback: use the raw text as feedback
      return { approved: false, feedback: issuesText.trim() };
    }

    // Ambiguous response -> approve (don't block on parsing issues)
    return { approved: true };
  } catch {
    // Reflexion failed -> don't block the answer
    console.warn('[reflexion] Self-review failed, approving by default');
    return { approved: true };
  }
}
