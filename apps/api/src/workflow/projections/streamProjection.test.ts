import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamProjection } from './streamProjection.js';
import { createEvent } from '../events/envelope.js';
import type { EventContext } from '../events/envelope.js';
import {
  AGENT_STARTED,
  AGENT_DELEGATED,
  AGENT_SWITCHED,
  TOOL_CALL_STARTED,
  GATE_QUESTION_QUEUED,
  WF_COMPLETED,
  WF_FAILED,
} from '../events/catalog.js';

// Mock chatGateway
vi.mock('../../websocket/chatGateway.js', () => ({
  emitChatEvent: vi.fn(),
}));

import { emitChatEvent } from '../../websocket/chatGateway.js';

function makeCtx(overrides?: Partial<EventContext>): EventContext {
  return {
    sessionId: 'sess-1',
    requestId: 'req-1',
    turnId: 'turn-1',
    ...overrides,
  };
}

describe('StreamProjection', () => {
  let projection: StreamProjection;

  beforeEach(() => {
    projection = new StreamProjection();
    vi.clearAllMocks();
  });

  // ── AC-1: Domain events map to WS stream events ───────────────

  it('maps AGENT_STARTED to agent_start WS event', () => {
    const event = createEvent(makeCtx(), AGENT_STARTED, {
      agent: 'chapo',
      phase: 'execution',
    });

    projection.handle(event);

    expect(emitChatEvent).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      type: 'agent_start',
      agent: 'chapo',
      phase: 'execution',
      requestId: 'req-1',
    }));
  });

  it('maps AGENT_SWITCHED to agent_switch WS event', () => {
    const event = createEvent(makeCtx(), AGENT_SWITCHED, {
      from: 'chapo',
      to: 'devo',
      reason: 'delegation',
    });

    projection.handle(event);

    expect(emitChatEvent).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      type: 'agent_switch',
      from: 'chapo',
      to: 'devo',
    }));
  });

  it('maps AGENT_DELEGATED with delegation contract metadata', () => {
    const event = createEvent(makeCtx(), AGENT_DELEGATED, {
      from: 'chapo',
      to: 'caio',
      task: 'Sende Update an den Kunden',
      domain: 'communication',
      objective: 'Kundenstatus-Update senden',
      constraints: ['formal', 'kurz'],
      expectedOutcome: 'Kunde hat eine klare Statusmail',
    });

    projection.handle(event);

    expect(emitChatEvent).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      type: 'delegation',
      from: 'chapo',
      to: 'caio',
      task: 'Sende Update an den Kunden',
      domain: 'communication',
      objective: 'Kundenstatus-Update senden',
      constraints: ['formal', 'kurz'],
      expectedOutcome: 'Kunde hat eine klare Statusmail',
      requestId: 'req-1',
    }));
  });

  it('maps TOOL_CALL_STARTED to tool_call WS event', () => {
    const event = createEvent(makeCtx(), TOOL_CALL_STARTED, {
      agent: 'devo',
      toolName: 'fs_readFile',
      args: { path: '/test.ts' },
    });

    projection.handle(event);

    expect(emitChatEvent).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      type: 'tool_call',
      agent: 'devo',
      toolName: 'fs_readFile',
    }));
  });

  // ── AC-2: Internal events are skipped ──────────────────────────

  it('skips events with visibility "internal"', () => {
    const event = createEvent(makeCtx(), AGENT_STARTED, { agent: 'chapo', phase: 'exec' }, {
      visibility: 'internal',
    });

    projection.handle(event);

    expect(emitChatEvent).not.toHaveBeenCalled();
  });

  // ── AC-3: Terminal events are NOT emitted (dispatcher handles) ─

  it('skips WF_COMPLETED (terminal event handled by dispatcher)', () => {
    const event = createEvent(makeCtx(), WF_COMPLETED, {
      answer: 'Done',
      totalIterations: 3,
      status: 'completed',
    });

    projection.handle(event);

    expect(emitChatEvent).not.toHaveBeenCalled();
  });

  it('skips WF_FAILED (terminal event handled by dispatcher)', () => {
    const event = createEvent(makeCtx(), WF_FAILED, {
      error: 'Crash',
      agent: 'system',
      recoverable: false,
    });

    projection.handle(event);

    expect(emitChatEvent).not.toHaveBeenCalled();
  });

  // ── AC-4: Unknown events are silently ignored ──────────────────

  it('ignores events without a mapping', () => {
    const event = createEvent(makeCtx(), 'unknown.custom.event', { data: 'test' });

    projection.handle(event);

    expect(emitChatEvent).not.toHaveBeenCalled();
  });

  // ── AC-5: requestId is attached to stream events ───────────────

  it('attaches requestId to all emitted stream events', () => {
    const event = createEvent(
      makeCtx({ requestId: 'my-req-123' }),
      GATE_QUESTION_QUEUED,
      { questionId: 'q-1', question: 'What?', fromAgent: 'chapo' },
    );

    projection.handle(event);

    expect(emitChatEvent).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      requestId: 'my-req-123',
    }));
  });

  it('normalizes legacy nested question payloads', () => {
    const event = createEvent(makeCtx(), GATE_QUESTION_QUEUED, {
      question: {
        questionId: 'q-legacy-1',
        question: 'Welcher Betreff?',
        fromAgent: 'chapo',
      },
    });

    projection.handle(event);

    expect(emitChatEvent).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      type: 'user_question',
      question: expect.objectContaining({
        questionId: 'q-legacy-1',
        question: 'Welcher Betreff?',
        fromAgent: 'chapo',
      }),
    }));
  });
});
