# Autonomy: Intake Seed + Exit Gate + Heartbeat — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make DevAI self-reliant — no silent message drops via intake seed + exit gate, proactive background work via heartbeat loop.

**Architecture:** Light code-level bookends (intake seed before loop, exit gate before answer) ensure every user request gets tracked as a TodoItem. Heartbeat service runs every 120 min during active hours to check logs, chat history, and memory.

**Tech Stack:** TypeScript, Fastify, Supabase, ZAI GLM-4.7-Flash (intake seed), React (TodoCard)

**Design doc:** `docs/plans/2026-02-23-autonomy-intake-heartbeat-design.md`

**TaskForge:** `Devai:699caed`

---

## Pre-existing Infrastructure (already built, do NOT recreate)

These already exist in the codebase — the plan builds on them:

| Component | File | Status |
|-----------|------|--------|
| `TodoItem` interface | `agents/types.ts:215-218` | Exists |
| `todos: TodoItem[]` in ConversationState | `agents/types.ts:230` | Exists |
| Default `todos: []` in buildDefaultState | `state-manager/core.ts:33` | Exists |
| `todoWrite` tool definition | `agents/chapo.ts:114-142` | Exists |
| `todoWrite` in CHAPO_AGENT.tools | `agents/chapo.ts:54` | Exists |
| `todoWrite` handler | `chapo-loop/toolExecutor.ts:95-121` | Exists |
| `TodoEvents.updated()` factory | `agents/events.ts:344-351` | Exists |
| `todo_updated` case in ChatUI | `ChatUI/ChatUI.tsx:~240` | Exists (no-op) |
| Multi-part prompt section | `prompts/chapo.ts:60-84` | Exists |
| `schedulerService.registerInternalJob()` | `scheduler/schedulerService.ts:218` | Exists |

---

## Task 1: Intake Seed Service

**Files:**
- Create: `apps/api/src/services/intakeSeed.ts`
- Create: `apps/api/src/services/intakeSeed.test.ts`

**Step 1: Write the test file**

```typescript
// apps/api/src/services/intakeSeed.test.ts
import { describe, it, expect } from 'vitest'
import { buildIntakeSeedPrompt, parseIntakeSeedResponse } from './intakeSeed.js'
import type { TodoItem } from '../agents/types.js'

describe('intakeSeed', () => {
  describe('buildIntakeSeedPrompt', () => {
    it('builds prompt with user message embedded', () => {
      const prompt = buildIntakeSeedPrompt('Zeig mir die To-Do Liste und wie wird das Wetter')
      expect(prompt).toContain('Zeig mir die To-Do Liste und wie wird das Wetter')
      expect(prompt).toContain('JSON array')
    })
  })

  describe('parseIntakeSeedResponse', () => {
    it('parses valid JSON array', () => {
      const raw = '[{"content":"To-Do Liste anzeigen"},{"content":"Wetter morgen"}]'
      const result = parseIntakeSeedResponse(raw)
      expect(result).toEqual([
        { content: 'To-Do Liste anzeigen', status: 'pending' },
        { content: 'Wetter morgen', status: 'pending' },
      ])
    })

    it('returns empty array for invalid JSON', () => {
      expect(parseIntakeSeedResponse('not json')).toEqual([])
    })

    it('returns empty array for empty array response', () => {
      expect(parseIntakeSeedResponse('[]')).toEqual([])
    })

    it('handles JSON wrapped in markdown code block', () => {
      const raw = '```json\n[{"content":"Task 1"}]\n```'
      const result = parseIntakeSeedResponse(raw)
      expect(result).toEqual([{ content: 'Task 1', status: 'pending' }])
    })

    it('filters items with empty content', () => {
      const raw = '[{"content":"Real task"},{"content":""},{"content":"  "}]'
      const result = parseIntakeSeedResponse(raw)
      expect(result).toEqual([{ content: 'Real task', status: 'pending' }])
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /opt/Klyde/projects/Devai && npx vitest run apps/api/src/services/intakeSeed.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// apps/api/src/services/intakeSeed.ts
import type { TodoItem } from '../agents/types.js'
import type { LLMProvider } from '../llm/types.js'

// Cheap, fast model for intake parsing
const INTAKE_MODEL = 'glm-4.7-flash'
const INTAKE_PROVIDER: LLMProvider = 'zai'

export function buildIntakeSeedPrompt(userMessage: string): string {
  return (
    'Extract all discrete requests from this user message.\n'
    + 'Return a JSON array: [{ "content": "..." }, ...]\n'
    + 'Rules:\n'
    + '- One item per independent request\n'
    + '- Single requests produce a single item\n'
    + '- No interpretation, no sub-tasks, no elaboration\n'
    + '- Greetings or smalltalk produce an empty array []\n'
    + '- Return ONLY the JSON array, nothing else\n\n'
    + `User message: "${userMessage}"`
  )
}

export function parseIntakeSeedResponse(raw: string): TodoItem[] {
  // Strip markdown code fences if present
  let cleaned = raw.trim()
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim()
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    return []
  }

  if (!Array.isArray(parsed)) return []

  return parsed
    .filter((item): item is { content: string } =>
      typeof item === 'object'
      && item !== null
      && typeof (item as Record<string, unknown>).content === 'string'
      && (item as Record<string, unknown>).content !== ''
      && String((item as Record<string, unknown>).content).trim() !== '',
    )
    .map((item) => ({
      content: String(item.content).trim(),
      status: 'pending' as const,
    }))
}

export async function runIntakeSeed(
  userMessage: string,
): Promise<TodoItem[]> {
  // Dynamic import to avoid circular deps and keep module light
  const { llmRouter } = await import('../llm/router.js')

  try {
    const response = await llmRouter.generateWithFallback(INTAKE_PROVIDER, {
      model: INTAKE_MODEL,
      messages: [{ role: 'user', content: buildIntakeSeedPrompt(userMessage) }],
      toolsEnabled: false,
      maxTokens: 500,
    })

    return parseIntakeSeedResponse(response.content)
  } catch (err) {
    console.warn('[intakeSeed] Failed, skipping seed:', err instanceof Error ? err.message : err)
    return []
  }
}
```

