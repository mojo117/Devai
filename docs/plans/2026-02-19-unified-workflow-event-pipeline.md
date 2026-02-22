# Plan: Unified Workflow Event Pipeline + Projections (State/WS/Markdown/Audit)

**Status:** Ready for Implementation (2026-02-19)
**Branch:** `dev`
**Implementation Owner:** Claude Code
**Decision Type:** Architecture + incremental migration (no Big Bang)

---

## 1) Goal

Build a unified workflow event pipeline so all workflow outcomes are handled consistently:

1. tool results
2. user answers (ASK/approval/plan approval)
3. agent decisions/responses
4. recoverable and fatal errors

The pipeline becomes the single orchestration backbone, while preserving existing API/WS contracts and user behavior.

---

## 2) Why This Change

Current system already has strong building blocks but no single execution backbone:

1. Event model is documented (`docs/architecture.md`) and `events.ts` exists with typed factories (`AgentEvents`, `ToolEvents`, `PlanEvents`, `TaskEvents`, `ScoutEvents`, `UserEvents`, `SystemEvents`).
2. Runtime emits are mostly ad-hoc object literals — `chapo-loop.ts` and `router.ts` emit raw `{ type: '...' }` instead of using `events.ts` factories.
3. WebSocket route branches by message type (`request`, `approval`, `question`, `plan_approval`) with duplicated request/response flow — each branch constructs its own `responseMessage`, calls `sendEvent`, saves to DB independently.
4. State mutation, streaming, and markdown logging are coupled — `loggedSendEvent` in `routes.ts:303-306` wraps both `sendEvent()` and `sessionLogger.logAgentEvent()` together.
5. `.md` session logs are useful but not yet a first-class projection from a unified event stream. The `logAgentEvent` switch/case in `sessionLogger.ts:158-243` is the only consumer, and it has a bug at line 201 (`q?.text` should be `q?.question`).

Result: harder reasoning, duplicate logic, and risk of divergence between UI events, state, and logs.

---

## 3) Scope

### In Scope

1. Unified command ingestion for workflow actions.
2. Unified domain event envelope and catalog.
3. Event bus + deterministic handlers.
4. Projections:
   - state projection (`stateManager`)
   - stream projection (`chatGateway`)
   - markdown projection (`SessionLogger` -> `var/logs/*.md`)
   - audit projection (`audit.log` + DB audit table)
5. Backward-compatible final `response` event for frontend.
6. Documentation updates (architecture + runbook + migration notes).

### Out of Scope (for this plan)

1. Full event sourcing with durable event store replay as source of truth.
2. Frontend protocol redesign.
3. Port/infra changes.
4. Broad model/prompt redesign.

---

## 4) Non-Negotiable Logic Rules (Saubere Logik)

1. **Single writer principle:** workflow state transitions happen only in `StateProjection`.
2. **Single emitter principle:** WS client stream events emitted only via `StreamProjection`.
3. **Single logger principle:** markdown session logs written only via `MarkdownLogProjection`.
4. **Command-domain separation:** incoming WS commands are not domain events.
5. **Deterministic ordering:** each command produces an ordered event sequence.
6. **Idempotent projections:** repeated same event (`eventId`) does not duplicate state/log side effects.
7. **Correlation everywhere:** `sessionId`, `requestId`, `turnId`, `eventId` present on all workflow envelopes.
8. **No hidden side effects:** direct `sendEvent` + direct state mutation in orchestration path to be removed incrementally.

---

## 5) Target Architecture (v1)

### 5.1 Layers

```
┌────────────────────────────────────────────────────────┐
│                    WS Client (Browser)                 │
└──────────────────────┬─────────────────────────────────┘
                       │ JSON messages
                       ▼
┌────────────────────────────────────────────────────────┐
│  1. COMMAND INGRESS  (websocket/routes.ts)              │
│     Validates, maps WS msg → typed Command              │
│     Types: request | approval | question | plan_approval│
└──────────────────────┬─────────────────────────────────┘
                       │ WorkflowCommand
                       ▼
┌────────────────────────────────────────────────────────┐
│  2. WORKFLOW ENGINE  (router.ts + chapo-loop.ts)        │
│     Executes logic, emits ordered domain events         │
│     via bus.emit(event)                                 │
└──────────────────────┬─────────────────────────────────┘
                       │ WorkflowEventEnvelope[]
                       ▼
┌────────────────────────────────────────────────────────┐
│  3. DOMAIN EVENT BUS  (workflow/events/bus.ts)          │
│     Dispatches to projections in order:                 │
│     state → stream → markdown → audit                   │
└──────────┬──────────┬──────────┬──────────┬────────────┘
           │          │          │          │
           ▼          ▼          ▼          ▼
      ┌─────────┐ ┌─────────┐ ┌──────┐ ┌─────────┐
      │  State  │ │ Stream  │ │  MD  │ │  Audit  │
      │ Project │ │ Project │ │ Log  │ │ Project │
      └────┬────┘ └────┬────┘ └──┬───┘ └────┬────┘
           │          │          │          │
           ▼          ▼          ▼          ▼
      stateManager  chatGateway  var/logs/  var/audit.log
      (in-memory    (ring buffer  *.md      + DB
       + DB)         + WS send)
```

### 5.2 Event Envelope

```ts
interface WorkflowEventEnvelope<TPayload = unknown> {
  eventId: string;          // unique per event (nanoid)
  sessionId: string;
  requestId: string;        // one request/command execution
  turnId: string;           // one logical turn in session
  timestamp: string;
  source: 'ws' | 'router' | 'chapo-loop' | 'projection' | 'system';
  eventType: string;        // namespaced, e.g. workflow.question.queued
  causationId?: string;     // prior event causing this event
  correlationId?: string;   // optional broader workflow/job correlation
  payload: TPayload;
  visibility: 'internal' | 'ui' | 'log' | 'audit';
}
```

### 5.3 Event Naming Convention

1. `command.*` for ingress commands
2. `workflow.*` for domain lifecycle
3. `tool.*` for tool execution
4. `agent.*` for agent lifecycle
5. `gate.*` for ASK/approval/plan approval
6. `projection.*` for projection failures/diagnostics
7. `system.*` for health and infrastructure-level signals

---

## 6) Event Catalog (Initial v1)

### Commands

| Event | Source | Payload |
|-------|--------|---------|
| `command.user.request_submitted` | WS `request` msg | `{ message, sessionId?, projectRoot?, metadata }` |
| `command.user.question_answered` | WS `question` msg | `{ questionId, answer, sessionId }` |
| `command.user.approval_decided` | WS `approval` msg | `{ approvalId, approved, sessionId }` |
| `command.user.plan_approval_decided` | WS `plan_approval` msg | `{ planId, approved, reason?, sessionId }` |

### Domain (Workflow Core)

| Event | Emitted By | Payload |
|-------|-----------|---------|
| `workflow.turn.started` | router.processRequest | `{ userMessage, taskComplexity, modelSelection }` |
| `workflow.context.warmed` | systemContext | `{ contextBlocks: string[] }` |
| `workflow.model.selected` | modelSelector | `{ provider, model, complexity }` |
| `workflow.completed` | router / chapo-loop | `{ answer, totalIterations, status }` |
| `workflow.failed` | router / chapo-loop | `{ error, agent, recoverable }` |

