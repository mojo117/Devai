import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../config.js';
import * as stateManager from '../stateManager.js';
import { ChapoLoopGateManager } from './gateManager.js';

describe('ChapoLoopGateManager', () => {
  const sessionId = 'gate-manager-test';
  const originalDedup = config.gateQuestionDedup;
  const originalTtl = config.gateQuestionTtlMs;

  beforeEach(() => {
    config.gateQuestionDedup = true;
    config.gateQuestionTtlMs = 600000;
    stateManager.clearAllStates();
    stateManager.createState(sessionId);
    stateManager.setActiveTurnId(sessionId, 'turn-1');
  });

  afterEach(() => {
    config.gateQuestionDedup = originalDedup;
    config.gateQuestionTtlMs = originalTtl;
    stateManager.clearAllStates();
  });

  it('deduplicates repeated continue questions with same fingerprint', async () => {
    const sendEvent = vi.fn((event: { type: string; question?: unknown }) => {
      if (event.type === 'user_question' && event.question) {
        stateManager.addPendingQuestion(sessionId, event.question as never);
      }
    });
    const manager = new ChapoLoopGateManager(sessionId, sendEvent as never);

    await manager.queueQuestion('Soll ich weitermachen?', 5, {
      kind: 'continue',
      turnId: 'turn-1',
      fingerprint: 'continue:turn-1:same',
    });
    await manager.queueQuestion('Soll ich weitermachen?', 6, {
      kind: 'continue',
      turnId: 'turn-1',
      fingerprint: 'continue:turn-1:same',
    });

    expect(sendEvent).toHaveBeenCalledTimes(1);
    expect(stateManager.getPendingQuestions(sessionId)).toHaveLength(1);
  });

  it('drops expired question and queues a new one', async () => {
    stateManager.addPendingQuestion(sessionId, {
      questionId: 'old-q',
      question: 'Soll ich weitermachen?',
      fromAgent: 'chapo',
      timestamp: new Date(Date.now() - 60_000).toISOString(),
      turnId: 'turn-1',
      questionKind: 'continue',
      fingerprint: 'continue:turn-1:same',
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });

    const sendEvent = vi.fn((event: { type: string; question?: unknown }) => {
      if (event.type === 'user_question' && event.question) {
        stateManager.addPendingQuestion(sessionId, event.question as never);
      }
    });
    const manager = new ChapoLoopGateManager(sessionId, sendEvent as never);

    await manager.queueQuestion('Soll ich weitermachen?', 7, {
      kind: 'continue',
      turnId: 'turn-1',
      fingerprint: 'continue:turn-1:same',
    });

    const pending = stateManager.getPendingQuestions(sessionId);
    expect(sendEvent).toHaveBeenCalledTimes(1);
    expect(pending).toHaveLength(1);
    expect(pending[0].questionId).not.toBe('old-q');
  });
});