**Step 4: Run tests**

Run: `cd /opt/Klyde/projects/Devai && npx vitest run apps/api/src/services/intakeSeed.test.ts`
Expected: PASS (pure function tests, no LLM call needed)

**Step 5: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add apps/api/src/services/intakeSeed.ts apps/api/src/services/intakeSeed.test.ts && git commit -m "feat: add intake seed service for multi-part message extraction"
```

---

## Task 2: Exit Gate in ChapoLoop

**Files:**
- Modify: `apps/api/src/agents/chapo-loop.ts:265-281` (the ANSWER path)

**Step 1: Read the current ANSWER path**

The exit gate goes at `chapo-loop.ts` line 265, BEFORE the inbox check. Current code:

```typescript
// No tool calls → ACTION: ANSWER
if (!response.toolCalls || response.toolCalls.length === 0) {
  // Check inbox before finalizing — catch late-arriving messages
  const hasNew = this.contextManager.checkInbox();
  if (hasNew) {
    this.conversation.addMessage({
      role: 'assistant',
      content: response.content || '',
    });
    continue;
  }

  const answer = response.content || '';
  const userText = getTextContent(userMessage);

  return this.answerValidator.validateAndNormalize(userText, answer, this.iteration, this.emitDecisionPath.bind(this));
}
```

**Step 2: Add exit gate check**

Add an import at the top of `chapo-loop.ts`:
```typescript
import * as stateManager from './stateManager.js'
```
(Check if already imported — likely yes since it's used elsewhere)

Replace the ANSWER block (lines 265-282) with:

```typescript
// No tool calls → ACTION: ANSWER
if (!response.toolCalls || response.toolCalls.length === 0) {
  // Check inbox before finalizing — catch late-arriving messages
  const hasNew = this.contextManager.checkInbox()
  if (hasNew) {
    this.conversation.addMessage({
      role: 'assistant',
      content: response.content || '',
    })
    continue
  }

  // EXIT GATE: check for unresolved todos before allowing answer
  const state = stateManager.getOrCreateState(this.sessionId)
  const pendingTodos = state.todos.filter((t) => t.status === 'pending')
  if (pendingTodos.length > 0 && this.exitGateBounces < 2) {
    this.exitGateBounces++
    const pendingList = pendingTodos.map((t) => `- [ ] ${t.content}`).join('\n')
    this.conversation.addMessage({
      role: 'assistant',
      content: response.content || '',
    })
    this.conversation.addMessage({
      role: 'system',
      content: `[EXIT GATE] Du hast noch offene Punkte:\n${pendingList}\nBearbeite sie oder nutze todoWrite um sie als erledigt zu markieren.`,
    })
    continue
  }

  const answer = response.content || ''
  const userText = getTextContent(userMessage)

  return this.answerValidator.validateAndNormalize(userText, answer, this.iteration, this.emitDecisionPath.bind(this))
}
```

**Step 3: Add exitGateBounces property**

In the ChapoLoop class, add a property declaration near the other instance properties:

```typescript
private exitGateBounces = 0
```

**Step 4: Verify no TypeScript errors**

Run: `ssh root@10.0.0.5 "cd /opt/Devai && npx tsc --noEmit 2>&1 | head -30"`
Expected: No errors related to chapo-loop.ts

**Step 5: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add apps/api/src/agents/chapo-loop.ts && git commit -m "feat: add exit gate — loop cannot exit with pending todos"
```