### Gate Events

| Event | Emitted By | Payload |
|-------|-----------|---------|
| `gate.question.queued` | chapo-loop.queueQuestion | `{ questionId, question, fromAgent }` |
| `gate.question.resolved` | router.handleUserResponse | `{ questionId, answer }` |
| `gate.approval.queued` | chapo-loop.queueApproval | `{ approvalId, description, riskLevel }` |
| `gate.approval.resolved` | router.handleUserApproval | `{ approvalId, approved }` |
| `gate.plan_approval.queued` | router.runPlanMode | `{ planId, plan }` |
| `gate.plan_approval.resolved` | router.handlePlanApproval | `{ planId, approved, reason? }` |

### Agent/Loop Events

| Event | Emitted By | Payload |
|-------|-----------|---------|
| `agent.started` | chapo-loop.run | `{ agent, phase }` |
| `agent.thinking` | chapo-loop.runLoop | `{ agent, status }` |
| `agent.switched` | chapo-loop.delegateToDevo | `{ from, to, reason }` |
| `agent.delegated` | chapo-loop.runLoop | `{ from, to, task }` |
| `agent.completed` | chapo-loop.run / delegateToDevo | `{ agent, result }` |
| `agent.failed` | chapo-loop.runLoop | `{ agent, error, recoverable }` |

### Tool Events

| Event | Emitted By | Payload |
|-------|-----------|---------|
| `tool.call.started` | chapo-loop / router (tool dispatch) | `{ agent, toolName, args, toolId }` |
| `tool.call.completed` | chapo-loop / router | `{ agent, toolName, result, success, toolId }` |
| `tool.call.failed` | chapo-loop / router | `{ agent, toolName, error, toolId }` |
| `tool.action.pending` | approvalBridge (onActionPending) | `{ actionId, toolName, description, preview }` |

### Plan/Task Events

| Event | Emitted By | Payload |
|-------|-----------|---------|
| `plan.started` | router.runPlanMode | `{ sessionId }` |
| `plan.ready` | router.runPlanMode | `{ plan }` |
| `plan.approval_requested` | router.runPlanMode | `{ plan }` |
| `plan.approved` | router.handlePlanApproval | `{ planId }` |
| `plan.rejected` | router.handlePlanApproval | `{ planId, reason }` |
| `task.created` | router.runPlanMode | `{ task }` |
| `task.updated` | router.executePlan | `{ taskId, status, progress?, activeForm? }` |
| `task.completed` | router.executePlan | `{ taskId, result }` |
| `task.failed` | router.executePlan | `{ taskId, error }` |

---

## 7) Projection Design

### 7.1 StateProjection

Responsibility:

1. apply domain transitions to `stateManager`
2. persist pending gates (question/approval/plan approval)
3. maintain phase transitions (`idle`, `execution`, `waiting_user`, `planning`, `error`)

**Concrete event→mutation mapping:**

| Domain Event | stateManager Call(s) | Current Call Site |
|-------------|---------------------|-------------------|
| `agent.started` | `setPhase('execution')`, `setActiveAgent(agent)` | `chapo-loop.ts:97-98` |
| `agent.switched` | `setActiveAgent(toAgent)` | `chapo-loop.ts:523,675` |
| `agent.completed` | (no state change — informational) | `chapo-loop.ts:105,682` |
| `gate.question.queued` | `addPendingQuestion()`, `setPhase('waiting_user')`, `flushState()` | `chapo-loop.ts:366-368` |
| `gate.question.resolved` | `removePendingQuestion()`, `addHistoryEntry()`, `flushState()` | `router.ts:359-383` |
| `gate.approval.queued` | `addPendingApproval()`, `setPhase('waiting_user')`, `flushState()` | `chapo-loop.ts:392-394` |
| `gate.approval.resolved` | `removePendingApproval()`, `grantApproval()`, `flushState()` | `router.ts:413-426` |
| `gate.plan_approval.resolved` | `approvePlan()` or `rejectPlan()` | `router.ts:1084-1092` |
| `workflow.turn.started` | `setOriginalRequest()`, `setGatheredInfo()` | `router.ts:250-272` |
| `workflow.failed` | `setPhase('error')`, `addHistoryEntry()` | `router.ts:326-341` |
| `plan.started` | `createPlan()` | `router.ts:860` |
| `task.updated` | `updateTaskStatus()` | `router.ts:987,1009,1030` |

Rules:

1. idempotent by `eventId` — track processed event IDs per session (bounded set, e.g. last 1000)
2. no direct WS emission
3. flush critical gate events immediately (question/approval queued/resolved)

### 7.2 StreamProjection

Responsibility:

1. map domain events to existing `AgentStreamEvent` messages for WS clients
2. attach `requestId`, preserve `seq` behavior via `chatGateway.emitChatEvent()`
3. emit compatibility terminal `response` event

**Concrete event→stream mapping:**

| Domain Event | WS Stream Event (existing format) |
|-------------|----------------------------------|
| `agent.started` | `{ type: 'agent_start', agent, phase }` |
| `agent.thinking` | `{ type: 'agent_thinking', agent, status }` |
| `agent.switched` | `{ type: 'agent_switch', from, to, reason }` |
| `agent.delegated` | `{ type: 'delegation', from, to, task }` |
| `agent.completed` | `{ type: 'agent_complete', agent, result }` |
| `agent.failed` | `{ type: 'error', agent, error }` |
| `tool.call.started` | `{ type: 'tool_call', agent, toolName, args }` |
| `tool.call.completed` | `{ type: 'tool_result', agent, toolName, result, success }` |
| `tool.action.pending` | `{ type: 'action_pending', actionId, toolName, ... }` |
| `gate.question.queued` | `{ type: 'user_question', question }` |
| `gate.approval.queued` | `{ type: 'approval_request', request, sessionId }` |
| `plan.ready` | `{ type: 'plan_ready', plan }` |
| `plan.approval_requested` | `{ type: 'plan_approval_request', plan }` |
| `plan.approved` | `{ type: 'plan_approved', planId }` |
| `plan.rejected` | `{ type: 'plan_rejected', planId, reason }` |
| `task.created` | `{ type: 'task_created', task }` |
| `task.updated` | `{ type: 'task_update', taskId, status, progress?, activeForm? }` |
| `task.completed` | `{ type: 'task_completed', taskId, result }` |
| `task.failed` | `{ type: 'task_failed', taskId, error }` |
| `workflow.completed` | `{ type: 'response', response: { message, pendingActions, sessionId, agentHistory } }` |
| `workflow.failed` | `{ type: 'response', response: { message (error), ... } }` |
| `agent.history` (internal) | `{ type: 'agent_history', entries }` |

**Implementation:** For each mapped event, call `emitChatEvent(sessionId, { ...streamPayload, requestId })`.

Rules:

1. UI sees stable event contract — no new event types, no removed event types
2. all user-visible transitions derive from domain events
3. events with `visibility: 'internal'` are NOT emitted to WS

### 7.3 MarkdownLogProjection

Responsibility:

1. write `.md` session trace to `var/logs/*.md` via `SessionLogger`
2. normalize noisy events (skip heartbeat/ping/no-op `agent_thinking`)
3. ensure semantic parity with stream/state

Important fix included:

1. `user_question` payload mapping must use `question.question` (not `question.text`)

