/**
 * AnswerValidator — Validation and normalization of CHAPO answers
 *
 * Extracted from ChapoLoop to separate concerns:
 * - Self-validation via SelfValidator
 * - Hallucination detection (false success claims)
 * - Clarification detection and extraction
 * - Email delivery claim normalization
 */

import type { SelfValidator } from './self-validation.js';
import type { SessionLogger } from '../audit/sessionLogger.js';
import type { AgentErrorHandler } from './error-handler.js';
import type { ChapoLoopResult, SessionObligation, ValidationResult } from './types.js';

export interface DecisionPathInsights {
  path: 'answer' | 'delegate_devo' | 'delegate_caio' | 'delegate_scout' | 'tool';
  reason: string;
  confidence: number;
  unresolvedAssumptions: string[];
}

const EXTERNAL_ACTION_TOOLS = new Set([
  'send_email',
  'taskforge_create_task',
  'taskforge_move_task',
  'taskforge_add_comment',
  'scheduler_create',
  'scheduler_update',
  'scheduler_delete',
  'reminder_create',
  'notify_user',
]);

const OBLIGATION_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'about', 'then', 'also',
  'und', 'oder', 'dann', 'aber', 'eine', 'einen', 'einem', 'einer', 'dies', 'diese',
  'bitte', 'sowie', 'bzw', 'oder', 'der', 'die', 'das', 'den', 'dem',
  'task', 'tasks', 'request', 'delegation', 'to', 'von',
]);

export class AnswerValidator {
  private successfulExternalTools = new Set<string>();

  constructor(
    private selfValidator: SelfValidator,
    private config: { selfValidationEnabled: boolean },
    private sessionLogger?: SessionLogger,
  ) {}

  markExternalToolSuccess(toolName: string): void {
    if (EXTERNAL_ACTION_TOOLS.has(toolName)) {
      this.successfulExternalTools.add(toolName);
    }
  }

  async evaluateObligationCoverage(
    obligations: SessionObligation[],
    answer: string,
  ): Promise<{
    resolvedIds: string[];
    unresolved: SessionObligation[];
    confidence: number;
  }> {
    if (obligations.length === 0) {
      return { resolvedIds: [], unresolved: [], confidence: 1 };
    }

    const resolvedIds: string[] = [];
    const unresolved: SessionObligation[] = [];
    const answerLower = answer.toLowerCase();

    for (const obligation of obligations) {
      // Delegation obligations must be resolved by delegation results,
      // not by optimistic final-answer wording.
      if (obligation.type === 'delegation') {
        unresolved.push(obligation);
        continue;
      }

      if (this.obligationLooksAddressed(obligation, answerLower)) {
        resolvedIds.push(obligation.obligationId);
      } else {
        unresolved.push(obligation);
      }
    }

    const confidence = obligations.length > 0
      ? Math.max(0.1, Math.min(1, resolvedIds.length / obligations.length))
      : 1;
    return { resolvedIds, unresolved, confidence };
  }