---

## Task 3: Integrate Intake Seed in requestFlow.ts

**Files:**
- Modify: `apps/api/src/agents/router/requestFlow.ts:82-100`

**Step 1: Read current code around the ChapoLoop creation (line ~95)**

Current flow in processRequest():
```typescript
// ... model selection, state setup ...
const loop = new ChapoLoop(sessionId, sendEvent, loopProjectRoot, modelSelection, {
  maxIterations: 20,
});
const loopResult = await loop.run(userMessage, history);
```

**Step 2: Add intake seed before loop creation**

Add import at top of `requestFlow.ts`:
```typescript
import { runIntakeSeed } from '../../services/intakeSeed.js'
```

Insert BEFORE the `new ChapoLoop(...)` line (around line 95), AFTER `warmSystemContextForSession`:

```typescript
    // Intake Seed: extract discrete requests as initial todos
    // Runs in parallel with system context warming (already awaited above)
    const textContent = getTextContent(userMessage)
    const initialTodos = await runIntakeSeed(textContent)
    if (initialTodos.length > 0) {
      state.todos = initialTodos
      sendEvent({ type: 'todo_updated', todos: initialTodos })
    }
```

**Step 3: Verify no TypeScript errors**

Run: `ssh root@10.0.0.5 "cd /opt/Devai && npx tsc --noEmit 2>&1 | head -30"`

**Step 4: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add apps/api/src/agents/router/requestFlow.ts && git commit -m "feat: run intake seed before chapo loop to pre-populate todos"
```

---

## Task 4: Integrate Intake Seed in Inbox Flow

**Files:**
- Modify: `apps/api/src/agents/chapo-loop/contextManager.ts:39-59`

**Step 1: Read current checkInbox()**

Current code drains inbox, adds messages as user role, adds system hint. We need to also run intake seed on inbox messages and append new todos to state.

**Step 2: Modify checkInbox() to seed todos from inbox messages**

Add imports at top of `contextManager.ts`:
```typescript
import { runIntakeSeed } from '../../services/intakeSeed.js'
import * as stateManager from '../stateManager.js'
```

Replace the `checkInbox()` method (lines 39-59):

```typescript
  async checkInbox(): Promise<boolean> {
    const messages = drainInbox(this.sessionId)

    if (messages.length === 0) return false

    for (const msg of messages) {
      this.conversation.addMessage({
        role: 'user',
        content: msg.content,
      })
      this.conversation.addMessage({
        role: 'system',
        content: '[INBOX] Neue Nachricht eingetroffen. '
          + 'Pruefe deine Todo-Liste und fuege neue Punkte hinzu falls noetig.',
      })

      // Seed todos from inbox messages so exit gate catches them
      const newTodos = await runIntakeSeed(msg.content)
      if (newTodos.length > 0) {
        const state = stateManager.getOrCreateState(this.sessionId)
        state.todos = [...state.todos, ...newTodos]
        this.sendEvent({ type: 'todo_updated', todos: state.todos })
      }
    }

    this.sendEvent({ type: 'inbox_processing', count: messages.length })
    return true
  }
