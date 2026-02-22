import { nanoid } from 'nanoid';
import type { AgentStreamEvent, ApprovalRequest, ChapoLoopResult, RiskLevel, UserQuestion } from '../types.js';

export class ChapoLoopGateManager {
  constructor(
    private sessionId: string,
    private sendEvent: (event: AgentStreamEvent) => void,
  ) {}

  async queueQuestion(question: string, totalIterations: number): Promise<ChapoLoopResult> {
    const questionPayload: UserQuestion = {
      questionId: nanoid(),
      question,
      fromAgent: 'chapo',
      timestamp: new Date().toISOString(),
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
