# Autonomy: Intake Seed + Todo Exit Gate + Heartbeat Loop

> **Goal:** Make DevAI self-reliant — no silent message drops, proactive background work.
> **Date:** 2026-02-23

---

## Problem

Two core issues with DevAI's current behavior:

1. **Silent message drops** — When multiple messages arrive (e.g. "Show to-do list" + "What's the weather"), CHAPO latches onto one and silently ignores the other. The model knows it should use `todoWrite` to track multi-part requests but doesn't reliably do it.

2. **No autonomous initiative** — DevAI only works when spoken to. It never monitors logs, reviews past sessions, or acts on its own. No proactive behavior between user interactions.

### Root Cause Analysis

CHAPO's self-diagnosis of the weather/to-do failure:
> "Ich habe die Multi-Part-Request-Regel nicht angewendet. Zu schnell auf den ersten Teil reagiert, den zweiten verschluckt."

The model has the right instructions but doesn't reliably follow them. This is an **attention failure**, not a missing feature. The fix is structural enforcement at the boundaries (intake + exit), not more prompt instructions.

---

## Design Decisions

### Decision: Intake Seed (code-level, not prompt-level)

Don't rely on CHAPO to voluntarily create the initial todo list. A separate, fast model call extracts discrete requests BEFORE the loop starts.

**Rationale:** CHAPO already knows it should track multi-part requests. It just doesn't do it reliably. A code-level intake step ensures nothing gets dropped, regardless of model attention. CHAPO retains full control to edit the list during execution.

**Alternative considered:** Stronger prompts / system reminders. Rejected — the current prompt already tells CHAPO to use todoWrite for multi-part requests. Repeating it louder doesn't fix attention failures.

### Decision: Exit Gate (code-level enforcement)

Before the loop can exit with an answer, check if all todos are resolved. Unresolved items bounce the loop back.

**Rationale:** Mirrors how Claude Code tracks task completion — structural accountability, not voluntary compliance. Light-touch: only checks `pending` status, max 2 bounces, doesn't block on loop exhaustion.

### Decision: Heartbeat every 120 minutes (not 30)

**Rationale:** Cost-efficient, sufficient for catching stale issues. At ~0.01 EUR per call, 7 heartbeats/day (07:00-21:00) costs ~0.07 EUR/day. More frequent checks would add cost without proportional value — logs and sessions don't change that fast.

### Decision: Heartbeat checks logs + chat history (not TaskForge)

**Rationale:** TaskForge tasks are user-managed externally. The heartbeat should focus on DevAI's own operational health: failed sessions, unanswered messages, recurring errors, memory items.

### Decision: Persist heartbeat runs in Supabase

**Rationale:** Enables pattern recognition (are heartbeats finding useful things?), cost tracking, and debugging. Also serves as a health signal — if heartbeat_runs stops getting new rows, something is broken.

---

## Architecture

### 1. Intake Seed

**Location:** `apps/api/src/services/intakeSeed.ts`
**Called from:** `processRequest()` in `agents/router.ts`, before ChapoLoop start

A fast, cheap model call (GLM-4.7-Flash, free tier) that receives the user message and outputs a JSON array of discrete requests.

**Prompt (~100 tokens):**
```
Extract all discrete requests from this user message.
Return JSON array: [{ "content": "..." }, ...]
Single requests -> single item. No interpretation, no sub-tasks.
```

**Behavior:**
- Runs in parallel with `warmSystemContextForSession()` — no added latency
- Simple messages ("Hallo") -> single item or empty array
- Multi-part messages -> one item per discrete request
- Result becomes initial `ConversationState.todos` with status `pending`

**Cost:** ~0.002 EUR per message (Flash, free tier). Latency: ~150-300ms.

**Integration in processRequest():**
```
processRequest(sessionId, userMessage, history, ...):
  1. Quick exits (yes/no, approvals)              <- unchanged
  2. classifyTaskComplexity()                      <- unchanged
  3. intakeSeed(userMessage) -> TodoItem[]          <- NEW
  4. ChapoLoop.run(userMessage, history, initialTodos)  <- pass todos
```

### 2. todoWrite Tool

**As designed in `2026-02-22-todo-tool-design.md`** — no changes to the tool itself.

- Overwrite semantics, CHAPO sends full array each call
- Per-session persistent in `ConversationState.todos`
- Emits `todo_updated` WebSocket event
- CHAPO has full control: add items, update statuses, reorder, remove