**Current bug at `sessionLogger.ts:201`:**
```ts
// CURRENT (broken):
this.append(`### [${ts()}] User Question\n\n${q?.text || JSON.stringify(q)}\n\n`);

// FIXED:
this.append(`### [${ts()}] User Question\n\n${q?.question || JSON.stringify(q)}\n\n`);
```

**Concrete event→markdown mapping:**

| Domain Event | SessionLogger Method |
|-------------|---------------------|
| `agent.started` | `append("### Agent Start: {agent} ({phase})")` |
| `agent.thinking` | SKIP (too noisy — same as current) |
| `agent.switched` | `logAgentSwitch(from, to, reason)` |
| `agent.delegated` | `append("### Delegation: {from} → {to}\n\nTask: {task}")` |
| `tool.call.started` | `logToolCall(toolName, args, agent)` |
| `tool.call.completed` | `logToolResult(toolName, success, result)` |
| `gate.question.queued` | `append("### User Question\n\n{question.question}")` |
| `gate.approval.queued` | `append("### Approval Request\n\n{JSON}")` |
| `tool.action.pending` | `append("### Action Pending — {toolName}\n\n{description}")` |
| `plan.ready` | `append("### Plan Ready\n\n{JSON}")` |
| `task.updated` | `append("### Task Update: {taskId} → {status}")` |
| `agent.failed` | `logError(error, agent)` |
| `workflow.completed` | `logAssistant(answer)` + `finalize('completed')` |
| `workflow.failed` | `logError(error)` + `finalize('error')` |

Rules:

1. only projection writes logs — remove `loggedSendEvent` wrapper in `routes.ts:303-306`
2. include correlation fields in log sections (`eventId`, `requestId`, `turnId`)
3. keep truncation and secret sanitization (reuse existing `truncate()` and `sanitize()`)

### 7.4 AuditProjection

Responsibility:

1. forward selected workflow events to `auditLog()` from `audit/logger.ts`
2. redact payloads via existing `sanitize()` function
3. keep DB-backed audit consistency

**Events to audit:**

| Domain Event | Audit Action | Rationale |
|-------------|-------------|-----------|
| `workflow.turn.started` | `workflow.turn_started` | Track all user requests |
| `workflow.completed` | `workflow.completed` | Track completions |
| `workflow.failed` | `workflow.failed` | Track failures |
| `gate.question.queued` | `gate.question_queued` | Track user interactions |
| `gate.approval.resolved` | `gate.approval_resolved` | Track security decisions |
| `gate.plan_approval.resolved` | `gate.plan_approval_resolved` | Track plan decisions |
| `tool.call.completed` | `tool.executed` | Track tool usage (already exists) |
| `tool.call.failed` | `tool.failed` | Track tool failures |

---

## 8) Detailed Implementation Phases

## Phase 0 — Architecture Freeze + ADR (0.5 day)

Deliverables:

1. ADR markdown under `docs/adr/` defining:
   - command vs domain event boundaries
   - projection responsibilities
   - compatibility contract
2. event taxonomy and envelope spec finalized

Tasks:

1. Create `docs/adr/2026-02-19-workflow-event-pipeline.md`
2. Approve event naming set and mandatory metadata
3. Define projection ordering: state → stream → markdown → audit

---

## Phase 1 — Event Foundation Modules (1 day)

### Target files (new):

```
apps/api/src/workflow/
├── events/
│   ├── envelope.ts       # WorkflowEventEnvelope type + factory
│   ├── catalog.ts        # All event type constants + payload types
│   └── bus.ts            # In-process event bus with ordered dispatch
├── commands/
│   ├── types.ts          # WorkflowCommand union type
│   └── dispatcher.ts     # Maps commands → workflow engine calls
└── context/
    └── requestContext.ts  # Per-request context (requestId, turnId, etc.)
```

### Concrete code: `envelope.ts`

```ts
import { nanoid } from 'nanoid';

export type EventSource = 'ws' | 'router' | 'chapo-loop' | 'projection' | 'system';
export type EventVisibility = 'internal' | 'ui' | 'log' | 'audit';

export interface WorkflowEventEnvelope<TPayload = unknown> {
  eventId: string;
  sessionId: string;
  requestId: string;
  turnId: string;
  timestamp: string;
  source: EventSource;
  eventType: string;
  causationId?: string;
  correlationId?: string;
  payload: TPayload;
  visibility: EventVisibility;
}

export function createEvent<T>(
  ctx: { sessionId: string; requestId: string; turnId: string },
  eventType: string,
  payload: T,
  opts?: {
    source?: EventSource;
    visibility?: EventVisibility;
    causationId?: string;
    correlationId?: string;
  }
): WorkflowEventEnvelope<T> {
  return {
    eventId: nanoid(16),
    sessionId: ctx.sessionId,
    requestId: ctx.requestId,
    turnId: ctx.turnId,
    timestamp: new Date().toISOString(),
    source: opts?.source ?? 'router',
    eventType,
    causationId: opts?.causationId,
    correlationId: opts?.correlationId,
    payload,
    visibility: opts?.visibility ?? 'ui',
  };
}
```

### Concrete code: `bus.ts`

```ts
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
    const sessionEvents = this.processedEvents.get(event.sessionId) ?? new Set();
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
        console.error(`[EventBus] Projection "${projection.name}" failed:`, err);
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
}

// Singleton instance — projections registered at startup
export const workflowBus = new WorkflowEventBus();
```

### Concrete code: `commands/types.ts`

```ts
export type WorkflowCommand =
  | UserRequestCommand
  | UserQuestionAnsweredCommand
  | UserApprovalDecidedCommand
  | UserPlanApprovalDecidedCommand;

export interface UserRequestCommand {
  type: 'user_request';
  sessionId: string;
  requestId: string;
  message: string;
  projectRoot?: string;
  metadata?: Record<string, unknown>;
}

export interface UserQuestionAnsweredCommand {
  type: 'user_question_answered';
  sessionId: string;
  requestId: string;
  questionId: string;
  answer: string;
}

export interface UserApprovalDecidedCommand {
  type: 'user_approval_decided';
  sessionId: string;
  requestId: string;
  approvalId: string;
  approved: boolean;
}

export interface UserPlanApprovalDecidedCommand {
  type: 'user_plan_approval_decided';
  sessionId: string;
  requestId: string;
  planId: string;
  approved: boolean;
  reason?: string;
}
```

### Concrete code: `context/requestContext.ts`

```ts
import { nanoid } from 'nanoid';

export interface RequestContext {
  sessionId: string;
  requestId: string;
  turnId: string;
}

/**
 * Create a new request context. One per incoming WS command.
 */
export function createRequestContext(
  sessionId: string,
  requestId?: string
): RequestContext {
  return {
    sessionId,
    requestId: requestId ?? nanoid(),
    turnId: nanoid(12),
  };
}
```

---

## Phase 2 — Projection Scaffolding + Bridge (1 day)

### Target files (new):

```
apps/api/src/workflow/projections/
├── stateProjection.ts
├── streamProjection.ts
├── markdownLogProjection.ts
├── auditProjection.ts
└── index.ts
```

### Concrete code: `stateProjection.ts` (skeleton)

```ts
import type { Projection } from '../events/bus.js';
import type { WorkflowEventEnvelope } from '../events/envelope.js';
import * as stateManager from '../../agents/stateManager.js';

