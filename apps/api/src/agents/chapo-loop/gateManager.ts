import { nanoid } from 'nanoid';
import type { AgentStreamEvent, ApprovalRequest, ChapoLoopResult, RiskLevel, UserQuestion } from '../types.js';
import * as stateManager from '../stateManager.js';
import { config } from '../../config.js';

export interface QueueQuestionOptions {
  kind?: 'continue' | 'clarification' | 'generic';
  turnId?: string;
  fingerprint?: string;
  ttlMs?: number;
}

function normalizeFingerprint(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?,;:]+$/g, '');
}

function getExpiresAt(ttlMs: number): string | undefined {
  if (ttlMs <= 0) return undefined;
  return new Date(Date.now() + ttlMs).toISOString();
}

function isExpired(question: UserQuestion): boolean {
  if (!question.expiresAt) return false;
  const expiresAt = Date.parse(question.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

export class ChapoLoopGateManager {
  constructor(
    private sessionId: string,
    private sendEvent: (event: AgentStreamEvent) => void,
  ) {}

  private pruneExpiredQuestions(): void {
    const pending = stateManager.getPendingQuestions(this.sessionId);
    for (const item of pending) {
      if (isExpired(item)) {
        stateManager.removePendingQuestion(this.sessionId, item.questionId);
      }
    }
  }

  async queueQuestion(
    question: string,
    totalIterations: number,
    options: QueueQuestionOptions = {},
  ): Promise<ChapoLoopResult> {
    this.pruneExpiredQuestions();

    const questionKind = options.kind || 'generic';
    const turnId = options.turnId || stateManager.getActiveTurnId(this.sessionId) || undefined;
    const ttlMs = Math.max(0, options.ttlMs ?? config.gateQuestionTtlMs);
    const fingerprint = options.fingerprint || normalizeFingerprint(
      `${questionKind}:${turnId || 'na'}:${question}`,
    );

    if (questionKind === 'continue' && config.gateQuestionDedup) {
      const existing = stateManager.getPendingQuestions(this.sessionId).find((item) => {
        if (item.questionKind !== 'continue') return false;
        if (item.fingerprint !== fingerprint) return false;
        if (turnId && item.turnId && item.turnId !== turnId) return false;
        if (isExpired(item)) return false;
        return true;
      });
      if (existing) {
        return {
          answer: existing.question,
          status: 'waiting_for_user',
          totalIterations,
          question: existing.question,
        };
      }
    }

    const questionPayload: UserQuestion = {
      questionId: nanoid(),
      question,
      fromAgent: 'chapo',
      timestamp: new Date().toISOString(),
      turnId,
      questionKind,
      fingerprint,
      expiresAt: questionKind === 'continue' ? getExpiresAt(ttlMs) : undefined,
    };
    // State mutation + WS emission handled by projections via the event bus bridge:
    //   sendEvent → bridge → gate.question.queued → StateProjection + StreamProjection
    this.sendEvent({ type: 'user_question', question: questionPayload });

    return {
      answer: question,
      status: 'waiting_for_user',
      totalIterations,
      question,
    };
  }

  async queueApproval(
    description: string,
    riskLevel: RiskLevel,
    totalIterations: number,
  ): Promise<ChapoLoopResult> {
    const approval: ApprovalRequest = {
      approvalId: nanoid(),
      description,
      riskLevel,
      actions: [],
      fromAgent: 'chapo',
      timestamp: new Date().toISOString(),
    };
    // State mutation + WS emission handled by projections via the event bus bridge:
    //   sendEvent → bridge → gate.approval.queued → StateProjection + StreamProjection
    this.sendEvent({
      type: 'approval_request',
      request: approval,
      sessionId: this.sessionId,
    });

    return {
      answer: description,
      status: 'waiting_for_user',
      totalIterations,
      question: description,
    };
  }
}