**Tool definition:**
```typescript
{
  name: 'todoWrite',
  description: 'Schreibe oder aktualisiere deine persoenliche Todo-Liste. Sende immer die KOMPLETTE Liste.',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          },
          required: ['content', 'status'],
        },
      },
    },
    required: ['todos'],
  },
  requiresConfirmation: false,
}
```

### 3. Exit Gate

**Location:** `apps/api/src/agents/chapo-loop.ts`, at the ANSWER decision point

Before the loop exits with `status: 'completed'`, check `ConversationState.todos`:

```
runLoop() iteration:
  +-- LLM response has no tool_calls?
  |   +-- EXIT GATE: any todos with status 'pending'?
  |   |   +-- YES -> inject system message, continue loop
  |   |   |   "Du hast noch offene Punkte:
  |   |   |    - [ ] <pending item>
  |   |   |    Bearbeite sie oder nutze todoWrite um sie als erledigt zu markieren."
  |   |   |
  |   |   +-- NO -> normal exit (self-validate, answer, return)
```

**Three rules:**
1. **Only `pending` blocks** — `in_progress` does not trigger the gate (CHAPO is working on it), `completed` is done.
2. **Max 2 bounces** — If CHAPO gets bounced twice with the same pending items, let it through. Prevents infinite loops.
3. **No gate on loop exhaustion** — When `maxIterations` is reached, exit anyway (with user hint).

### 4. Inbox Integration

When a message arrives during a running loop:

```
Message arrives while loop is running:
  +-- isLoopRunning? -> YES
  |   +-- intakeSeed(newMessage) -> new TodoItems
  |   +-- Append to ConversationState.todos (status: 'pending')
  |   +-- Emit todo_updated event to frontend
  |   +-- checkInbox() injects as before, BUT:
  |       the new todos are now also in state
  |       -> Exit Gate catches them if CHAPO ignores them
```

**Key difference from current:** Inbox messages are no longer just ephemeral hints in conversation context. Each has a material counterpart in the todo state that triggers the exit gate.

### 5. Heartbeat Loop

**Location:** `apps/api/src/services/heartbeatService.ts`
**Scheduled by:** `scheduler/schedulerService.ts`

```
Scheduler (every 120 min, 07:00-21:00):
  +-- heartbeatService.run()
      +-- isQuietHours()? -> return (no DB entry, no LLM call)
      +-- insertHeartbeatRun({ status: 'running' })
      +-- processRequest(sessionId: 'heartbeat-YYYY-MM-DD', message: HEARTBEAT_PROMPT)
      +-- updateHeartbeatRun(id, { status, findings, actions_taken, ... })
```

**Quiet hours:** 21:00-07:00 (no heartbeat, no LLM calls, no notifications)

```typescript
function isQuietHours(): boolean {
  const hour = new Date().getHours()  // Server time (Europe/Berlin)
  return hour >= 21 || hour < 7
}
```

**HEARTBEAT_PROMPT:**
```
Heartbeat-Check. Pruefe:

1. Chat-Historie — Gibt es kuerzliche Sessions mit unbeantwortet gebliebenen
   Fragen, abgebrochenen Loops oder Fehlermeldungen? (Supabase: sessions + messages)

2. Logs — Pruefe die API-Logs auf wiederkehrende Fehler, Timeouts oder
   auffaellige Muster der letzten 120 Minuten. (PM2 logs devai-api-dev)

3. Eigene Memory — Hast du dir etwas gemerkt, worauf du reagieren solltest?
   Offene Erinnerungen, anstehende Aufgaben aus vorherigen Sessions?

Wenn nichts ansteht: Antworte mit "NOOP" — keine Aktion, kein Output.
Wenn etwas ansteht: Handle es oder benachrichtige den User via Telegram.
```

**No Web-UI output.** Heartbeats run in their own session (`heartbeat-YYYY-MM-DD`). Only explicit notifications (via `notify_user` / Telegram) reach the user.

**Cost:** ~7 heartbeats/day (every 120 min, 14h active) x ~0.01 EUR = ~0.07 EUR/day.

### 6. Heartbeat Persistence

**New Supabase table: `heartbeat_runs`**

```sql
create table heartbeat_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null check (status in ('running', 'completed', 'failed', 'noop')),
  findings jsonb,
  actions_taken jsonb,
  tokens_used integer,
  model text,
  error text,
  duration_ms integer
)
```

**Status values:**
- `noop` — Nothing found (most common)
- `completed` — Found something, acted on it or notified user
- `running` — Currently executing (crash detection: if stuck for >10 min, something broke)
- `failed` — LLM call or DB query failed

