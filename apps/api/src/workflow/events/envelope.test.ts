import { describe, expect, it } from 'vitest';
import { createEvent } from './envelope.js';
import type { EventContext } from './envelope.js';

function makeCtx(overrides?: Partial<EventContext>): EventContext {
  return {
    sessionId: 'sess-1',
    requestId: 'req-1',
    turnId: 'turn-1',
    ...overrides,
  };
}

describe('createEvent', () => {
  // ── AC-1: Envelope structure ───────────────────────────────────

  it('creates an envelope with all required fields', () => {
    const event = createEvent(makeCtx(), 'agent.started', { agent: 'chapo', phase: 'execution' });

    expect(event.eventId).toBeTruthy();
    expect(event.eventId.length).toBe(16);
    expect(event.sessionId).toBe('sess-1');
    expect(event.requestId).toBe('req-1');
    expect(event.turnId).toBe('turn-1');
    expect(event.eventType).toBe('agent.started');
    expect(event.payload).toEqual({ agent: 'chapo', phase: 'execution' });
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // ── AC-2: Default source and visibility ────────────────────────

  it('defaults source to "router" and visibility to "ui"', () => {
    const event = createEvent(makeCtx(), 'test.event', {});

    expect(event.source).toBe('router');
    expect(event.visibility).toBe('ui');
  });

  // ── AC-3: Custom options ───────────────────────────────────────

  it('respects custom source, visibility, and causation/correlation IDs', () => {
    const event = createEvent(makeCtx(), 'test.event', {}, {
      source: 'chapo-loop',
      visibility: 'internal',
      causationId: 'cause-1',
      correlationId: 'corr-1',
    });

    expect(event.source).toBe('chapo-loop');
    expect(event.visibility).toBe('internal');
    expect(event.causationId).toBe('cause-1');
    expect(event.correlationId).toBe('corr-1');
  });

  // ── AC-4: Unique event IDs ─────────────────────────────────────

  it('generates unique eventIds for each call', () => {
    const ctx = makeCtx();
    const a = createEvent(ctx, 'test.event', {});
    const b = createEvent(ctx, 'test.event', {});

    expect(a.eventId).not.toBe(b.eventId);
  });

  // ── AC-5: Typed payload ────────────────────────────────────────

  it('preserves typed payload', () => {
    interface TestPayload { count: number; items: string[] }
    const event = createEvent<TestPayload>(makeCtx(), 'test.typed', { count: 3, items: ['a', 'b', 'c'] });

    expect(event.payload.count).toBe(3);
    expect(event.payload.items).toEqual(['a', 'b', 'c']);
  });
});
