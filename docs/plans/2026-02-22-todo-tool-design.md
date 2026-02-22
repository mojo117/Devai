# Todo Tool — Self-Managed Task Tracking

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the heavy PlanTask/Plan Mode system with a simple `todoWrite` tool that CHAPO uses as a self-managed scratchpad, trusting the model to organize itself.

**Architecture:** Single overwrite-semantics tool, per-session persistent storage, frontend visibility via `todo_updated` events. Full removal of Plan Mode pipeline.

**Tech Stack:** TypeScript, Fastify WebSocket, existing CHAPO loop + tool system

---

## Problem Analysis

The current Plan Mode system is over-engineered for what it does:

1. **PlanTask is heavy** — `planId`, `blockedBy`, `toolsToExecute`, `assignedAgent`, dependency graphs, recursive skip-on-failure. 317 lines of task state management for a feature that's auto-approved in trusted mode anyway.

2. **Plan Mode adds latency** — Multi-perspective analysis (CHAPO + DEVO perspectives), plan synthesis, approval gates. Multiple LLM calls before any work starts.

3. **The model is smart enough** — GLM-5 can break down complex tasks itself. It doesn't need an external orchestration system to tell it what steps to take.

4. **Context rot is the real problem** — In long sessions, the model drifts from the original goal. A simple self-managed todo list (like Claude Code's `TodoWrite`) solves this without heavy infrastructure.

## Design Decisions

### Decision: Single overwrite tool (not CRUD)

`todoWrite` replaces the entire list each call. The model sends the full array of items with statuses.

**Rationale:** This is what Claude Code uses. No ID management, no partial updates that could desync. The model just dumps its current mental state. Token cost is minimal — a 10-item todo list is ~200 tokens.

**Alternative considered:** Separate `todoAdd`, `todoUpdate`, `todoList` tools. Rejected — more granular but adds complexity for marginal benefit. The model would need to track IDs and the tools could desync.

### Decision: Model decides when to use it

No system-reminder nudge, no complexity-based trigger. The prompt tells CHAPO the tool exists and when it's useful. CHAPO decides whether a task needs a todo list.

**Rationale:** Consistent with "trust the model" philosophy. Trivial tasks don't get cluttered with unnecessary todo lists. Complex tasks naturally warrant one.

### Decision: Per-session persistent

The todo list survives across turns within the same session. If CHAPO was halfway through and gets interrupted, it can pick up where it left off.

**Rationale:** Essential for multi-message v2 — CHAPO juggles multiple tasks across inbox messages. The todo list tracks what's done and what's pending across the full session.

### Decision: Replace PlanTask entirely

Plan Mode, plan synthesizer, plan executor, task state — all removed. Complex tasks go straight to the ChapoLoop like everything else.

**Rationale:** The approval gate is unused (trusted mode auto-approves). Multi-perspective analysis adds latency without proportional value. The model can self-organize with a simple todo list.

---

## Architecture Changes

### 1. `todoWrite` Tool

**Tool definition:**
```typescript
{
  name: 'todoWrite',
  description: 'Schreibe oder aktualisiere deine persoenliche Todo-Liste. Sende immer die KOMPLETTE Liste — sie wird jedes Mal ueberschrieben.',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'Die komplette Todo-Liste.',
        items: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'Was zu tun ist.',
            },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed'],
              description: 'Aktueller Status.',
            },
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

**Backend behavior:**
1. Store the todo list in session state (`ConversationState.todos`)
2. Emit `todo_updated` WebSocket event with the full list
3. Return tool result with a summary (e.g. "2/5 completed") so the model sees its progress
4. List persists across turns within the session

### 2. Session State

Add `todos` field to `ConversationState`:

```typescript
interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

// In ConversationState:
todos: TodoItem[];
```

### 3. `todo_updated` Stream Event

```typescript
// Add to AgentStreamEvent union:
| { type: 'todo_updated'; todos: TodoItem[] }
```

### 4. Frontend Handler

```typescript
case 'todo_updated': {
  // Render/update inline checklist in chat flow
  // Checkmark for completed, spinner for in_progress, circle for pending
  // Collapses to summary when all completed
  break;
}
```

### 5. CHAPO Prompt Addition

```
## TODO-LISTE
Du hast ein todoWrite-Tool als persoenlichen Notizblock.
Nutze es wenn eine Aufgabe mehrere Schritte hat, um dich selbst zu organisieren.
- Erstelle eine Todo-Liste bevor du mit komplexen Aufgaben beginnst
- Aktualisiere den Status waehrend du arbeitest
- Fuege neue Punkte hinzu wenn du unterwegs etwas entdeckst
- Bei einfachen Fragen oder Smalltalk brauchst du keine Todo-Liste
```

### 6. Simplify `requestFlow.ts`

Remove the entire Plan Mode gate. The new flow:

```typescript
processRequest():
  // Quick exits (yes/no, smalltalk, remember)
  // Task complexity classification + model selection
  // ChapoLoop.run() — for ALL tasks
  // Return result
```

No more `determinePlanModeRequired`, `assessPlanModeNeed`, `runPlanMode`, `handlePlanApproval`.

### 7. Remove Plan Mode System

**Files to delete:**
- `apps/api/src/agents/router/planMode.ts`
- `apps/api/src/agents/router/planSynthesizer.ts`
- `apps/api/src/agents/router/planExecutor.ts`
- `apps/api/src/agents/state-manager/planState.ts`
- `apps/api/src/agents/state-manager/taskState.ts`

**Types to remove from `types.ts`:**
- `PlanTask`, `ExecutionPlan`, `AgentPerspective`, `PlannedToolCall`, `ExecutedTool`, `TaskStatus`, `TaskPriority`
- Plan/task stream events: `plan_start`, `plan_ready`, `plan_approval_request`, `plan_approved`, `plan_rejected`, `task_created`, `task_update`, `task_started`, `task_completed`, `task_failed`, `tasks_list`
- `AgentPhase` entries: `planning`, `waiting_plan_approval`

**Event catalog cleanup (`catalog.ts`):**
- Remove plan event constants and payload interfaces
- Remove task event constants and payload interfaces
- Remove legacy type map entries for plan/task events

**Keep:** `classifyTaskComplexity` — still used for model selection and iteration limits.

---

## Flow Example

### Complex task with todo

```
User: "Refactore das Auth-Modul und update alle Tests"

Iteration 1: CHAPO calls todoWrite([
  { content: "Auth-Modul Struktur analysieren", status: "in_progress" },
  { content: "Alle Imports identifizieren", status: "pending" },
  { content: "Auth-Modul refactoren", status: "pending" },
  { content: "Tests aktualisieren", status: "pending" },
  { content: "Test-Suite ausfuehren", status: "pending" },
])
→ Frontend shows checklist

Iteration 2: CHAPO calls delegateToScout to analyze structure
Iteration 3: SCOUT result → CHAPO calls todoWrite (item 1 completed, item 2 in_progress)
→ Frontend updates checklist

... CHAPO works through items, delegating to DEVO as needed ...

Iteration N: All items completed → CHAPO answers with summary
```

### Multi-message with todo

```
User: "Fix the login bug"           → Loop starts
User: "What's the weather?"         → Inbox queue

Iteration 1: CHAPO calls todoWrite([
  { content: "Login-Bug analysieren und fixen", status: "in_progress" },
])

Iteration 2: checkInbox() → "What's the weather?" injected
Iteration 3: CHAPO calls todoWrite([
  { content: "Login-Bug analysieren und fixen", status: "in_progress" },
  { content: "Wetter-Anfrage beantworten", status: "pending" },
])

Iteration 4: CHAPO calls web_search for weather
Iteration 5: CHAPO calls respondToUser("In Darmstadt sind es 15°C")
             → calls todoWrite (weather completed)
Iteration 6: CHAPO delegates login fix to DEVO
...
```

---

## Implementation Order

1. **Add TodoItem type and session state** — type definition, add `todos: TodoItem[]` to ConversationState
2. **Add `todoWrite` tool** — tool definition in chapo.ts, handler in toolExecutor.ts, `todo_updated` event
3. **Frontend `todo_updated` handler** — render inline checklist
4. **CHAPO prompt update** — add TODO-LISTE section
5. **Remove Plan Mode** — delete planMode.ts, planSynthesizer.ts, planExecutor.ts, planState.ts, taskState.ts
6. **Simplify requestFlow.ts** — remove Plan Mode gate, complex tasks go straight to ChapoLoop
7. **Clean up types and events** — remove PlanTask types, plan/task events, phases
