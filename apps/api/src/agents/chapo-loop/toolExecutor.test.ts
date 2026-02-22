import { afterEach, describe, expect, it, vi } from 'vitest';
import * as stateManager from '../stateManager.js';
import type { ChapoLoopResult, RiskLevel } from '../types.js';
import { ChapoToolExecutor } from './toolExecutor.js';

describe('ChapoToolExecutor', () => {
  const sessionId = 'chapo-tool-executor-test';

  afterEach(() => {
    stateManager.clearAllStates();
  });

  it('stores plan metadata in gatheredInfo via chapo_plan_set', async () => {
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
      errorHandler: {
        safe: vi.fn(),
        formatForLLM: vi.fn((err: Error) => err.message),
      } as never,
      queueQuestion,
      queueApproval,
      emitDecisionPath: vi.fn(),
      getDelegationRunnerDeps: vi.fn(() => ({} as never)),
      buildVerificationEnvelope: vi.fn(() => 'ok'),
      buildToolResultContent: vi.fn(() => ({ content: 'ok', isError: false })),
      onPartialResponse: vi.fn(),
    });

    const outcome = await executor.execute({
      id: 'plan-1',
      name: 'chapo_plan_set',
      arguments: {
        title: 'Execution plan',
        steps: [
          {
            id: 's1',
            text: 'Inspect logs',
            owner: 'chapo',
            status: 'todo',
          },
        ],
      },
    });

    expect(outcome.toolResult?.isError).toBe(false);
    const stored = stateManager.getState(sessionId)?.taskContext.gatheredInfo.chapoPlan as {
      title?: string;
      steps?: Array<{ id: string; owner: string; status: string }>;
      version?: number;
    };
    expect(stored.title).toBe('Execution plan');
    expect(stored.steps).toHaveLength(1);
    expect(stored.steps?.[0]?.id).toBe('s1');
    expect(stored.version).toBe(1);
  });
});
