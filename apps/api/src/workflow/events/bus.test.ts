import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowEventBus } from './bus.js';
import { createEvent } from './envelope.js';
import type { EventContext } from './envelope.js';
import type { Projection } from './bus.js';

function makeCtx(overrides?: Partial<EventContext>): EventContext {
  return {
    sessionId: 'sess-1',
    requestId: 'req-1',
    turnId: 'turn-1',
    ...overrides,
  };
}

describe('WorkflowEventBus', () => {
  let bus: WorkflowEventBus;

  beforeEach(() => {
    bus = new WorkflowEventBus();
  });

  // ── AC-1: Ordered Projection Dispatch ──────────────────────────

  it('dispatches events to projections in registration order', async () => {
    const order: string[] = [];

    const p1: Projection = {
      name: 'first',
      handle: () => { order.push('first'); },
    };
    const p2: Projection = {
      name: 'second',
      handle: () => { order.push('second'); },
    };
    const p3: Projection = {
      name: 'third',
      handle: () => { order.push('third'); },
    };

    bus.register(p1);
    bus.register(p2);
    bus.register(p3);

    const event = createEvent(makeCtx(), 'test.event', { foo: 'bar' });
    await bus.emit(event);

    expect(order).toEqual(['first', 'second', 'third']);
  });

  // ── AC-2: Idempotency Guard ────────────────────────────────────

  it('skips duplicate events with the same eventId', async () => {
    const callCount = { value: 0 };
    const p: Projection = {
      name: 'counter',
      handle: () => { callCount.value++; },
    };
    bus.register(p);

    const event = createEvent(makeCtx(), 'test.event', {});
    await bus.emit(event);
    await bus.emit(event); // duplicate
    await bus.emit(event); // duplicate

    expect(callCount.value).toBe(1);
  });

  it('processes distinct events with different eventIds', async () => {
    const callCount = { value: 0 };
    const p: Projection = {
      name: 'counter',
      handle: () => { callCount.value++; },
    };
    bus.register(p);

    await bus.emit(createEvent(makeCtx(), 'test.a', {}));
    await bus.emit(createEvent(makeCtx(), 'test.b', {}));

    expect(callCount.value).toBe(2);
  });

  // ── AC-3: Projection Fault Isolation ───────────────────────────

  it('continues dispatching when a projection throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reached = { value: false };

    const failing: Projection = {
      name: 'failing',
      handle: () => { throw new Error('boom'); },
    };
    const healthy: Projection = {
      name: 'healthy',
      handle: () => { reached.value = true; },
    };

    bus.register(failing);
    bus.register(healthy);

    await bus.emit(createEvent(makeCtx(), 'test.event', {}));

    expect(reached.value).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Projection "failing" failed'),
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  // ── AC-4: Session Isolation ────────────────────────────────────

  it('tracks idempotency per session (same eventId, different session)', async () => {
    const callCount = { value: 0 };
    const p: Projection = {
      name: 'counter',
      handle: () => { callCount.value++; },
    };
    bus.register(p);

    const event1 = createEvent(makeCtx({ sessionId: 'sess-a' }), 'test.event', {});
    const event2 = { ...event1, sessionId: 'sess-b' }; // same eventId, different session

    await bus.emit(event1);
    await bus.emit(event2);

    // Both should process because they are in different sessions
    expect(callCount.value).toBe(2);
  });

  // ── AC-5: clearSession resets idempotency ──────────────────────

  it('allows replaying events after clearSession', async () => {
    const callCount = { value: 0 };
    const p: Projection = {
      name: 'counter',
      handle: () => { callCount.value++; },
    };
    bus.register(p);

    const event = createEvent(makeCtx(), 'test.event', {});
    await bus.emit(event);
    expect(callCount.value).toBe(1);

    bus.clearSession('sess-1');

    await bus.emit(event);
    expect(callCount.value).toBe(2);
  });

  // ── AC-6: emitAll dispatches in order ──────────────────────────

  it('emitAll dispatches events sequentially in order', async () => {
    const received: string[] = [];
    const p: Projection = {
      name: 'logger',
      handle: (event) => { received.push(event.eventType); },
    };
    bus.register(p);

    const events = [
      createEvent(makeCtx(), 'first', {}),
      createEvent(makeCtx(), 'second', {}),
      createEvent(makeCtx(), 'third', {}),
    ];

    await bus.emitAll(events);

    expect(received).toEqual(['first', 'second', 'third']);
  });

  // ── AC-7: getProjectionNames returns registered names ──────────

  it('returns registered projection names', () => {
    bus.register({ name: 'state', handle: () => {} });
    bus.register({ name: 'stream', handle: () => {} });

    expect(bus.getProjectionNames()).toEqual(['state', 'stream']);
  });

  // ── AC-8: Idempotency set eviction ─────────────────────────────

  it('evicts oldest eventId when exceeding MAX_TRACKED_EVENTS', async () => {
    const callCount = { value: 0 };
    const p: Projection = {
      name: 'counter',
      handle: () => { callCount.value++; },
    };
    bus.register(p);

    // Emit 1001 unique events to overflow the 1000 limit
    const events: ReturnType<typeof createEvent>[] = [];
    for (let i = 0; i < 1001; i++) {
      events.push(createEvent(makeCtx(), `event.${i}`, {}));
    }

    for (const evt of events) {
      await bus.emit(evt);
    }

    expect(callCount.value).toBe(1001);

    // The first event should have been evicted, so replaying it should work
    await bus.emit(events[0]);
    expect(callCount.value).toBe(1002);

    // But the last event should still be in the set
    await bus.emit(events[1000]);
    expect(callCount.value).toBe(1002); // not incremented
  });
});