export class StateProjection implements Projection {
  name = 'state';

  async handle(event: WorkflowEventEnvelope): Promise<void> {
    const { sessionId, eventType, payload } = event;
    const p = payload as Record<string, unknown>;

    switch (eventType) {
      case 'agent.started':
        stateManager.setPhase(sessionId, p.phase as string);
        stateManager.setActiveAgent(sessionId, p.agent as string);
        break;

      case 'agent.switched':
        stateManager.setActiveAgent(sessionId, p.to as string);
        break;

      case 'gate.question.queued':
        stateManager.addPendingQuestion(sessionId, p as any);
        stateManager.setPhase(sessionId, 'waiting_user');
        await stateManager.flushState(sessionId);
        break;

      case 'gate.question.resolved':
        stateManager.removePendingQuestion(sessionId, p.questionId as string);
        await stateManager.flushState(sessionId);
        break;

      case 'gate.approval.queued':
        stateManager.addPendingApproval(sessionId, p as any);
        stateManager.setPhase(sessionId, 'waiting_user');
        await stateManager.flushState(sessionId);
        break;

      case 'gate.approval.resolved':
        stateManager.removePendingApproval(sessionId, p.approvalId as string);
        if (p.approved) stateManager.grantApproval(sessionId);
        else stateManager.setPhase(sessionId, 'error');
        await stateManager.flushState(sessionId);
        break;

      case 'workflow.turn.started':
        stateManager.setOriginalRequest(sessionId, p.userMessage as string);
        break;

      case 'workflow.failed':
        stateManager.setPhase(sessionId, 'error');
        break;

      // Plan events
      case 'plan.started':
        // createPlan handled by router — state projection just tracks phase
        break;
      case 'task.updated':
        stateManager.updateTaskStatus(
          sessionId,
          p.taskId as string,
          p.status as any,
          { progress: p.progress as number | undefined },
        );
        break;
    }
  }
}
```

### Concrete code: `streamProjection.ts` (skeleton)

```ts
import type { Projection } from '../events/bus.js';
import type { WorkflowEventEnvelope } from '../events/envelope.js';
import { emitChatEvent } from '../../websocket/chatGateway.js';

/** Maps domain events to existing WS stream format. */
const EVENT_TYPE_TO_STREAM: Record<string, (p: Record<string, unknown>) => Record<string, unknown> | null> = {
  'agent.started': (p) => ({ type: 'agent_start', agent: p.agent, phase: p.phase }),
  'agent.thinking': (p) => ({ type: 'agent_thinking', agent: p.agent, status: p.status }),
  'agent.switched': (p) => ({ type: 'agent_switch', from: p.from, to: p.to, reason: p.reason }),
  'agent.delegated': (p) => ({ type: 'delegation', from: p.from, to: p.to, task: p.task }),
  'agent.completed': (p) => ({ type: 'agent_complete', agent: p.agent, result: p.result }),
  'agent.failed': (p) => ({ type: 'error', agent: p.agent, error: p.error }),
  'tool.call.started': (p) => ({ type: 'tool_call', agent: p.agent, toolName: p.toolName, args: p.args }),
  'tool.call.completed': (p) => ({ type: 'tool_result', agent: p.agent, toolName: p.toolName, result: p.result, success: p.success }),
  'tool.action.pending': (p) => ({ type: 'action_pending', actionId: p.actionId, toolName: p.toolName, toolArgs: p.toolArgs, description: p.description, preview: p.preview }),
  'gate.question.queued': (p) => ({ type: 'user_question', question: p }),
  'gate.approval.queued': (p) => ({ type: 'approval_request', request: p }),
  'plan.started': (p) => ({ type: 'plan_start', sessionId: p.sessionId }),
  'plan.ready': (p) => ({ type: 'plan_ready', plan: p.plan }),
  'plan.approval_requested': (p) => ({ type: 'plan_approval_request', plan: p.plan }),
  'plan.approved': (p) => ({ type: 'plan_approved', planId: p.planId }),
  'plan.rejected': (p) => ({ type: 'plan_rejected', planId: p.planId, reason: p.reason }),
  'task.created': (p) => ({ type: 'task_created', task: p.task }),
  'task.updated': (p) => ({ type: 'task_update', taskId: p.taskId, status: p.status, progress: p.progress, activeForm: p.activeForm }),
  'task.completed': (p) => ({ type: 'task_completed', taskId: p.taskId, result: p.result }),
  'task.failed': (p) => ({ type: 'task_failed', taskId: p.taskId, error: p.error }),
};

export class StreamProjection implements Projection {
  name = 'stream';

  handle(event: WorkflowEventEnvelope): void {
    if (event.visibility === 'internal') return;

    const mapper = EVENT_TYPE_TO_STREAM[event.eventType];
    if (!mapper) return;

    const streamEvent = mapper(event.payload as Record<string, unknown>);
    if (!streamEvent) return;

    emitChatEvent(event.sessionId, {
      ...streamEvent,
      requestId: event.requestId,
    });
  }
}
```

### Concrete code: `markdownLogProjection.ts` (skeleton)

```ts
import type { Projection } from '../events/bus.js';
import type { WorkflowEventEnvelope } from '../events/envelope.js';
import { SessionLogger } from '../../audit/sessionLogger.js';

const SKIP_EVENTS = new Set(['agent.thinking', 'system.heartbeat']);

export class MarkdownLogProjection implements Projection {
  name = 'markdown';

  handle(event: WorkflowEventEnvelope): void {
    if (event.visibility === 'internal') return;
    if (SKIP_EVENTS.has(event.eventType)) return;

    const logger = SessionLogger.getActive(event.sessionId);
    if (!logger) return;

    const p = event.payload as Record<string, unknown>;

    switch (event.eventType) {
      case 'agent.started':
        logger.logAgentEvent({ type: 'agent_start', agent: p.agent, phase: p.phase });
        break;
      case 'agent.switched':
        logger.logAgentSwitch(String(p.from), String(p.to), String(p.reason));
        break;
      case 'agent.delegated':
        logger.logAgentEvent({ type: 'delegation', from: p.from, to: p.to, task: p.task });
        break;
      case 'tool.call.started':
        logger.logToolCall(String(p.toolName), (p.args || {}) as Record<string, unknown>, p.agent as string);
        break;
      case 'tool.call.completed':
        logger.logToolResult(String(p.toolName), Boolean(p.success), p.result);
        break;
      case 'gate.question.queued': {
        // FIX: use question.question, not question.text
        const q = p as Record<string, unknown>;
        logger.logAgentEvent({ type: 'user_question', question: q });
        break;
      }
      case 'gate.approval.queued':
        logger.logAgentEvent({ type: 'approval_request', request: p });
        break;
      case 'tool.action.pending':
        logger.logAgentEvent({ type: 'action_pending', toolName: p.toolName, description: p.description });
        break;
      case 'plan.ready':
        logger.logAgentEvent({ type: 'plan_ready', plan: p.plan });
        break;
      case 'task.updated':
        logger.logAgentEvent({ type: 'task_update', taskId: p.taskId, status: p.status });
        break;
      case 'agent.failed':
        logger.logError(String(p.error), p.agent as string);
        break;
      case 'workflow.completed':
        logger.logAssistant(String(p.answer));
        break;
      case 'workflow.failed':
        logger.logError(String(p.error));
        break;
    }
  }
}
```

### Concrete code: `index.ts`

```ts
import { workflowBus } from '../events/bus.js';
import { StateProjection } from './stateProjection.js';
import { StreamProjection } from './streamProjection.js';
import { MarkdownLogProjection } from './markdownLogProjection.js';
import { AuditProjection } from './auditProjection.js';