```

**Important:** This changes the method signature from `checkInbox(): boolean` to `async checkInbox(): Promise<boolean>`. Update all call sites in `chapo-loop.ts` to `await this.contextManager.checkInbox()`.

**Step 3: Update call sites in chapo-loop.ts**

There are two calls to `this.contextManager.checkInbox()` in `chapo-loop.ts`:
1. In the ANSWER path (~line 268): `const hasNew = this.contextManager.checkInbox()` → `const hasNew = await this.contextManager.checkInbox()`
2. Near the end of the tool processing loop (~line 370): `this.contextManager.checkInbox()` → `await this.contextManager.checkInbox()`

**Step 4: Verify no TypeScript errors**

Run: `ssh root@10.0.0.5 "cd /opt/Devai && npx tsc --noEmit 2>&1 | head -30"`

**Step 5: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add apps/api/src/agents/chapo-loop/contextManager.ts apps/api/src/agents/chapo-loop.ts && git commit -m "feat: seed todos from inbox messages for exit gate enforcement"
```

---

## Task 5: Frontend TodoCard Component

**Files:**
- Create: `apps/web/src/components/TodoCard.tsx`

**Step 1: Write the component**

```tsx
// apps/web/src/components/TodoCard.tsx
import { useMemo } from 'react'

interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

interface TodoCardProps {
  todos: TodoItem[]
}

const STATUS_ICON: Record<TodoItem['status'], string> = {
  pending: '\u25CB',        // ○
  in_progress: '\u25D4',    // ◔ (half circle)
  completed: '\u2714',      // ✔
}

const STATUS_CLASS: Record<TodoItem['status'], string> = {
  pending: 'todo-pending',
  in_progress: 'todo-in-progress',
  completed: 'todo-completed',
}

export function TodoCard({ todos }: TodoCardProps) {
  const completed = useMemo(() => todos.filter((t) => t.status === 'completed').length, [todos])
  const allDone = completed === todos.length && todos.length > 0

  if (todos.length === 0) return null

  if (allDone) {
    return (
      <div className="todo-card todo-card-done">
        <span className="todo-summary">{STATUS_ICON.completed} {completed}/{todos.length} Aufgaben erledigt</span>
      </div>
    )
  }

  return (
    <div className="todo-card">
      <div className="todo-header">Chapo's Aufgaben</div>
      <ul className="todo-list">
        {todos.map((todo, i) => (
          <li key={i} className={STATUS_CLASS[todo.status]}>
            <span className="todo-icon">{STATUS_ICON[todo.status]}</span>
            <span className={todo.status === 'completed' ? 'todo-text-done' : 'todo-text'}>
              {todo.content}
            </span>
          </li>
        ))}
      </ul>
      <div className="todo-progress">{completed}/{todos.length} erledigt</div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add apps/web/src/components/TodoCard.tsx && git commit -m "feat: add TodoCard component for inline todo visualization"
```

---

## Task 6: Wire TodoCard into ChatUI

**Files:**
- Modify: `apps/web/src/components/ChatUI/ChatUI.tsx`

**Step 1: Read the current todo_updated handler**

Find the `todo_updated` case in `handleStreamEvent()`. Currently it's a no-op or informational.

**Step 2: Add state for todos**

Add to the state declarations near line 34:
```typescript
const [currentTodos, setCurrentTodos] = useState<Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>>([])
```

**Step 3: Update the todo_updated handler**

In `handleStreamEvent()`, update the `todo_updated` case:
```typescript
case 'todo_updated': {
  const ev = event as { todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }> }
  setCurrentTodos(ev.todos || [])
  break
}
```

**Step 4: Render TodoCard in the message area**

Import TodoCard at the top:
```typescript
import { TodoCard } from '../TodoCard'
```

