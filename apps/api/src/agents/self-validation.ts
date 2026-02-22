// ──────────────────────────────────────────────
// Agent Self-Validation (Inner Monologue)
// The AI checks its own work before delivering.
// ──────────────────────────────────────────────

import type { ValidationResult } from './types.js';
import type { LLMProvider, GenerateResponse } from '../llm/types.js';
import { llmRouter } from '../llm/router.js';

import { VALIDATION_SYSTEM_PROMPT } from '../prompts/self-validation.js';

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
