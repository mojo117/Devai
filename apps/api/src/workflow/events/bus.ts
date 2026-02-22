/**
 * Workflow Event Bus — in-process, ordered dispatch to projections.
 *
 * Projections are called in registration order (deterministic):
 *   state → stream → markdown → audit
 *
 * Idempotency: repeated events (same eventId) are silently skipped.
 */

import type { WorkflowEventEnvelope } from './envelope.js';

export interface Projection {
  name: string;
  handle(event: WorkflowEventEnvelope): void | Promise<void>;
}

export class WorkflowEventBus {
  private projections: Projection[] = [];
  private processedEvents = new Map<string, Set<string>>(); // sessionId → eventIds
  private static readonly MAX_TRACKED_EVENTS = 1000;

  register(projection: Projection): void {
    this.projections.push(projection);
  }

  async emit(event: WorkflowEventEnvelope): Promise<void> {
    // Idempotency guard
    const sessionEvents = this.processedEvents.get(event.sessionId) ?? new Set<string>();
    if (sessionEvents.has(event.eventId)) return;

    sessionEvents.add(event.eventId);
    if (sessionEvents.size > WorkflowEventBus.MAX_TRACKED_EVENTS) {
      const first = sessionEvents.values().next().value;
      if (first) sessionEvents.delete(first);
    }
    this.processedEvents.set(event.sessionId, sessionEvents);

    // Dispatch to projections in registration order (deterministic)
    for (const projection of this.projections) {
      try {
        await projection.handle(event);
      } catch (err) {
        console.error(`[EventBus] Projection "${projection.name}" failed for ${event.eventType}:`, err);
        // Non-fatal: continue to next projection
      }
    }
  }

  async emitAll(events: WorkflowEventEnvelope[]): Promise<void> {
    for (const event of events) {
      await this.emit(event);
    }
  }

  clearSession(sessionId: string): void {
    this.processedEvents.delete(sessionId);
  }

  /** Returns registered projection names (for diagnostics). */
  getProjectionNames(): string[] {
    return this.projections.map((p) => p.name);
  }
}

// Singleton instance — projections registered at startup
export const workflowBus = new WorkflowEventBus();