/**
 * Register all projections in deterministic order.
 * Called once at server startup.
 */
export function registerProjections(): void {
  workflowBus.register(new StateProjection());      // 1. state first
  workflowBus.register(new StreamProjection());      // 2. then stream to WS
  workflowBus.register(new MarkdownLogProjection()); // 3. then MD logs
  workflowBus.register(new AuditProjection());       // 4. audit last
}
```

Migration note: at this phase, old direct calls still exist. Both paths run in parallel for parity validation.

---

## Phase 3 — Ingress Unification (WS Commands) (1 day)

### Target files:

1. `apps/api/src/websocket/routes.ts` (MODIFY)
2. `apps/api/src/workflow/commands/dispatcher.ts` (NEW)

### Current problem in `routes.ts`

The 4 WS command branches (lines 232-494) duplicate:
- Session joining (`joinSession(activeSessionId)`)
- State loading (`ensureStateLoaded()`)
- Response message construction (`{ id: nanoid(), role: 'assistant', content, timestamp }`)
- `sendEvent({ type: 'response', response: { ... } })` call
- Message persistence (`saveMessage()`)

### Migration: Unified command dispatcher

**Before** (`routes.ts` lines 232-377, simplified):
```ts
if (msg?.type === 'request') {
  // ... 145 lines of request handling
  const result = await processRequest(...);
  sendEvent({ type: 'response', response: { ... } });
}
if (msg?.type === 'approval') {
  // ... 34 lines of approval handling
  const result = await handleUserApproval(...);
  sendEvent({ type: 'response', response: { ... } });
}
// ... same pattern for question, plan_approval
```

**After** (unified dispatcher):
```ts
// In routes.ts — all 4 branches become:
const command = mapWsMessageToCommand(msg, sessionId, requestId);
if (command) {
  joinSession(command.sessionId);
  await ensureStateLoaded(command.sessionId);
  await commandDispatcher.dispatch(command);
}
```

**`dispatcher.ts`:**
```ts
import type { WorkflowCommand } from './types.js';
import { processRequest, handleUserApproval, handleUserResponse, handlePlanApproval } from '../../agents/router.js';
import { workflowBus } from '../events/bus.js';
import { createEvent } from '../events/envelope.js';
import { createRequestContext } from '../context/requestContext.js';
// ... imports for DB, session management

export class CommandDispatcher {
  async dispatch(command: WorkflowCommand): Promise<void> {
    const ctx = createRequestContext(command.sessionId, command.requestId);

    switch (command.type) {
      case 'user_request':
        return this.handleRequest(command, ctx);
      case 'user_question_answered':
        return this.handleQuestionAnswer(command, ctx);
      case 'user_approval_decided':
        return this.handleApproval(command, ctx);
      case 'user_plan_approval_decided':
        return this.handlePlanApproval(command, ctx);
    }
  }

  private async handleRequest(command: UserRequestCommand, ctx: RequestContext): Promise<void> {
    // SessionLogger, validation, history loading — same as current routes.ts:242-296
    // But now emits domain events instead of direct calls:
    //   workflowBus.emit(createEvent(ctx, 'workflow.turn.started', { ... }));
    // processRequest still receives sendEvent, but sendEvent now wraps bus.emit()
    // Response construction unified via response composer
  }
  // ... similar for other handlers
}
```

### What `loggedSendEvent` becomes

**Current** (`routes.ts:303-306`):
```ts
const loggedSendEvent = (event: AgentStreamEvent | Record<string, unknown>) => {
  sendEvent(event);
  sessionLogger.logAgentEvent(event as Record<string, unknown>);
};
```

**After:** This wrapper is deleted. The `sendEvent` function passed to `processRequest` / `ChapoLoop` now emits domain events to the bus, which dispatches to StreamProjection (→ WS) and MarkdownLogProjection (→ .md) automatically.

Acceptance:

1. One unified ingress execution path for all workflow-affecting commands
2. Frontend sees identical WS events (verified by replaying test sessions)

---

## Phase 4 — Gate Flow Migration (ASK/Approval/Plan Approval) (1 day)

### Target files:

1. `apps/api/src/agents/router.ts` (MODIFY)
2. `apps/api/src/agents/chapo-loop.ts` (MODIFY)
3. `apps/api/src/workflow/handlers/gates.ts` (NEW)

### Current direct calls to migrate

**In `chapo-loop.ts` — `queueQuestion()` (lines 359-377):**
```ts
// CURRENT: direct state + stream
stateManager.addPendingQuestion(this.sessionId, questionPayload);
stateManager.setPhase(this.sessionId, 'waiting_user');
await stateManager.flushState(this.sessionId);
this.sendEvent({ type: 'user_question', question: questionPayload });

// AFTER: single domain event → projections handle both
await workflowBus.emit(createEvent(ctx, 'gate.question.queued', questionPayload, {
  source: 'chapo-loop',
  visibility: 'ui',
}));
```

**In `chapo-loop.ts` — `queueApproval()` (lines 379-407):**
```ts
// CURRENT:
stateManager.addPendingApproval(this.sessionId, approval);
stateManager.setPhase(this.sessionId, 'waiting_user');
await stateManager.flushState(this.sessionId);
this.sendEvent({ type: 'approval_request', request: approval, sessionId: this.sessionId });

// AFTER:
await workflowBus.emit(createEvent(ctx, 'gate.approval.queued', approval, {
  source: 'chapo-loop',
  visibility: 'ui',
}));
```

**In `router.ts` — `handleUserResponse()` (lines 352-400):**
```ts
// CURRENT:
const question = stateManager.removePendingQuestion(sessionId, questionId);
stateManager.addHistoryEntry(sessionId, historyAgent, 'respond', question, userResponse, { status: 'success' });
await stateManager.flushState(sessionId);
// Then re-runs processRequest

// AFTER:
await workflowBus.emit(createEvent(ctx, 'gate.question.resolved', { questionId, answer }, {
  source: 'router',
}));
// StateProjection handles removePendingQuestion + flush
// Then re-runs processRequest
```

**In `router.ts` — `handleUserApproval()` (lines 405-442):**
```ts
// CURRENT:
const approval = stateManager.removePendingApproval(sessionId, approvalId);
if (!approved) { stateManager.setPhase(sessionId, 'error'); ... }
stateManager.grantApproval(sessionId);
await stateManager.flushState(sessionId);

// AFTER:
await workflowBus.emit(createEvent(ctx, 'gate.approval.resolved', { approvalId, approved }, {
  source: 'router',
}));
```

**In `router.ts` — `handlePlanApproval()` (lines 1070-1096):**
```ts
// CURRENT:
stateManager.approvePlan(sessionId);
sendEvent?.({ type: 'plan_approved', planId });

