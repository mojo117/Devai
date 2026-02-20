# ADR: Unified Workflow Event Pipeline

**Status:** Accepted
**Date:** 2026-02-19
**Context:** DevAI Multi-Agent Workflow System

---

## Context

The current DevAI workflow system has several architectural challenges:

1. **Ad-hoc event emission** scattered across `chapo-loop.ts` and `router.ts`
2. **Coupled concerns** - state mutation, WebSocket streaming, and markdown logging are tightly coupled via `loggedSendEvent`
3. **Duplicated logic** - the 4 WebSocket command branches in `routes.ts` duplicate session/response handling logic
4. **Inconsistent semantics** - workflow outcomes aren't handled uniformly across different projections
5. **Testing complexity** - coupled components make it difficult to test state transitions, streaming, and logging independently

These issues increase the risk of semantic divergence between the markdown log, WebSocket stream, and internal state as the system evolves.

---

## Decision

We will introduce a **command → domain event → projection** architecture for the workflow event pipeline:

### 1. Command Ingress Layer
Map incoming WebSocket messages to typed `WorkflowCommand` objects with consistent validation and routing.

### 2. Domain Event Emission
The workflow engine (`router.ts` + `chapo-loop.ts`) emits domain events via `WorkflowEventEnvelope`:

```typescript
interface WorkflowEventEnvelope {
  eventId: string;           // Unique event identifier
  sessionId: string;         // Workflow session
  requestId?: string;        // Source request (if applicable)
  turnId?: string;           // Agent turn (if applicable)
  timestamp: string;         // ISO 8601
  source: string;            // Emitting component
  eventType: string;         // Namespaced event type
  payload: unknown;          // Event-specific data
  visibility: 'public' | 'internal';  // Stream visibility
}
```

### 3. Event Bus with Ordered Projections
The event bus dispatches events to projections in deterministic order:

1. **StateProjection** (1st) - Updates workflow state (single writer principle)
2. **StreamProjection** (2nd) - Sends WebSocket events to frontend
3. **MarkdownProjection** (3rd) - Appends to markdown log
4. **AuditProjection** (4th) - Records to audit trail

Each projection is the **sole writer** for its concern, eliminating race conditions and ensuring consistency.

### 4. Event Naming Convention
Events use namespaced types to indicate origin and intent:

- `command.*` - User/system commands (e.g., `command.run_workflow`)
- `workflow.*` - Workflow lifecycle (e.g., `workflow.started`, `workflow.completed`)
- `tool.*` - Tool invocations (e.g., `tool.invoked`, `tool.result`)
- `agent.*` - Agent actions (e.g., `agent.thinking`, `agent.response`)
- `gate.*` - Gate validations (e.g., `gate.passed`, `gate.failed`)
- `projection.*` - Projection internals (e.g., `projection.state_updated`)
- `system.*` - System events (e.g., `system.error`, `system.shutdown`)

### 5. Backward Compatibility
The frontend sees **identical WebSocket events** - `StreamProjection` maps domain events to the existing WebSocket message format. This allows incremental migration without breaking the UI.

---

## Consequences

### Positive
- **Consistency** - All workflow outcomes handled uniformly across projections
- **Single source of truth** - State transitions occur in one place (StateProjection)
- **Semantic alignment** - Markdown logs and WebSocket stream always reflect the same domain events
- **Testability** - Projections can be tested independently; workflow engine tests don't need to mock WS/logging
- **Incremental migration** - Shadow mode allows validating the new pipeline against existing behavior
- **Observability** - Event envelope provides rich metadata for debugging and audit

### Negative
- **Indirection** - Slightly more code paths between workflow logic and side effects
- **Learning curve** - Team needs to understand event-driven architecture patterns
- **Migration effort** - Existing `loggedSendEvent` calls must be refactored to emit domain events

### Neutral
- **Performance** - Negligible overhead (event bus is synchronous, in-memory)
- **Complexity** - More files but clearer separation of concerns

---

## Alternatives Considered

### Full Event Sourcing
**Rejected.** Storing all events as the source of truth (with state reconstruction) is too complex for v1. The current decision provides event-driven benefits without requiring event replay, snapshots, or CQRS infrastructure.

### Keep Ad-hoc Emission
**Rejected.** Continuing with scattered `loggedSendEvent` calls increases divergence risk as the system grows. The coupling between state, streaming, and logging makes it difficult to add new projections (e.g., metrics, external webhooks) without modifying core workflow logic.

### Async Event Bus (Message Queue)
**Deferred.** An async event bus (Redis Streams, RabbitMQ) would enable horizontal scaling and durable replay but adds operational complexity. The synchronous in-memory bus is sufficient for current scale; async can be introduced later if needed.

---

## Implementation Notes

- **Shadow mode:** Run new event pipeline alongside existing `loggedSendEvent` to validate equivalence
- **Projection order:** Enforced by event bus configuration, not implicit
- **Error handling:** Projection failures are logged but don't fail the event dispatch (circuit breaker pattern)
- **Event schema:** Consider JSON Schema or TypeScript discriminated unions for type safety

---

## References

- `/opt/Klyde/projects/Devai/apps/api/src/workflow/chapo-loop.ts` - Current event emission
- `/opt/Klyde/projects/Devai/apps/api/src/workflow/router.ts` - Workflow orchestration
- `/opt/Klyde/projects/Devai/apps/api/src/routes.ts` - WebSocket command handlers
