/**
 * AnswerValidator — Normalization and routing of CHAPO answers
 *
 * - Hallucination detection (false success claims via tool evidence)
 * - Clarification detection and extraction
 * - Email delivery claim normalization
 */

import type { SessionLogger } from '../audit/sessionLogger.js';
import type { ChapoLoopResult } from './types.js';

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

/**
 * Max answer length for the unbacked-claim check to fire.
 * Long answers (watchlists, formatted reports, code) are content delivery,
 * not false action confirmations. Only short "I did X" style answers need checking.
 */
const CLAIM_CHECK_MAX_LENGTH = 400;

export class AnswerValidator {
  private successfulExternalTools = new Set<string>();

  constructor(
    private sessionLogger?: SessionLogger,
  ) {}

  markExternalToolSuccess(toolName: string): void {
    if (EXTERNAL_ACTION_TOOLS.has(toolName)) {
      this.successfulExternalTools.add(toolName);
    }
  }

  async validateAndNormalize(
    userMessage: string,
    answer: string,
    iteration: number,
    emitDecisionPath: (insights: DecisionPathInsights) => void,
  ): Promise<ChapoLoopResult> {
    let finalAnswer = this.normalizeEmailDeliveryClaims(answer);

    // Detect false success claims when no matching tool was actually called.
    // Only check short answers — long content responses are never false action claims.
    if (this.hasUnbackedExternalClaim(finalAnswer)) {
      finalAnswer = 'I could not reliably verify the execution. There is no confirmed tool run for this action. Want me to try again with verifiable tool execution?';
      console.warn('[answer-validator] Replacing unsafe final answer — external action claimed without tool evidence');
    }

    const unresolvedAssumptions = this.extractAssumptionsFromAnswer(finalAnswer);
    emitDecisionPath({
      path: 'answer',
      reason: 'No further tool calls needed; answer delivered directly.',
      confidence: 0.8,
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

  /**
   * Detect answers that claim external actions (email sent, ticket created)
   * without matching tool evidence.
   *
   * Only fires on SHORT answers (< CLAIM_CHECK_MAX_LENGTH chars).
   * Long answers with formatted content (lists, tables, code blocks) are
   * content delivery, not false action confirmations.
   */
  private hasUnbackedExternalClaim(answer: string): boolean {
    // Long answers are never false action claims — they're content delivery
    if (answer.length > CLAIM_CHECK_MAX_LENGTH) {
      return false;
    }

    const text = answer.toLowerCase();

    // Only match explicit action-completion patterns, not mere word presence
    const claimsAction = /\b(habe .{0,20}(gesendet|erstellt|verschoben|gel.scht)|sent .{0,15}(email|mail|notification)|created .{0,15}(ticket|task|reminder|schedule)|moved .{0,15}(ticket|task)|deleted .{0,15}(ticket|task|reminder|schedule)|e-?mail .{0,15}(gesendet|sent|verschickt)|ticket .{0,15}(erstellt|created|verschoben|moved))\b/.test(text);

    if (!claimsAction) {
      return false;
    }

    return !this.hasMatchingActionEvidence(text);
  }

  private hasMatchingActionEvidence(answerText: string): boolean {
    if (/(e-?mail|email|mail|sent|gesendet|zugestellt)/.test(answerText)) {
      if (this.successfulExternalTools.has('send_email')) {
        return true;
      }
    }

    if (/(taskforge|ticket|task|created|erstellt|moved|verschoben|comment|kommentar)/.test(answerText)) {
      for (const toolName of this.successfulExternalTools) {
        if (toolName.startsWith('taskforge_')) {
          return true;
        }
      }
    }

    if (/(scheduler|reminder|calendar|termin|kalender|erinnerung)/.test(answerText)) {
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
    // German normalization
    normalized = normalized.replace(
      /\bwurde erfolgreich(?:\s+\S+){0,4}\s+gesendet\b/gi,
      'wurde vom E-Mail-Provider zur Zustellung angenommen',
    );
    normalized = normalized.replace(
      /\bist jetzt unterwegs\b/gi,
      'ist beim Provider in der Zustellung',
    );
    // English normalization
    normalized = normalized.replace(
      /\bsuccessfully\s+(?:sent|delivered)\b/gi,
      'accepted by the email provider for delivery',
    );
    return normalized;
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

  private extractAssumptionsFromAnswer(answer: string): string[] {
    const assumptions = new Set<string>();
    const text = answer.toLowerCase();

    if (/(vorausgesetzt|assuming|assume|falls|if )/.test(text)) {
      assumptions.add('Answer contains conditional assumptions.');
    }
    if (/(nicht verifiziert|unverified|unsicher|unclear)/.test(text)) {
      assumptions.add('Parts of the answer are not fully verified.');
    }

    return Array.from(assumptions).slice(0, 3);
  }
}