Render it above or below the MessageList (after messages, before InputArea):
```tsx
{currentTodos.length > 0 && <TodoCard todos={currentTodos} />}
```

**Step 5: Reset todos on new session**

In the session change effect, add:
```typescript
setCurrentTodos([])
```

**Step 6: Verify it renders**

Check preview: `curl -I https://devai.klyde.tech`

**Step 7: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add apps/web/src/components/ChatUI/ChatUI.tsx && git commit -m "feat: wire TodoCard into ChatUI for live todo updates"
```

---

## Task 7: Heartbeat DB Table + Queries

**Files:**
- Create: `apps/api/src/db/migrations/002_heartbeat_runs.sql`
- Modify: `apps/api/src/db/queries.ts`

**Step 1: Write the migration SQL**

```sql
-- apps/api/src/db/migrations/002_heartbeat_runs.sql
create table if not exists heartbeat_runs (
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
);
```

**Step 2: Run the migration on Supabase**

Run this SQL in the Supabase dashboard (project zzmvofskibpffcxbukuk) or via Supabase CLI.

**Step 3: Add queries to db/queries.ts**

Add these interfaces and functions at the end of `db/queries.ts`:

```typescript
// ── Heartbeat Runs ──

export interface HeartbeatRunRow {
  id: string
  started_at: string
  completed_at: string | null
  status: 'running' | 'completed' | 'failed' | 'noop'
  findings: Record<string, unknown> | null
  actions_taken: Array<Record<string, unknown>> | null
  tokens_used: number | null
  model: string | null
  error: string | null
  duration_ms: number | null
}

export async function insertHeartbeatRun(
  status: 'running',
): Promise<string> {
  const { data, error } = await getSupabase()
    .from('heartbeat_runs')
    .insert({ status })
    .select('id')
    .single()

  if (error) {
    console.error('[db] Failed to insert heartbeat run:', error)
    throw error
  }

  return data.id as string
}

export async function updateHeartbeatRun(
  id: string,
  update: Partial<Omit<HeartbeatRunRow, 'id' | 'started_at'>>,
): Promise<void> {
  const { error } = await getSupabase()
    .from('heartbeat_runs')
    .update(update)
    .eq('id', id)

  if (error) {
    console.error('[db] Failed to update heartbeat run:', error)
  }
}

export async function getRecentFailedSessions(
  sinceMinutes: number,
): Promise<Array<{ session_id: string; title: string; updated_at: string }>> {
  const since = new Date(Date.now() - sinceMinutes * 60_000).toISOString()

  const { data, error } = await getSupabase()
    .from('sessions')
    .select('id, title, updated_at')
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('[db] Failed to query recent sessions:', error)
    return []
  }

  return (data || []).map((row) => ({
    session_id: row.id as string,
    title: (row.title || 'Untitled') as string,
    updated_at: row.updated_at as string,
  }))
}
```

**Step 4: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add apps/api/src/db/migrations/002_heartbeat_runs.sql apps/api/src/db/queries.ts && git commit -m "feat: add heartbeat_runs table and DB queries"
```

---

## Task 8: Heartbeat Service

**Files:**
- Create: `apps/api/src/services/heartbeatService.ts`

**Step 1: Write the service**

```typescript
// apps/api/src/services/heartbeatService.ts
import { insertHeartbeatRun, updateHeartbeatRun } from '../db/queries.js'
import type { HeartbeatRunRow } from '../db/queries.js'

const HEARTBEAT_PROMPT = `Heartbeat-Check. Pruefe:

1. Chat-Historie — Gibt es kuerzliche Sessions mit unbeantwortet gebliebenen
   Fragen, abgebrochenen Loops oder Fehlermeldungen?

2. Logs — Pruefe die API-Logs auf wiederkehrende Fehler, Timeouts oder
   auffaellige Muster der letzten 120 Minuten. (ssh_execute: pm2 logs devai-api-dev --lines 100 --nostream)

3. Eigene Memory — Hast du dir etwas gemerkt, worauf du reagieren solltest?
   Offene Erinnerungen, anstehende Aufgaben aus vorherigen Sessions?

