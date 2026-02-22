import { afterEach, describe, expect, it, vi } from 'vitest';
import * as stateManager from '../stateManager.js';
import type { ChapoLoopResult, RiskLevel } from '../types.js';
import { ChapoToolExecutor } from './toolExecutor.js';

describe('ChapoToolExecutor', () => {
  const sessionId = 'chapo-tool-executor-test';

  afterEach(() => {
    stateManager.clearAllStates();
  });

  it('stores preflight metadata in gatheredInfo', async () => {
    stateManager.createState(sessionId);
    stateManager.setOriginalRequest(sessionId, 'Please answer in English.');
    stateManager.setActiveTurnId(sessionId, 'turn-preflight');

    const queueQuestion = vi.fn(
      async (_question: string, totalIterations: number): Promise<ChapoLoopResult> => ({
        answer: 'q',
        status: 'waiting_for_user',
        totalIterations,
        question: 'q',
      }),
    );
    const queueApproval = vi.fn(
      async (_description: string, _riskLevel: RiskLevel, totalIterations: number): Promise<ChapoLoopResult> => ({
        answer: 'approval',
        status: 'waiting_for_user',
        totalIterations,
      }),
    );

    const executor = new ChapoToolExecutor({
      sessionId,
      iteration: 0,
      sendEvent: vi.fn(),
      errorHandler: {} as never,
      queueQuestion,
      queueApproval,
      emitDecisionPath: vi.fn(),
      getDelegationRunnerDeps: vi.fn(() => ({} as never)),
      buildVerificationEnvelope: vi.fn(() => 'ok'),
      buildToolResultContent: vi.fn(() => ({ content: 'ok', isError: false })),
      markExternalActionToolSuccess: vi.fn(),
    });

    const outcome = await executor.execute({
      id: 'preflight-1',
      name: 'chapo_answer_preflight',
      arguments: {
        draft: 'All good and complete.',
        strict: true,
      },
    });

    expect(outcome.toolResult?.isError).toBe(false);
    const stored = stateManager.getState(sessionId)?.taskContext.gatheredInfo.chapoAnswerPreflight as {
      turnId?: string;
      checkedAt?: string;
      ok?: boolean;
      score?: number;
      strict?: boolean;
    };
    expect(stored.turnId).toBe('turn-preflight');
    expect(stored.strict).toBe(true);
    expect(typeof stored.checkedAt).toBe('string');
    expect(typeof stored.ok).toBe('boolean');
    expect(typeof stored.score).toBe('number');
  });
});