**DB queries added to `db/queries.ts`:**
- `insertHeartbeatRun(run: Partial<HeartbeatRun>): Promise<string>` — returns id
- `updateHeartbeatRun(id: string, update: Partial<HeartbeatRun>): Promise<void>`
- `getRecentHeartbeatRuns(limit: number): Promise<HeartbeatRun[]>`
- `getRecentFailedSessions(sinceMinutes: number): Promise<SessionRow[]>`
- `getUnansweredMessages(sinceMinutes: number): Promise<MessageRow[]>`

### 7. Frontend — TodoCard

**Location:** `apps/web/src/components/TodoCard.tsx`

Inline card in chat message flow:

```
+------------------------------------------+
| Chapo's Aufgaben                         |
|                                          |
| [check] Wetter morgen in Gross-Umstadt   |
| [spin]  Vollstaendige To-Do Liste        |
| [ ]     Ergebnisse zusammenfassen        |
|                                          |
| 1/3 erledigt                             |
+------------------------------------------+
```

- `[ ]` = `pending` (gray circle)
- `[spin]` = `in_progress` (animated spinner/pulse)
- `[check]` = `completed` (green checkmark, strikethrough text)

**Behavior:**
1. First `todo_updated` — TodoCard appears as new card in chat
2. Subsequent updates — Same card updates in-place (no new block)
3. All completed — Card collapses to single line: "3/3 Aufgaben erledigt"
4. Read-only — User cannot edit todos, only CHAPO controls them

**Integration in ChatUI.tsx:**
```typescript
case 'todo_updated': {
  // Find existing TodoCard or create new
  // Update todos in-place via React state
  break
}
```

No new hook needed. TodoCard receives `todos: TodoItem[]` as props.

---

## File Changes

### New Files

| File | Responsibility |
|------|----------------|
| `apps/api/src/services/intakeSeed.ts` | User message -> TodoItem[] extraction |
| `apps/api/src/services/heartbeatService.ts` | Heartbeat orchestration |
| `apps/web/src/components/TodoCard.tsx` | Todo card rendering |

### Modified Files

| File | Change |
|------|--------|
| `apps/api/src/agents/router.ts` | intakeSeed() call before ChapoLoop |
| `apps/api/src/agents/chapo-loop.ts` (or sub-module) | Exit Gate before answer return |
| `apps/api/src/agents/types.ts` | TodoItem interface |
| `apps/api/src/agents/state-manager/core.ts` | todos in ConversationState |
| `apps/api/src/agents/chapo.ts` | todoWrite tool definition |
| `apps/api/src/agents/chapo-loop/toolExecutor.ts` | todoWrite handler |
| `apps/api/src/agents/events.ts` | todo_updated event type |
| `apps/api/src/agents/inbox.ts` | intakeSeed on inbox messages |
| `apps/api/src/db/queries.ts` | Heartbeat + session failure queries |
| `apps/api/src/scheduler/schedulerService.ts` | Heartbeat cron job registration |
| `apps/api/src/prompts/chapo.ts` | TODO-LISTE prompt section |
| `apps/web/src/components/ChatUI.tsx` | todo_updated event handler |
| `docs/architecture.md` | New sections: Intake Seed, Exit Gate, Heartbeat Loop |

### Removed (from todo-tool-design)

Plan Mode system removal as specified in `2026-02-22-todo-tool-design.md`:
- `agents/router/planMode.ts`
- `agents/router/planSynthesizer.ts`
- `agents/router/planExecutor.ts`
- `agents/state-manager/planState.ts`
- `agents/state-manager/taskState.ts`
- Related types and events from `types.ts` and `events.ts`

---

## Implementation Order

1. **TodoItem type + session state** — type definition, add to ConversationState
2. **todoWrite tool** — tool definition in chapo.ts, handler in toolExecutor.ts, todo_updated event
3. **Intake Seed service** — intakeSeed.ts, integrate in router.ts
4. **Exit Gate** — check in chapo-loop.ts before answer return
5. **Inbox integration** — intakeSeed on inbox messages, append to todos
6. **CHAPO prompt update** — TODO-LISTE section
7. **Frontend TodoCard** — component + ChatUI handler
8. **Remove Plan Mode** — delete files, clean up types/events
9. **Heartbeat table** — create heartbeat_runs in Supabase
10. **Heartbeat service** — heartbeatService.ts, scheduler registration
11. **Heartbeat DB queries** — session/message failure queries
12. **Architecture docs update** — new sections in architecture.md