Wenn nichts ansteht: Antworte mit "NOOP" — keine Aktion, kein Output.
Wenn etwas ansteht: Handle es oder benachrichtige den User via Telegram.`

function isQuietHours(): boolean {
  // Use Europe/Berlin timezone
  const berlinHour = new Date().toLocaleString('en-US', {
    timeZone: 'Europe/Berlin',
    hour: 'numeric',
    hour12: false,
  })
  const hour = parseInt(berlinHour, 10)
  return hour >= 21 || hour < 7
}

export type HeartbeatExecutor = (
  sessionId: string,
  instruction: string,
) => Promise<string>

let executor: HeartbeatExecutor | null = null

export function configureHeartbeat(exec: HeartbeatExecutor): void {
  executor = exec
}

export async function runHeartbeat(): Promise<void> {
  if (isQuietHours()) return
  if (!executor) {
    console.warn('[heartbeat] No executor configured, skipping')
    return
  }

  const startTime = Date.now()
  let runId: string | undefined

  try {
    runId = await insertHeartbeatRun('running')
  } catch {
    console.error('[heartbeat] Failed to create DB record, running anyway')
  }

  const sessionId = `heartbeat-${new Date().toISOString().slice(0, 10)}`

  try {
    const result = await executor(sessionId, HEARTBEAT_PROMPT)
    const durationMs = Date.now() - startTime
    const isNoop = result.trim().toUpperCase() === 'NOOP' || result.trim().length < 10

    const update: Partial<HeartbeatRunRow> = {
      status: isNoop ? 'noop' : 'completed',
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
      findings: isNoop ? null : { raw: result },
      actions_taken: isNoop ? null : [{ type: 'agent_response', content: result.slice(0, 500) }],
    }

    if (runId) await updateHeartbeatRun(runId, update)

    console.info(`[heartbeat] ${update.status} in ${durationMs}ms`)
  } catch (err) {
    const durationMs = Date.now() - startTime
    const errorMsg = err instanceof Error ? err.message : String(err)

    if (runId) {
      await updateHeartbeatRun(runId, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        error: errorMsg,
      })
    }

    console.error(`[heartbeat] Failed in ${durationMs}ms:`, errorMsg)
  }
}
```