// AFTER:
await workflowBus.emit(createEvent(ctx, 'gate.plan_approval.resolved', { planId, approved, reason }, {
  source: 'router',
  visibility: 'ui',
}));
```

Acceptance:

1. ASK/approval resume paths are deterministic and testable by event sequence
2. Gate state survives process restart (persisted via StateProjection flush)

---

## Phase 5 — Agent/Tool/Plan Events Migration (1.5 days)

### Target files:

1. `apps/api/src/agents/chapo-loop.ts` (MODIFY)
2. `apps/api/src/agents/router.ts` (MODIFY)
3. `apps/api/src/actions/approvalBridge.ts` (MODIFY — minor)

### Complete sendEvent call inventory in `chapo-loop.ts`

| Line(s) | Current `sendEvent` Call | Domain Event Replacement |
|---------|------------------------|--------------------------|
| 99 | `{ type: 'agent_start', agent: 'chapo', phase: 'execution' }` | `agent.started` |
| 105 | `{ type: 'agent_complete', agent: 'chapo', result }` | `agent.completed` |
| 106-109 | `{ type: 'agent_history', entries }` | `agent.history` (internal) |
| 123-127 | `{ type: 'agent_thinking', agent: 'chapo', status }` | `agent.thinking` |
| 146 | `{ type: 'error', agent: 'chapo', error }` | `agent.failed` |
| 193-197 | `{ type: 'agent_thinking', agent: 'chapo', status: 'Delegiere an DEVO...' }` | `agent.thinking` |
| 211-217 | `{ type: 'tool_result', agent: 'chapo', toolName, result, success: true }` | `tool.call.completed` |
| 233-237 | `{ type: 'agent_thinking', agent: 'chapo', status: 'Spawne SCOUT...' }` | `agent.thinking` |
| 251-257 | `{ type: 'tool_result', agent: 'chapo', toolName, result, success: true }` | `tool.call.completed` |
| 276-281 | `{ type: 'tool_call', agent: 'chapo', toolName, args }` | `tool.call.started` |
| 287-295 | `{ type: 'action_pending', ... }` | `tool.action.pending` |
| 301-307 | `{ type: 'tool_result', agent: 'chapo', toolName, result, success: false }` | `tool.call.failed` |
| 317-323 | `{ type: 'tool_result', agent: 'chapo', toolName, result, success: true }` | `tool.call.completed` |
| 369 | `{ type: 'user_question', question }` | `gate.question.queued` (Phase 4) |
| 395-399 | `{ type: 'approval_request', request, sessionId }` | `gate.approval.queued` (Phase 4) |
| 524-529 | `{ type: 'agent_switch', from: 'chapo', to: 'devo', reason }` | `agent.switched` |
| 530 | `{ type: 'delegation', from: 'chapo', to: 'devo', task }` | `agent.delegated` |
| 551 | `{ type: 'agent_thinking', agent: 'devo', status }` | `agent.thinking` |
| 629-634 | `{ type: 'tool_call', agent: 'devo', toolName, args }` | `tool.call.started` |
| 639-648 | `{ type: 'action_pending', ... }` (devo sub-loop) | `tool.action.pending` |
| 651-657 | `{ type: 'tool_result', agent: 'devo', toolName, result, success }` | `tool.call.completed` |
| 676-681 | `{ type: 'agent_switch', from: 'devo', to: 'chapo', reason }` | `agent.switched` |
| 682 | `{ type: 'agent_complete', agent: 'devo', result }` | `agent.completed` |

### Complete sendEvent call inventory in `router.ts`

| Line(s) | Current `sendEvent` Call | Domain Event Replacement |
|---------|------------------------|--------------------------|
| 279 | `{ type: 'agent_start', agent: 'chapo', phase: 'qualification' }` | `agent.started` |
| 343 | `{ type: 'error', agent, error }` | `agent.failed` |
| 471-472 | `{ type: 'perspective_start', agent: 'chapo' }` + thinking | `agent.thinking` |
| 540 | `{ type: 'perspective_complete', agent: 'chapo', perspective }` | plan-specific internal |
| 553-554 | `{ type: 'perspective_start', agent: 'devo' }` + thinking | `agent.thinking` |
| 629-634 | `{ type: 'tool_call', agent: 'devo', toolName, args }` (plan exploration) | `tool.call.started` |
| 637-646 | `{ type: 'action_pending', ... }` (plan exploration) | `tool.action.pending` |
| 649-655 | `{ type: 'tool_result', ... }` (plan exploration) | `tool.call.completed` |
| 696 | `{ type: 'perspective_complete', agent: 'devo', perspective }` | plan-specific internal |
| 710 | `{ type: 'agent_thinking', agent: 'chapo', status: 'Synthese...' }` | `agent.thinking` |
| 849 | `{ type: 'plan_start', sessionId }` | `plan.started` |
| 887 | `{ type: 'plan_ready', plan }` | `plan.ready` |
| 888 | `{ type: 'plan_approval_request', plan }` | `plan.approval_requested` |
| 892 | `{ type: 'task_created', task }` | `task.created` |
| 894 | `{ type: 'tasks_list', tasks }` | internal (tasks list sync) |
| 988-998 | `{ type: 'task_started', ... }` + `{ type: 'task_update', ... }` | `task.updated` |
| 1013-1023 | `{ type: 'task_completed', ... }` + `{ type: 'task_update', ... }` | `task.completed` + `task.updated` |
| 1033-1042 | `{ type: 'task_failed', ... }` + `{ type: 'task_update', ... }` | `task.failed` + `task.updated` |
| 1047-1051 | `{ type: 'task_update', taskId, status: 'skipped' }` | `task.updated` |
| 1086 | `{ type: 'plan_approved', planId }` | `plan.approved` (Phase 4) |
| 1092 | `{ type: 'plan_rejected', planId, reason }` | `plan.rejected` (Phase 4) |

### Complete stateManager direct mutation inventory

**In `chapo-loop.ts`:**

| Line | Call | Domain Event |
|------|------|-------------|
| 97 | `setPhase(sessionId, 'execution')` | via `agent.started` → StateProjection |
| 98 | `setActiveAgent(sessionId, 'chapo')` | via `agent.started` → StateProjection |
| 328 | `addGatheredFile(sessionId, path)` | Stays direct (informational, not workflow-critical) |
| 366 | `addPendingQuestion(sessionId, q)` | via `gate.question.queued` → StateProjection |
| 367 | `setPhase(sessionId, 'waiting_user')` | via `gate.question.queued` → StateProjection |
| 368 | `flushState(sessionId)` | via StateProjection (auto-flush on gate events) |
| 392 | `addPendingApproval(sessionId, a)` | via `gate.approval.queued` → StateProjection |
| 393 | `setPhase(sessionId, 'waiting_user')` | via `gate.approval.queued` → StateProjection |
| 394 | `flushState(sessionId)` | via StateProjection |
| 523 | `setActiveAgent(sessionId, 'devo')` | via `agent.switched` → StateProjection |
| 587 | `setActiveAgent(sessionId, 'chapo')` | via escalation event → StateProjection |
| 675 | `setActiveAgent(sessionId, 'chapo')` | via `agent.switched` → StateProjection |

**In `router.ts`:**

| Line | Call | Domain Event |
|------|------|-------------|
| 250 | `setOriginalRequest(sessionId, msg)` | via `workflow.turn.started` → StateProjection |
| 266-268 | `setOriginalRequest`, `setGatheredInfo` (x2) | via `workflow.turn.started` → StateProjection |
| 277-278 | `setPhase('qualification')`, `setActiveAgent('chapo')` | via `agent.started` → StateProjection |
| 283 | `setQualificationResult(sessionId, q)` | Stays direct (pre-loop setup) |
| 326 | `setPhase(sessionId, 'error')` | via `workflow.failed` → StateProjection |
| 331 | `setPhase(sessionId, 'error')` | via `workflow.failed` → StateProjection |
| 334-341 | `addHistoryEntry(...)` | via `workflow.failed` → StateProjection |
| 359 | `removePendingQuestion(sessionId, qId)` | via `gate.question.resolved` → StateProjection |
| 375-383 | `addHistoryEntry`, `flushState` | via `gate.question.resolved` → StateProjection |
| 413 | `removePendingApproval(sessionId, aId)` | via `gate.approval.resolved` → StateProjection |
| 420-426 | `setPhase`, `flushState`, `grantApproval` | via `gate.approval.resolved` → StateProjection |
| 860 | `createPlan(sessionId, perspective)` | via `plan.started` → StateProjection |
| 871 | `addDevoPerspective(sessionId, result)` | Stays direct (plan assembly) |
| 884 | `finalizePlan(sessionId, summary, tasks)` | Stays direct (plan assembly) |
| 962 | `startPlanExecution(sessionId)` | via plan execution start event |
| 987 | `updateTaskStatus(sessionId, taskId, 'in_progress')` | via `task.updated` → StateProjection |
| 1009-1012 | `updateTaskStatus(sessionId, taskId, 'completed', {...})` | via `task.completed` → StateProjection |
| 1030-1032 | `updateTaskStatus(sessionId, taskId, 'failed', {...})` | via `task.failed` → StateProjection |
| 1045 | `skipBlockedTasks(sessionId, taskId)` | Stays direct (cascading side effect) |
| 1059 | `completePlan(sessionId)` | via plan completion event |
| 1085 | `approvePlan(sessionId)` | via `gate.plan_approval.resolved` → StateProjection |
| 1091 | `rejectPlan(sessionId, reason)` | via `gate.plan_approval.resolved` → StateProjection |

### Migration approach

The `sendEvent` callback signature stays the same during migration. Inside `ChapoLoop`, the constructor receives a `sendEvent` that now wraps `workflowBus.emit()`:

```ts
// In CommandDispatcher, when creating sendEvent for ChapoLoop:
const sendEvent: SendEventFn = (event) => {
  const eventType = mapLegacyTypeToEventType(event.type);
  workflowBus.emit(createEvent(ctx, eventType, event, {
    source: 'chapo-loop',
    visibility: event.type === 'agent_thinking' ? 'log' : 'ui',
  }));
};
```

This bridge approach means `ChapoLoop` and `router.ts` can be migrated incrementally — their `sendEvent` calls don't change syntax initially, only the implementation behind the callback changes.

Acceptance:

1. No ad-hoc workflow event literals in orchestration core
2. `events.ts` becomes the reference for type definitions; runtime uses envelope factory

---

## Phase 6 — Markdown/Audit Hardening (0.5 day)

### Target files:

1. `apps/api/src/audit/sessionLogger.ts` (MODIFY)
2. `apps/api/src/workflow/projections/markdownLogProjection.ts` (MODIFY)
3. `apps/api/src/audit/logger.ts` (UNCHANGED — used by AuditProjection)

### Bug fix: `sessionLogger.ts:201`

```ts
// Line 201 CURRENT (broken):
case 'user_question': {
  const q = event.question as Record<string, unknown> | undefined;
  this.append(`### [${ts()}] User Question\n\n${q?.text || JSON.stringify(q)}\n\n`);
  break;
}

