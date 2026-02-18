// ──────────────────────────────────────────────
// Looper-AI  –  Self-Validation (Inner Monologue)
// The AI checks its own work before delivering.
// ──────────────────────────────────────────────

import type { ValidationResult } from '@devai/shared';
import type { LLMProvider, GenerateResponse } from '../llm/types.js';
import { llmRouter } from '../llm/router.js';

export const VALIDATION_SYSTEM_PROMPT = `You are a quality-assurance reviewer for an AI assistant called Chapo.
Your job is to evaluate a proposed answer BEFORE it is sent to the user.

Evaluate the following criteria:
1. COMPLETENESS – Does the answer fully address the user's request?
2. ACCURACY – Are there factual errors or hallucinations?
3. SAFETY – Does the answer suggest anything harmful or insecure?
4. CLARITY – Is the answer well-structured and easy to understand?

Respond ONLY with valid JSON in this exact format (no markdown fences):
{
  "isComplete": true/false,
  "confidence": 0.0-1.0,
  "issues": ["issue 1", "issue 2"],
  "suggestion": "optional improvement hint"
}`;

export class SelfValidator {
  constructor(private provider: LLMProvider) {}

  /**
   * Ask the LLM to review its own draft answer.
   * Returns a structured validation result.
   */
  async validate(
    userRequest: string,
    proposedAnswer: string,
    conversationContext?: string
  ): Promise<ValidationResult> {
    const prompt = this.buildValidationPrompt(userRequest, proposedAnswer, conversationContext);

    let response: GenerateResponse;
    try {
      response = await llmRouter.generate(this.provider, {
        messages: [{ role: 'user', content: prompt }],
        systemPrompt: VALIDATION_SYSTEM_PROMPT,
        maxTokens: 500,
      });
    } catch {
      // If validation itself fails, assume OK so we don't block the user.
      return { isComplete: true, confidence: 0.5, issues: ['Validation unavailable'] };
    }

    return this.parseValidationResponse(response.content);
  }

  private buildValidationPrompt(
    userRequest: string,
    proposedAnswer: string,
    context?: string
  ): string {
    const parts: string[] = [];

    if (context) {
      parts.push(`## Conversation Context\n${context}`);
    }

    parts.push(`## User Request\n${userRequest}`);
    parts.push(`## Proposed Answer\n${proposedAnswer}`);
    parts.push('## Your Evaluation\nProvide your JSON evaluation now.');

    return parts.join('\n\n');
  }

  private parseValidationResponse(raw: string): ValidationResult {
    try {
      // Try to extract JSON from the response
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.fallbackResult(raw);
      }
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        isComplete: Boolean(parsed.isComplete),
        confidence: typeof parsed.confidence === 'number'
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.5,
        issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
        suggestion: parsed.suggestion ? String(parsed.suggestion) : undefined,
      };
    } catch {
      return this.fallbackResult(raw);
    }
  }

  private fallbackResult(raw: string): ValidationResult {
    // If parsing fails, use heuristics on the raw text
    const lower = raw.toLowerCase();
    const isComplete = !lower.includes('incomplete') && !lower.includes('missing');
    return {
      isComplete,
      confidence: 0.6,
      issues: ['Could not parse structured validation – used heuristic fallback'],
      suggestion: raw.slice(0, 200),
    };
  }
}