**Step 2: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add apps/api/src/services/heartbeatService.ts && git commit -m "feat: add heartbeat service with quiet hours and DB persistence"
```

---

## Task 9: Register Heartbeat in server.ts

**Files:**
- Modify: `apps/api/src/server.ts`

**Step 1: Read the area around line 305 where internal jobs are registered**

Find the section with `schedulerService.registerInternalJob({ id: 'maintenance-memory-decay' ...`.

**Step 2: Add heartbeat imports**

At the top of server.ts, add:
```typescript
import { configureHeartbeat, runHeartbeat } from './services/heartbeatService.js'
```

**Step 3: Configure heartbeat executor**

Right after `schedulerService.configure(...)` and before `await schedulerService.start()`, add:

```typescript
// Configure heartbeat with the same executor pattern as scheduled jobs
configureHeartbeat(async (sessionId, instruction) => {
  await ensureSessionExists(sessionId, 'Heartbeat')
  const history = await loadRecentConversationHistory(sessionId)

  await saveMessage(sessionId, {
    id: nanoid(),
    role: 'user',
    content: instruction,
    timestamp: new Date().toISOString(),
  })

  const result = await processRequest(sessionId, instruction, history, null, () => {})

  await saveMessage(sessionId, {
    id: nanoid(),
    role: 'assistant',
    content: result,
    timestamp: new Date().toISOString(),
  })

  return result
})
```

**Step 4: Register heartbeat internal job**

After the other `registerInternalJob` calls, add:

```typescript
schedulerService.registerInternalJob({
  id: 'heartbeat-check',
  name: 'Heartbeat: Autonomy Check',
  cronExpression: '0 */2 * * *',  // Every 2 hours
  run: runHeartbeat,
  runOnStart: false,
  notifyOnFailure: true,
})
```

**Step 5: Verify no TypeScript errors**

Run: `ssh root@10.0.0.5 "cd /opt/Devai && npx tsc --noEmit 2>&1 | head -30"`

**Step 6: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add apps/api/src/server.ts && git commit -m "feat: register heartbeat job — runs every 120 min during active hours"
```

---

## Task 10: Add TodoCard CSS

**Files:**
- Find and modify the main CSS file used by ChatUI (likely `apps/web/src/index.css` or `apps/web/src/App.css`)

**Step 1: Find the CSS file**

```bash
ls apps/web/src/*.css
```

**Step 2: Add TodoCard styles**

```css
/* TodoCard */
.todo-card {
  background: var(--surface-secondary, #1e1e2e);
  border: 1px solid var(--border-color, #333);
  border-radius: 8px;
  padding: 12px 16px;
  margin: 8px 0;
  font-size: 0.9em;
}

.todo-card-done {
  opacity: 0.7;
}

.todo-header {
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--text-primary, #e0e0e0);
}

.todo-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.todo-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.todo-icon {
  flex-shrink: 0;
  width: 16px;
  text-align: center;
}

.todo-pending .todo-icon { color: #666; }
.todo-in-progress .todo-icon { color: #f0ad4e; animation: pulse 1.5s infinite; }
.todo-completed .todo-icon { color: #5cb85c; }

.todo-text-done {
  text-decoration: line-through;
  opacity: 0.6;
}

.todo-progress {
  margin-top: 8px;
  font-size: 0.85em;
  color: var(--text-secondary, #888);
}

.todo-summary {
  color: var(--text-secondary, #888);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

**Step 3: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add apps/web/src/*.css && git commit -m "feat: add TodoCard styles"
```

---

## Task 11: Update Architecture Documentation

**Files:**
- Modify: `docs/architecture.md`

**Step 1: Add Intake Seed section**

After the "Multi-Message Inbox System" section, add:

```markdown
### Intake Seed

Before the ChapoLoop starts, a fast model call (GLM-4.7-Flash) extracts discrete requests from the user message and creates initial TodoItems. This ensures multi-part messages are tracked structurally, not relying on CHAPO to voluntarily parse them.

**Source:** `apps/api/src/services/intakeSeed.ts`
**Called from:** `processRequest()` in `agents/router/requestFlow.ts`

The intake seed also runs on inbox messages (via `contextManager.checkInbox()`), ensuring follow-up messages during an active loop are also tracked as todos.

### Exit Gate

Before the ChapoLoop can exit with an ANSWER, it checks `ConversationState.todos` for pending items. If any are found, a system message is injected and the loop continues. Max 2 bounces to prevent infinite loops.

**Source:** `apps/api/src/agents/chapo-loop.ts` (ANSWER path)

### Heartbeat Loop

Every 120 minutes during active hours (07:00-21:00 Europe/Berlin), a heartbeat job triggers a CHAPO loop that checks chat history, API logs, and memory for unhandled issues. Results are persisted in the `heartbeat_runs` Supabase table.

**Source:** `apps/api/src/services/heartbeatService.ts`
**Scheduled by:** `schedulerService.registerInternalJob()` in `server.ts`
**DB table:** `heartbeat_runs` (status, findings, actions_taken, duration_ms)
```

**Step 2: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add docs/architecture.md && git commit -m "docs: add Intake Seed, Exit Gate, and Heartbeat Loop to architecture"
```

---

## Task 12: Final Verification + Push

**Step 1: Run all tests**

```bash
ssh root@10.0.0.5 "cd /opt/Devai && npx vitest run 2>&1 | tail -20"
```

**Step 2: Check TypeScript compilation**

```bash
ssh root@10.0.0.5 "cd /opt/Devai && npx tsc --noEmit 2>&1 | tail -20"
```

**Step 3: Check PM2 status**

```bash
ssh root@10.0.0.5 "pm2 restart devai-api-dev && sleep 5 && pm2 logs devai-api-dev --lines 30 --nostream"
```

**Step 4: Test the preview**

```bash
curl -s https://devai.klyde.tech/api/health | jq
```

**Step 5: Push to dev**

```bash
cd /opt/Klyde/projects/Devai && git push origin dev
```

**Step 6: Update TaskForge task**

Move `Devai:699caed` to `umsetzung` or `review`.