// FIXED:
case 'user_question': {
  const q = event.question as Record<string, unknown> | undefined;
  this.append(`### [${ts()}] User Question\n\n${q?.question || JSON.stringify(q)}\n\n`);
  break;
}
```

The `UserQuestion` interface (from `types.ts`) has a `question` field, not `text`:
```ts
interface UserQuestion {
  questionId: string;
  question: string;       // <-- this field
  fromAgent: AgentName;
  timestamp: string;
}
```

### Add correlation metadata to markdown sections

```ts
// Before (current):
this.append(`### [${ts()}] Agent Start: ${event.agent} (${event.phase})\n\n`);

// After (with correlation):
this.append(`### [${ts()}] Agent Start: ${event.agent} (${event.phase})\n<!-- eventId=${event.eventId} requestId=${event.requestId} turnId=${event.turnId} -->\n\n`);
```

The HTML comment approach keeps the markdown readable while embedding machine-parseable correlation data.

### Remove direct logAgentEvent calls

After Phase 5, the `loggedSendEvent` wrapper in `routes.ts:303-306` is no longer needed. All markdown writes go through `MarkdownLogProjection` → `SessionLogger`.

Direct `sessionLogger.logUser(message)` and `sessionLogger.finalize()` calls also move into the projection:
- `logUser()` → triggered by `command.user.request_submitted` (in MarkdownLogProjection)
- `finalize()` → triggered by `workflow.completed` or `workflow.failed` (in MarkdownLogProjection)

Acceptance:

1. WS stream + markdown logs are semantically aligned per turn
2. `q?.text` bug is fixed
3. Correlation IDs appear in markdown as HTML comments

---

## Phase 7 — Cleanup + Dead Code Removal (0.5 day)

### Tasks:

1. **Remove `loggedSendEvent`** wrapper in `routes.ts:303-306`
2. **Remove duplicated response construction** across 4 WS branches
3. **Simplify router command branches** to thin mappers → `CommandDispatcher.dispatch()`
4. **Review `events.ts`** — if all event creation now goes through envelope factory, mark old factory functions as `@deprecated` or remove if no other consumers exist
5. **Remove direct `stateManager` mutations** from `chapo-loop.ts` and `router.ts` (except the whitelisted informational ones like `addGatheredFile`, `setQualificationResult`, `addDevoPerspective`, `finalizePlan`)
6. **Update tests and snapshots** to new canonical flow
7. **Remove feature flag** `WORKFLOW_EVENT_PIPELINE_V1` after parity validation passes

### Dead code candidates:

| Code | Location | Status After Migration |
|------|----------|----------------------|
| `loggedSendEvent` wrapper | `routes.ts:303-306` | REMOVE |
| Duplicated response construction | `routes.ts:324-357, 392-412, 428-456, 472-493` | REPLACE with ResponseComposer |
| Direct `sendEvent` closure | `routes.ts:221-229` | REPLACE with bus-backed sendEvent |
| `sendEvent` / `createEventSender` | `events.ts:488-507` | DEPRECATE (superseded by envelope factory) |

---

## 9) Testing Strategy

### 9.1 Unit Tests

1. `envelope.ts`: validate required metadata, factory correctness
2. `bus.ts`: projection ordering, idempotency guard (`eventId` replay rejected)
3. `stateProjection.ts`: state transition correctness for each event type
4. `streamProjection.ts`: domain event → WS stream event mapping correctness
5. `markdownLogProjection.ts`: markdown mapping correctness (`user_question.question`)
6. `auditProjection.ts`: selected events audited, sensitive data redacted

### 9.2 Integration Tests

1. WS command → event sequence → final response (full pipeline)
2. Reconnect replay (`hello`/`sinceSeq`) consistency with new bus
3. ASK/approval flow across restart (persist + resume)
4. Plan approval and task update stream consistency

### 9.3 End-to-End QA Matrix (must pass)

1. `LC-ASK-01`: ambiguous request → `gate.question.queued` → WS `user_question` → persisted pending question in state
2. `LC-ASK-02`: question answer → `gate.question.resolved` → continues workflow → `workflow.completed`
3. `LC-TOL-02`: tool error → `tool.call.failed` → error fed back to LLM → no hard crash
4. `LC-AGT-01/02/03`: delegation → `agent.delegated` + `agent.switched` → sub-loop → `agent.completed` → ordered domain + stream events
5. `LC-CTX-01`: yes/no gating → `command.user.approval_decided` → `gate.approval.resolved` → resume
6. `LC-LOG-01` (new): markdown log captures same semantic milestones as WS stream
7. `LC-LOG-02` (new): event correlation IDs present in markdown sections as HTML comments

### 9.4 Observability Checks

1. Compare one session across:
   - WS replay buffer (chatGateway ring buffer)
   - State snapshot (stateManager in-memory)
   - Markdown log file (var/logs/*.md)
   - Audit log (var/audit.log)
2. Verify no missing terminal event (`workflow.completed` or `workflow.failed`)
3. Verify seq monotonicity in WS replay buffer

---

## 10) Documentation Updates (Mandatory)

1. `docs/architecture.md`
   - add section: "Workflow Event Pipeline"
   - add command/domain/projection diagram (the one from 5.1)
   - update request flow and streaming sections to reference projections
   - document logging projections and retention

2. `docs/plans/2026-02-19-unified-workflow-event-pipeline.md`
   - this document remains source plan until implementation done

3. New runbook:
   - `docs/runbooks/workflow-events-and-logs.md`
   - includes debugging path for mismatches between UI/state/markdown
   - includes `eventId`/`requestId` correlation lookup instructions

4. Optional ADR:
   - `docs/adr/2026-02-19-workflow-event-pipeline.md`

---

## 11) Rollout and Safety

### Rollout Strategy

1. Feature flag: `WORKFLOW_EVENT_PIPELINE_V1` (in `.env` on Clawd)
2. Shadow mode first:
   - Old path remains primary (direct sendEvent + stateManager calls)
   - New event pipeline runs in parallel and logs diagnostics
   - Both paths execute — bus projections log but old code still does the real work
3. Parity validation on dev:
   - Compare WS events from both paths
   - Compare markdown logs from both paths
   - Compare state snapshots from both paths
4. Switch primary to event pipeline after parity pass
5. Remove old direct paths in Phase 7

### Shadow mode implementation:

```ts
// During shadow mode, sendEvent calls both paths:
const sendEvent = (event: AgentStreamEvent) => {
  // OLD PATH (primary):
  emitChatEvent(sessionId, { ...event, requestId });

  // NEW PATH (shadow):
  if (process.env.WORKFLOW_EVENT_PIPELINE_V1 === '1') {
    try {
      const domainEvent = createEvent(ctx, mapType(event.type), event, { source: 'chapo-loop' });
      workflowBus.emit(domainEvent); // projections log but don't duplicate side effects
    } catch (err) {
      console.warn('[shadow-pipeline] Error:', err);
    }
  }
};
```

### Rollback Strategy

1. Disable feature flag (`WORKFLOW_EVENT_PIPELINE_V1=0`)
2. Return to previous imperative path
3. Retain generated logs for forensic comparison

---

## 12) Risks and Mitigations

1. **Risk:** Double-emission during migration
   **Mitigation:** event dedupe by `eventId` in bus; shadow mode logs only, doesn't duplicate WS sends; clear migration boundaries per phase.

2. **Risk:** Log spam from high-frequency events
   **Mitigation:** markdown projection filters noisy event types (`agent.thinking`, `system.heartbeat`) — same as current `logAgentEvent` which skips `agent_thinking`.

3. **Risk:** Frontend regressions due protocol drift
   **Mitigation:** `StreamProjection` maps domain events to exact same WS event shapes as current code. The frontend never sees domain events directly.

4. **Risk:** hidden direct state writes remain
   **Mitigation:** lint/checklist rule during PR review: all workflow mutations must originate in projections. The inventory tables in Phase 5 serve as the complete checklist.

5. **Risk:** Performance overhead from bus dispatch
   **Mitigation:** bus is in-process synchronous dispatch (no network, no serialization). Projections are lightweight wrappers around existing calls. Overhead is negligible.

---

## 13) Definition of Done

1. All workflow-affecting WS commands pass through unified command dispatcher.
2. Domain events are canonical internal representation.
3. State, stream, markdown, and audit are projection-driven.
4. ASK/approval/plan approval flows survive restarts and replay.
5. QA matrix passes including log-consistency tests.
6. Architecture and runbook docs updated and accurate.
7. `sessionLogger.ts` bug (`q?.text` → `q?.question`) is fixed.
8. Feature flag removed after parity validation.

---

## 14) Handoff Checklist for Claude Code

1. Implement phases sequentially from 0 to 7.
2. After each phase:
   - run targeted tests
   - capture event sequence sample (one request flow)
   - update this plan with completion notes
3. Keep commits phase-scoped and reviewable.
4. Do not change ports/infra/env as part of this feature.
5. Validate `.md` log output on server path `var/logs` before final rollout.
6. Use the call inventories in Phase 5 as the migration checklist — check off each `sendEvent` and `stateManager.*` call as it's migrated.

---

## 15) File Impact Summary

| File | Phase | Action |
|------|-------|--------|
| `apps/api/src/workflow/events/envelope.ts` | 1 | CREATE |
| `apps/api/src/workflow/events/catalog.ts` | 1 | CREATE |
| `apps/api/src/workflow/events/bus.ts` | 1 | CREATE |
| `apps/api/src/workflow/commands/types.ts` | 1 | CREATE |
| `apps/api/src/workflow/commands/dispatcher.ts` | 1,3 | CREATE |
| `apps/api/src/workflow/context/requestContext.ts` | 1 | CREATE |
| `apps/api/src/workflow/projections/stateProjection.ts` | 2 | CREATE |
| `apps/api/src/workflow/projections/streamProjection.ts` | 2 | CREATE |
| `apps/api/src/workflow/projections/markdownLogProjection.ts` | 2,6 | CREATE |
| `apps/api/src/workflow/projections/auditProjection.ts` | 2 | CREATE |
| `apps/api/src/workflow/projections/index.ts` | 2 | CREATE |
| `apps/api/src/workflow/handlers/gates.ts` | 4 | CREATE |
| `apps/api/src/websocket/routes.ts` | 3,7 | MODIFY |
| `apps/api/src/agents/router.ts` | 4,5 | MODIFY |
| `apps/api/src/agents/chapo-loop.ts` | 4,5 | MODIFY |
| `apps/api/src/audit/sessionLogger.ts` | 6 | MODIFY (bug fix + correlation) |
| `apps/api/src/agents/events.ts` | 7 | DEPRECATE or REMOVE |
| `docs/adr/2026-02-19-workflow-event-pipeline.md` | 0 | CREATE |
| `docs/runbooks/workflow-events-and-logs.md` | 7 | CREATE |
| `docs/architecture.md` | 7 | MODIFY |
