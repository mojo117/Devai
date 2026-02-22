/**
 * AnswerValidator — Normalization and routing of CHAPO answers
 *
 * - Clarification detection and extraction
 */

import type { SessionLogger } from '../audit/sessionLogger.js';
import type { ChapoLoopResult } from './types.js';

export interface DecisionPathInsights {
  path: 'answer' | 'delegate_devo' | 'delegate_caio' | 'delegate_scout' | 'tool';
  reason: string;
  confidence: number;
  unresolvedAssumptions: string[];
}

export class AnswerValidator {
  constructor(
    private sessionLogger?: SessionLogger,
  ) {}

  async validateAndNormalize(
    userMessage: string,
    answer: string,
    iteration: number,
    emitDecisionPath: (insights: DecisionPathInsights) => void,
  ): Promise<ChapoLoopResult> {
    emitDecisionPath({
      path: 'answer',
      reason: 'No further tool calls needed; answer delivered directly.',
      confidence: 0.8,
      unresolvedAssumptions: [],
    });

    return {
      answer,
      status: 'completed',
      totalIterations: iteration + 1,
    };
  }

  shouldConvertToAsk(userMessage: string, answer: string): boolean {
    if (!this.isAmbiguousRequest(userMessage)) {
      return false;
    }
    return this.looksLikeClarification(answer);
  }

  extractClarificationQuestion(answer: string): string {
    const trimmed = answer.trim();
    if (!trimmed) {
      return 'Can you be more specific about what you want me to do?';
    }

    const firstQuestion = trimmed.match(/([^\n?]{6,220}\?)/);
    if (firstQuestion?.[1]) {
      return firstQuestion[1].trim().replace(/^[*-]\s*/, '');
    }

    const firstLine = trimmed
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (firstLine && firstLine.endsWith('?')) {
      return firstLine.replace(/^[*-]\s*/, '');
    }

    return 'Can you be more specific about what you want me to do?';
  }

  private isAmbiguousRequest(userMessage: string): boolean {
    const normalized = userMessage.trim().toLowerCase().replace(/\s+/g, ' ');
    const normalizedNoPunctuation = normalized.replace(/[.!?]+$/g, '');
    if (!normalized || normalized.length > 120) {
      return false;
    }

    const explicitAmbiguousPhrases = new Set([
      'mach das besser',
      'mach es besser',
      'make it better',
      'fix it',
      'do it',
    ]);
    if (explicitAmbiguousPhrases.has(normalizedNoPunctuation)) {
      return true;
    }

    const hasVagueVerb = /\b(mach|mache|make|do|fix|improve|optimiere|optimize|update|aendere|change|verbesser|hilf|help)\b/.test(normalized);
    const hasAmbiguousObject = /\b(das|dies|dieses|es|it|this|that|something|anything|alles|everything)\b/.test(normalized);
    const wordCount = normalized.split(/\s+/).length;
    const hasSpecificAnchor = /[`'"]|\/|\\|\.[a-z0-9]{1,6}\b|\b(file|datei|funktion|function|component|api|endpoint|zeile|line|task|ticket)\b|\d/.test(normalized);

    return hasVagueVerb && hasAmbiguousObject && wordCount <= 10 && !hasSpecificAnchor;
  }

  private looksLikeClarification(answer: string): boolean {
    const normalized = answer.trim().toLowerCase();
    if (!normalized || !normalized.includes('?')) {
      return false;
    }

    const extracted = this.extractClarificationQuestion(answer).toLowerCase();
    if (!extracted.endsWith('?')) {
      return false;
    }

    const clarificationCue = /\b(was|welche|welches|wie|meinst du|genau|konkret|kannst du|koenntest du|moechtest du|soll ich|what|which|can you|could you|clarify|specify|details?)\b/;
    if (clarificationCue.test(extracted)) {
      return true;
    }

    return extracted.length > 0 && extracted.length <= 220;
  }

}
