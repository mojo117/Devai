import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StateProjection } from './stateProjection.js';
import { createEvent } from '../events/envelope.js';
import type { EventContext } from '../events/envelope.js';
import {
  AGENT_STARTED,
  AGENT_DELEGATED,
  AGENT_SWITCHED,
  GATE_QUESTION_QUEUED,
  GATE_APPROVAL_QUEUED,
  GATE_QUESTION_RESOLVED,
  GATE_APPROVAL_RESOLVED,
  WF_TURN_STARTED,
  WF_FAILED,
} from '../events/catalog.js';

// Mock stateManager
vi.mock('../../agents/stateManager.js', () => ({
  setPhase: vi.fn(),
  setActiveAgent: vi.fn(),
  addPendingQuestion: vi.fn(),
  addPendingApproval: vi.fn(),
  flushState: vi.fn().mockResolvedValue(undefined),
  setOriginalRequest: vi.fn(),
  setGatheredInfo: vi.fn(),
}));

import * as stateManager from '../../agents/stateManager.js';

function makeCtx(overrides?: Partial<EventContext>): EventContext {
  return {
    sessionId: 'sess-1',
    requestId: 'req-1',
    turnId: 'turn-1',
    ...overrides,
  };
}

describe('StateProjection', () => {
  let projection: StateProjection;

  beforeEach(() => {
    projection = new StateProjection();
    vi.clearAllMocks();
  });

  // ── AC-1: AGENT_STARTED sets phase and active agent ────────────

  it('sets phase and active agent on AGENT_STARTED', async () => {
    const event = createEvent(makeCtx(), AGENT_STARTED, {
      agent: 'chapo',
      phase: 'execution',
    });

    await projection.handle(event);

    expect(stateManager.setPhase).toHaveBeenCalledWith('sess-1', 'execution');
    expect(stateManager.setActiveAgent).toHaveBeenCalledWith('sess-1', 'chapo');
  });

  // ── AC-2: AGENT_SWITCHED sets active agent ─────────────────────

  it('sets active agent on AGENT_SWITCHED', async () => {
    const event = createEvent(makeCtx(), AGENT_SWITCHED, {
      from: 'chapo',
      to: 'devo',
      reason: 'delegation',
    });

    await projection.handle(event);

    expect(stateManager.setActiveAgent).toHaveBeenCalledWith('sess-1', 'devo');
  });

  it('stores delegation metadata on AGENT_DELEGATED', async () => {
    const event = createEvent(makeCtx(), AGENT_DELEGATED, {
      from: 'chapo',
      to: 'caio',
      task: 'Sende Kundenmail',
      domain: 'communication',
      objective: 'Kunden ueber Status informieren',
      constraints: ['kurz'],
      expectedOutcome: 'Mail mit klarem Status versendet',
    });

    await projection.handle(event);

    expect(stateManager.setGatheredInfo).toHaveBeenCalledWith(
      'sess-1',
      'lastDelegation',
      expect.objectContaining({
        from: 'chapo',
        to: 'caio',
        domain: 'communication',
        objective: 'Kunden ueber Status informieren',
      }),
    );
  });

  // ── AC-3: GATE_QUESTION_QUEUED adds question and flushes ───────

  it('adds pending question, sets phase, and flushes on GATE_QUESTION_QUEUED', async () => {
    const event = createEvent(makeCtx(), GATE_QUESTION_QUEUED, {
      questionId: 'q-1',
      question: 'What file?',
      fromAgent: 'chapo',
    });

    await projection.handle(event);

    expect(stateManager.addPendingQuestion).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      questionId: 'q-1',
      question: 'What file?',
      fromAgent: 'chapo',
    }));
    expect(stateManager.setPhase).toHaveBeenCalledWith('sess-1', 'waiting_user');
    expect(stateManager.flushState).toHaveBeenCalledWith('sess-1');
  });

  // ── AC-4: GATE_APPROVAL_QUEUED adds approval and flushes ──────

  it('adds pending approval, sets phase, and flushes on GATE_APPROVAL_QUEUED', async () => {
    const event = createEvent(makeCtx(), GATE_APPROVAL_QUEUED, {
      approvalId: 'a-1',
      description: 'Write file.ts',
      riskLevel: 'low',
    });

    await projection.handle(event);

    expect(stateManager.addPendingApproval).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      approvalId: 'a-1',
      description: 'Write file.ts',
    }));
    expect(stateManager.setPhase).toHaveBeenCalledWith('sess-1', 'waiting_user');
    expect(stateManager.flushState).toHaveBeenCalledWith('sess-1');
  });

  // ── AC-5: Gate RESOLUTION events are NOT handled ───────────────

  it('does NOT handle GATE_QUESTION_RESOLVED (handled by router directly)', async () => {
    const event = createEvent(makeCtx(), GATE_QUESTION_RESOLVED, {
      questionId: 'q-1',
      answer: 'yes',
    });

    await projection.handle(event);

    // No stateManager calls should happen
    expect(stateManager.setPhase).not.toHaveBeenCalled();
    expect(stateManager.setActiveAgent).not.toHaveBeenCalled();
  });

  it('does NOT handle GATE_APPROVAL_RESOLVED', async () => {
    const event = createEvent(makeCtx(), GATE_APPROVAL_RESOLVED, {
      approvalId: 'a-1',
      approved: true,
    });

    await projection.handle(event);

    expect(stateManager.setPhase).not.toHaveBeenCalled();
  });

  // ── AC-6: WF_TURN_STARTED sets original request ───────────────

  it('sets original request on WF_TURN_STARTED', async () => {
    const event = createEvent(makeCtx(), WF_TURN_STARTED, {
      userMessage: 'Fix the bug',
    });

    await projection.handle(event);

    expect(stateManager.setOriginalRequest).toHaveBeenCalledWith('sess-1', 'Fix the bug');
  });

  // ── AC-7: WF_FAILED sets error phase ──────────────────────────

  it('sets error phase on WF_FAILED', async () => {
    const event = createEvent(makeCtx(), WF_FAILED, {
      error: 'Something broke',
      agent: 'system',
      recoverable: false,
    });

    await projection.handle(event);

    expect(stateManager.setPhase).toHaveBeenCalledWith('sess-1', 'error');
  });

  // ── AC-8: Unhandled events are silently ignored ────────────────

  it('ignores events not in the switch statement', async () => {
    const event = createEvent(makeCtx(), 'unknown.event', { data: 'test' });

    await projection.handle(event);

    // No stateManager calls
    expect(stateManager.setPhase).not.toHaveBeenCalled();
    expect(stateManager.setActiveAgent).not.toHaveBeenCalled();
    expect(stateManager.setOriginalRequest).not.toHaveBeenCalled();
  });
});