  async validateAndNormalize(
    userMessage: string,
    answer: string,
    iteration: number,
    emitDecisionPath: (insights: DecisionPathInsights) => void,
    errorHandler: AgentErrorHandler,
  ): Promise<ChapoLoopResult> {
    let finalAnswer = answer;
    let validationResult: ValidationResult | undefined;

    if (this.config.selfValidationEnabled && answer.length > 20) {
      const [validation] = await errorHandler.safe('validation', () =>
        this.selfValidator.validate(userMessage, answer),
      );

      if (validation) {
        validationResult = validation;
        this.sessionLogger?.logAgentEvent({
          type: 'validation',
          confidence: validation.confidence,
          issues: validation.issues,
          isComplete: validation.isComplete,
        });

        if (!validation.isComplete && validation.confidence < 0.4 && validation.suggestion) {
          console.info('[chapo-loop] Self-validation flagged low confidence', {
            confidence: validation.confidence,
            issues: validation.issues,
          });
        }

        // Prevent known false-success claims (e.g. "email sent") from being returned
        // when validation already detected hallucination-like issues.
        if (this.shouldReplaceWithSafeFallback(validation, answer)) {
          finalAnswer = 'Ich konnte die Ausfuehrung nicht verlaesslich verifizieren. Es liegt kein bestaetigter Tool-Lauf fuer diese Aktion vor. Wenn du willst, fuehre ich den Schritt jetzt erneut mit nachvollziehbarer Tool-Ausfuehrung aus.';
          console.warn('[chapo-loop] Replacing unsafe final answer after failed validation', {
            confidence: validation.confidence,
            issues: validation.issues,
          });
        }
      }
    }

    finalAnswer = this.normalizeEmailDeliveryClaims(finalAnswer);
    const confidence = validationResult?.confidence ?? 0.8;
    const unresolvedAssumptions = this.extractAssumptionsFromAnswer(finalAnswer, validationResult);
    emitDecisionPath({
      path: 'answer',
      reason: 'Keine weiteren Tool-Calls notwendig; Antwort wurde direkt geliefert.',
      confidence,
      unresolvedAssumptions,
    });

    return {
      answer: finalAnswer,
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
      return 'Kannst du genauer sagen, was ich verbessern soll?';
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

    return 'Kannst du genauer sagen, was ich verbessern soll?';
  }

  private shouldReplaceWithSafeFallback(validation: ValidationResult, answer: string): boolean {
    if (validation.isComplete || validation.confidence >= 0.4) {
      return false;
    }

    const issuesText = validation.issues.join(' ').toLowerCase();
    const answerText = answer.toLowerCase();

    const mentionsHallucination = /(halluz|halluc|falsch|faelsch|erfind|behauptet|invented)/.test(issuesText);
    if (!mentionsHallucination) {
      return false;
    }

    // Focus on side-effect claims where false positives are costly for users.
    const claimsExternalAction = /(e-?mail|email|gesendet|zugestellt|ticket|erstellt|verschoben|notification|benachrichtigung|scheduler)/.test(answerText);
    if (!claimsExternalAction) {
      return false;
    }

    return !this.hasMatchingActionEvidence(answerText);
  }

  private hasMatchingActionEvidence(answerText: string): boolean {
    if (/(e-?mail|email|mail|gesendet|zugestellt)/.test(answerText)) {
      if (this.successfulExternalTools.has('send_email')) {
        return true;
      }
    }

    if (/(taskforge|ticket|aufgabe|task|erstellt|verschoben|kommentar)/.test(answerText)) {
      for (const toolName of this.successfulExternalTools) {
        if (toolName.startsWith('taskforge_')) {
          return true;
        }
      }
    }

    if (/(scheduler|termin|kalender|reminder|erinnerung)/.test(answerText)) {
      if (
        this.successfulExternalTools.has('scheduler_create')
        || this.successfulExternalTools.has('scheduler_update')
        || this.successfulExternalTools.has('scheduler_delete')
        || this.successfulExternalTools.has('reminder_create')
      ) {
        return true;
      }
    }

    if (/(notification|benachrichtigung|notify)/.test(answerText)) {
      if (this.successfulExternalTools.has('notify_user')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Keep wording honest: `send_email` confirms provider acceptance, not guaranteed inbox placement.
   */
  private normalizeEmailDeliveryClaims(answer: string): string {
    if (!this.successfulExternalTools.has('send_email')) {
      return answer;
    }

    let normalized = answer;
    normalized = normalized.replace(
      /\bwurde erfolgreich(?:\s+\S+){0,4}\s+gesendet\b/gi,
      'wurde vom E-Mail-Provider zur Zustellung angenommen',
    );
    normalized = normalized.replace(
      /\bist jetzt unterwegs\b/gi,
      'ist beim Provider in der Zustellung',
    );
    return normalized;
  }

  private obligationLooksAddressed(obligation: SessionObligation, answerLower: string): boolean {
    const source = (obligation.requiredOutcome || obligation.description || '').toLowerCase();
    const keywords = source
      .split(/[^a-z0-9äöüß]+/i)
      .map((word) => word.trim())
      .filter((word) => word.length >= 4)
      .filter((word) => !OBLIGATION_STOPWORDS.has(word))
      .slice(0, 8);

    if (keywords.length === 0) {
      return false;
    }

    const matched = keywords.filter((keyword) => answerLower.includes(keyword)).length;
    if (keywords.length <= 2) {
      return matched >= 1;
    }
    return matched >= Math.max(2, Math.ceil(keywords.length * 0.4));
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

  private extractAssumptionsFromAnswer(answer: string, validation?: ValidationResult): string[] {
    const assumptions = new Set<string>();
    const text = answer.toLowerCase();

    if (validation) {
      for (const issue of validation.issues.slice(0, 3)) {
        if (issue.trim().length > 0) assumptions.add(issue.trim());
      }
    }

    if (/(vorausgesetzt|assuming|assume|falls|if )/.test(text)) {
      assumptions.add('Antwort enthaelt bedingte Annahmen.');
    }
    if (/(nicht verifiziert|unverified|unsicher|unclear)/.test(text)) {
      assumptions.add('Teile der Antwort sind nicht final verifiziert.');
    }

    return Array.from(assumptions).slice(0, 3);
  }
}
