# Delegation Cards — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace implicit agent switch badges with explicit Delegation Cards that show the agent-to-agent communication inline in the chat stream.

**Architecture:** Delegation events already flow through the WebSocket stream (`delegation`, `tool_call`, `tool_result`, `agent_complete`, `agent_switch`). We add a thin state-tracking layer in ChatUI that groups these events into `DelegationData` objects, and two new components (`DelegationCard`, `ToolTimeline`) that render them. Backend gets a ~5 line enhancement to emit `durationMs` and `toolCount` on `agent_complete`.

**Tech Stack:** React, TypeScript, Tailwind CSS (devai design system)

**Design doc:** `docs/plans/2026-02-24-delegation-cards-design.md`

---

### Task 1: Backend — Add `durationMs` and `toolCount` to `agent_complete`

**Files:**
- Modify: `apps/api/src/agents/chapo-loop/delegationRunner.ts:71-174`
- Modify: `apps/api/src/agents/types.ts:363`

**Step 1: Add `durationMs` and `toolCount` to the `agent_complete` event type**

In `apps/api/src/agents/types.ts`, update the `agent_complete` union member:

```typescript
// Before:
| { type: 'agent_complete'; agent: AgentName; result: unknown }

// After:
| { type: 'agent_complete'; agent: AgentName; result: unknown; durationMs?: number; toolCount?: number }
```

**Step 2: Capture timing and tool count in `delegateToSubAgent`**

In `apps/api/src/agents/chapo-loop/delegationRunner.ts`, add a `startTime` before `deps.subAgentRunner.run()` and a `toolCount` counter, then emit them:

```typescript
// Line ~120, before the subAgentRunner.run() call:
const delegationStartMs = Date.now();
let subToolCount = 0;

// Inside the handleToolCall callback (line ~132), increment counter:
handleToolCall: async ({ toolCall, turn }) => {
  subToolCount++;
  // ... existing logic
},

// Line ~168, in the agent_complete event:
deps.sendEvent({
  type: 'agent_complete',
  agent: target,
  result: runResult.exit === 'escalated'
    ? `${targetUpper} eskaliert: ${runResult.escalationDescription || 'unknown issue'}`
    : finalContent,
  durationMs: Date.now() - delegationStartMs,
  toolCount: subToolCount,
});
```

**Step 3: Same for `delegateToScout`**

Add timing around the scout call (lines 199-279):

```typescript
// Line ~221, at start of try block:
const delegationStartMs = Date.now();

// Line ~258, in the agent_complete event:
deps.sendEvent({
  type: 'agent_complete',
  agent: 'scout',
  result: loopResult.summary,
  durationMs: Date.now() - delegationStartMs,
  toolCount: 1,
});

// Line ~275, in the error agent_complete:
deps.sendEvent({
  type: 'agent_complete',
  agent: 'scout',
  result: `SCOUT Fehler: ${message}`,
  durationMs: Date.now() - delegationStartMs,
  toolCount: 0,
});
```

**Step 4: Verify the API restarts cleanly**

Run: Check PM2 logs for the devai-api process after saving.
Expected: No TypeScript errors, API starts cleanly.

**Step 5: Commit**

```bash
git add apps/api/src/agents/chapo-loop/delegationRunner.ts apps/api/src/agents/types.ts
git commit -m "feat: add durationMs and toolCount to agent_complete events"
```

---

### Task 2: Frontend Types — Add `DelegationData` interface and extend `ToolEvent`

**Files:**
- Modify: `apps/web/src/components/ChatUI/types.ts`

**Step 1: Add the delegation data types**

Append to the bottom of `apps/web/src/components/ChatUI/types.ts`:

```typescript
export type DelegationStatus = 'working' | 'completed' | 'failed' | 'escalated';

export interface DelegationToolStep {
  id: string;
  name: string;
  argsPreview: string;
  resultPreview?: string;
  success?: boolean;
  durationMs?: number;
}

export interface DelegationData {
  id: string;
  from: AgentName;
  to: AgentName;
  task: string;
  domain?: string;
  status: DelegationStatus;
  startTime: number;
  durationMs?: number;
  toolSteps: DelegationToolStep[];
  prompt?: string;
  response?: string;
}
```

**Step 2: Commit**

```bash
git add apps/web/src/components/ChatUI/types.ts
git commit -m "feat: add DelegationData types for delegation card state"
```

---

### Task 3: Frontend State — Track delegations in ChatUI.tsx

**Files:**
- Modify: `apps/web/src/components/ChatUI/ChatUI.tsx`

**Step 1: Add delegation state**

After line 46 (the `currentTodos` state), add:

```typescript
const [delegations, setDelegations] = useState<DelegationData[]>([]);
const [messageDelegations, setMessageDelegations] = useState<Record<string, DelegationData[]>>({});
const activeDelegationRef = useRef<string | null>(null);
```

Add the import at the top:

```typescript
import type { ChatUIProps, ToolEvent, DelegationData, DelegationToolStep } from './types';
```

**Step 2: Handle delegation events in `handleStreamEvent`**

Add cases in the `handleStreamEvent` switch (after the existing `tool_result` case, around line 234):

```typescript
case 'delegation': {
  const ev = event as Record<string, unknown>;
  const delId = String(ev.id || crypto.randomUUID());
  const newDelegation: DelegationData = {
    id: delId,
    from: (ev.from as AgentName) || 'chapo',
    to: (ev.to as AgentName) || 'devo',
    task: String(ev.task || ev.objective || ''),
    domain: ev.domain as string | undefined,
    status: 'working',
    startTime: Date.now(),
    toolSteps: [],
    prompt: String(ev.objective || ev.task || ''),
  };
  setDelegations(prev => [...prev, newDelegation]);
  activeDelegationRef.current = delId;
  break;
}
```

**Step 3: Accumulate tool steps within active delegation**

Modify the existing `tool_call` and `tool_result` cases to also feed into the active delegation. After the existing `upsertToolEvent` call in each case:

```typescript
// In the 'tool_call' case, after upsertToolEvent:
if (activeDelegationRef.current) {
  const step: DelegationToolStep = {
    id,
    name: name || 'tool',
    argsPreview: typeof args === 'string' ? args.slice(0, 80) : JSON.stringify(args).slice(0, 80),
  };
  setDelegations(prev => prev.map(d =>
    d.id === activeDelegationRef.current
      ? { ...d, toolSteps: [...d.toolSteps, step] }
      : d
  ));
}

// In the 'tool_result' case, after upsertToolEvent:
if (activeDelegationRef.current) {
  const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
  setDelegations(prev => prev.map(d => {
    if (d.id !== activeDelegationRef.current) return d;
    const steps = d.toolSteps.map(s =>
      s.id === id ? { ...s, resultPreview: resultStr.slice(0, 120), success: Boolean(ev.success ?? !ev.isError) } : s
    );
    return { ...d, toolSteps: steps };
  }));
}
```

**Step 4: Finalize delegation on `agent_complete`**

In the `handleAgentEvent` function, update the `agent_complete` case:

```typescript
case 'agent_complete': {
  const ev = event as Record<string, unknown>;
  const completedAgent = ev.agent as AgentName | undefined;
  // Only finalize if this is a sub-agent completing (not chapo)
  if (completedAgent && completedAgent !== 'chapo' && activeDelegationRef.current) {
    const durationMs = typeof ev.durationMs === 'number' ? ev.durationMs : undefined;
    const toolCount = typeof ev.toolCount === 'number' ? ev.toolCount : undefined;
    const resultStr = typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result);
    setDelegations(prev => prev.map(d => {
      if (d.id !== activeDelegationRef.current) return d;
      return {
        ...d,
        status: 'completed' as const,
        durationMs: durationMs ?? (Date.now() - d.startTime),
        response: resultStr,
      };
    }));
    activeDelegationRef.current = null;
  }
  setAgentPhase('idle');
  break;
}
```

**Step 5: Freeze delegations to messages (like tool events)**

Modify the `freezeToolEvents` callback to also freeze delegations:

```typescript
const freezeToolEvents = useCallback((messageId: string) => {
  setToolEvents(currentEvents => {
    if (currentEvents.length > 0) {
      setMessageToolEvents(prev => ({
        ...prev,
        [messageId]: [...currentEvents],
      }));
    }
    return [];
  });
  setDelegations(currentDels => {
    if (currentDels.length > 0) {
      setMessageDelegations(prev => ({
        ...prev,
        [messageId]: [...currentDels],
      }));
    }
    return [];
  });
}, []);
```

**Step 6: Pass delegation data to MessageList**

Update the `<MessageList>` props:

```tsx
<MessageList
  // ... existing props
  delegations={delegations}
  messageDelegations={messageDelegations}
/>
```

**Step 7: Clear delegation state on session change**

In the session change `useEffect` (line ~123), add:

```typescript
setDelegations([]);
setMessageDelegations({});
activeDelegationRef.current = null;
```

**Step 8: Commit**

```bash
git add apps/web/src/components/ChatUI/ChatUI.tsx
git commit -m "feat: track delegation state in ChatUI for delegation cards"
```

---

### Task 4: DelegationCard Component

**Files:**
- Create: `apps/web/src/components/ChatUI/DelegationCard.tsx`

**Step 1: Create the component**

```tsx
import { useState } from 'react';
import type { DelegationData } from './types';
import { ToolTimeline } from './ToolTimeline';

const AGENT_ICONS: Record<string, string> = {
  chapo: '\u{1F3AF}',
  devo: '\u{1F527}',
  scout: '\u{1F50D}',
  caio: '\u{1F4CB}',
};

const AGENT_COLORS: Record<string, string> = {
  chapo: 'text-purple-400',
  devo: 'text-devai-accent',
  scout: 'text-cyan-400',
  caio: 'text-emerald-400',
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  working: { label: 'working', color: 'text-yellow-400' },
  completed: { label: 'completed', color: 'text-emerald-400' },
  failed: { label: 'failed', color: 'text-red-400' },
  escalated: { label: 'escalated', color: 'text-amber-400' },
};

function formatDuration(ms?: number): string {
  if (ms == null) return '...';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function DelegationCard({ delegation }: { delegation: DelegationData }) {
  const [expanded, setExpanded] = useState(false);
  const fromIcon = AGENT_ICONS[delegation.from] || '';
  const toIcon = AGENT_ICONS[delegation.to] || '';
  const toColor = AGENT_COLORS[delegation.to] || 'text-devai-text';
  const statusInfo = STATUS_LABELS[delegation.status] || STATUS_LABELS.working;
  const toolCount = delegation.toolSteps.length;
  const isWorking = delegation.status === 'working';

  // Progress bar: completed tools / total (estimate max at current + 2 when working)
  const progressMax = isWorking ? Math.max(toolCount + 2, 4) : toolCount;
  const progressPct = progressMax > 0 ? Math.min((toolCount / progressMax) * 100, 100) : 0;

  return (
    <div className="flex justify-start">
      <div
        className="rounded-xl border border-devai-border bg-devai-card max-w-[85%] w-full overflow-hidden cursor-pointer hover:border-devai-border/80 transition-colors"
        onClick={() => setExpanded(prev => !prev)}
      >
        {/* Header */}
        <div className="px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-mono">
              <span>{fromIcon}</span>
              <span className="text-devai-text-muted">{delegation.from.toUpperCase()}</span>
              <span className="text-devai-text-muted">{'\u2192'}</span>
              <span>{toIcon}</span>
              <span className={toColor}>{delegation.to.toUpperCase()}</span>
            </div>
            <span className="text-xs text-devai-text-muted font-mono">
              {formatDuration(delegation.durationMs)}
            </span>
          </div>

          {/* Task summary */}
          <p className="text-xs text-devai-text-secondary leading-relaxed line-clamp-2">
            {delegation.task}
          </p>

          {/* Progress bar + status */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1 bg-devai-surface rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isWorking ? 'animate-pulse' : ''
                } ${delegation.status === 'failed' ? 'bg-red-500' : `bg-devai-accent`}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-[10px] text-devai-text-muted font-mono whitespace-nowrap">
              Tools: {toolCount}
            </span>
            <span className={`text-[10px] font-mono ${statusInfo.color}`}>
              {delegation.status === 'completed' ? '\u2713' : delegation.status === 'failed' ? '\u2717' : '\u25CF'}{' '}
              {statusInfo.label}
            </span>
          </div>
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="border-t border-devai-border px-4 py-3 space-y-3">
            {/* Delegation prompt */}
            {delegation.prompt && (
              <div className="rounded-lg bg-devai-surface/50 border border-devai-border/50 px-3 py-2">
                <p className="text-[10px] text-devai-text-muted font-mono mb-1">Delegation Prompt</p>
                <p className="text-xs text-devai-text-secondary leading-relaxed whitespace-pre-wrap">
                  {delegation.prompt.length > 500 ? `${delegation.prompt.slice(0, 500)}...` : delegation.prompt}
                </p>
              </div>
            )}

            {/* Tool timeline */}
            {delegation.toolSteps.length > 0 && (
              <ToolTimeline steps={delegation.toolSteps} />
            )}

            {/* Sub-agent response */}
            {delegation.response && (
              <div className="rounded-lg bg-devai-surface/50 border border-devai-border/50 px-3 py-2">
                <p className="text-[10px] text-devai-text-muted font-mono mb-1">
                  {delegation.to.toUpperCase()} Response
                </p>
                <p className="text-xs text-devai-text-secondary leading-relaxed whitespace-pre-wrap">
                  {delegation.response.length > 800 ? `${delegation.response.slice(0, 800)}...` : delegation.response}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Expand toggle */}
        <div className="px-4 py-1.5 text-center">
          <span className="text-[10px] text-devai-text-muted font-mono">
            {expanded ? '\u25BE Hide delegation details' : '\u25B8 Show delegation details'}
          </span>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/web/src/components/ChatUI/DelegationCard.tsx
git commit -m "feat: add DelegationCard component"
```

---

### Task 5: ToolTimeline Component

**Files:**
- Create: `apps/web/src/components/ChatUI/ToolTimeline.tsx`

**Step 1: Create the component**

```tsx
import { useState } from 'react';
import type { DelegationToolStep } from './types';

export function ToolTimeline({ steps }: { steps: DelegationToolStep[] }) {
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      {steps.map((step, index) => {
        const isExpanded = expandedStep === step.id;
        const icon = step.success === true ? '\u2713' : step.success === false ? '\u2717' : '\u25CB';
        const iconColor = step.success === true
          ? 'text-emerald-400'
          : step.success === false
            ? 'text-red-400'
            : 'text-devai-text-muted';

        return (
          <div key={step.id}>
            <button
              onClick={(e) => { e.stopPropagation(); setExpandedStep(isExpanded ? null : step.id); }}
              className="flex items-center gap-2 w-full text-left px-1 py-0.5 rounded hover:bg-devai-surface/50 transition-colors"
            >
              <span className="text-[10px] text-devai-text-muted font-mono w-4 text-right shrink-0">
                {index + 1}.
              </span>
              <span className={`text-[10px] ${iconColor} shrink-0`}>{icon}</span>
              <span className="text-[11px] text-devai-text font-mono truncate">
                {step.name}
              </span>
              <span className="text-[10px] text-devai-text-muted font-mono truncate flex-1 min-w-0">
                {step.argsPreview}
              </span>
              {step.durationMs != null && (
                <span className="text-[10px] text-devai-text-muted font-mono shrink-0">
                  {step.durationMs < 1000 ? `${step.durationMs}ms` : `${(step.durationMs / 1000).toFixed(1)}s`}
                </span>
              )}
            </button>
            {isExpanded && step.resultPreview && (
              <div className="ml-8 mt-0.5 mb-1 rounded bg-devai-surface/30 border border-devai-border/30 px-2 py-1.5">
                <p className="text-[10px] text-devai-text-secondary font-mono whitespace-pre-wrap break-all">
                  {step.resultPreview}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/web/src/components/ChatUI/ToolTimeline.tsx
git commit -m "feat: add ToolTimeline component for delegation card tool steps"
```

---

### Task 6: Integrate DelegationCard into MessageList

**Files:**
- Modify: `apps/web/src/components/ChatUI/MessageList.tsx`

**Step 1: Update MessageListProps interface**

Add the new props (after `messageToolEvents` in the interface):

```typescript
delegations: DelegationData[];
messageDelegations: Record<string, DelegationData[]>;
```

Add imports at the top:

```typescript
import type { DelegationData } from './types';
import { DelegationCard } from './DelegationCard';
```

**Step 2: Accept the new props in the component**

Add to the destructured props:

```typescript
delegations,
messageDelegations,
```

**Step 3: Render frozen delegations before messages**

In the messages map (line ~227), render delegation cards before the message:

```tsx
{messages.map((message) => {
  const frozen = message.role === 'assistant' ? messageToolEvents[message.id] : undefined;
  const frozenDelegations = message.role === 'assistant' ? messageDelegations[message.id] : undefined;
  return (
    <Fragment key={message.id}>
      {frozenDelegations && frozenDelegations.map(d => (
        <DelegationCard key={d.id} delegation={d} />
      ))}
      {frozen && frozen.length > 0 && renderToolEventsBlock(frozen, false)}
      {renderMessage(message)}
    </Fragment>
  );
})}
```

**Step 4: Render live delegations above live tool events**

After the messages map, before the live tool events block (line ~238):

```tsx
{/* Live delegation cards */}
{delegations.map(d => (
  <DelegationCard key={d.id} delegation={d} />
))}

{/* Live tool events for current in-progress exchange */}
{toolEvents.length > 0 && renderToolEventsBlock(toolEvents, isLoading)}
```

**Step 5: Commit**

```bash
git add apps/web/src/components/ChatUI/MessageList.tsx
git commit -m "feat: render DelegationCards inline in MessageList"
```

---

### Task 7: Filter delegation-scoped events from badge display

**Files:**
- Modify: `apps/web/src/components/ChatUI/ChatUI.tsx`

This task prevents delegation-scoped tool_call/tool_result events from showing as separate inline badges (since they now appear inside the DelegationCard).

**Step 1: Skip upsertToolEvent when inside a delegation**

In the `tool_call` and `tool_result` cases of `handleStreamEvent`, wrap the existing `upsertToolEvent` call:

```typescript
// In 'tool_call' case:
if (!activeDelegationRef.current) {
  upsertToolEvent(setToolEvents, id, { type: 'tool_call', name, arguments: args, agent: eventAgent });
}

// In 'tool_result' case:
if (!activeDelegationRef.current) {
  upsertToolEvent(setToolEvents, id, { type: 'tool_result', name, result, completed: Boolean(ev.completed), agent: eventAgent });
}

// In 'tool_result_chunk' case:
if (!activeDelegationRef.current) {
  upsertToolEvent(setToolEvents, id, { type: 'tool_result', name, chunk, agent: eventAgent });
}
```

This way, tool events during a delegation only feed into the DelegationCard's `toolSteps`, not the flat badge list.

**Step 2: Also suppress agent_switch badges during delegation**

In `handleAgentEvent`, for the `agent_switch` case, the `setActiveAgent` is still needed but the switch event should not generate a separate status badge. Currently it doesn't create a badge (it just calls `setActiveAgent`), so no change needed here.

**Step 3: Commit**

```bash
git add apps/web/src/components/ChatUI/ChatUI.tsx
git commit -m "feat: suppress inline badges for delegation-scoped tool events"
```

---

### Task 8: Persist delegation cards with session events

**Files:**
- Modify: `apps/web/src/components/ChatUI/ChatUI.tsx`

**Step 1: Save messageDelegations to localStorage alongside messageToolEvents**

Find the existing localStorage persistence for events. Add a parallel save for delegations in the same pattern. In the `freezeToolEvents` callback, after updating `messageDelegations`, add persistence:

```typescript
// After the session save in freezeToolEvents or in a separate useEffect:
useEffect(() => {
  if (!session.sessionId) return;
  try {
    const key = `devai_delegations_${session.sessionId}`;
    const filtered = Object.fromEntries(
      Object.entries(messageDelegations).filter(([, v]) => v.length > 0)
    );
    if (Object.keys(filtered).length > 0) {
      localStorage.setItem(key, JSON.stringify(filtered));
    }
  } catch { /* quota exceeded — silently skip */ }
}, [messageDelegations, session.sessionId]);
```

**Step 2: Load delegations from localStorage on session change**

In the session change `useEffect` (where events are loaded), add:

```typescript
try {
  const delKey = `devai_delegations_${session.sessionId}`;
  const storedDel = localStorage.getItem(delKey);
  if (storedDel) {
    const parsed = JSON.parse(storedDel) as Record<string, DelegationData[]>;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      setMessageDelegations(parsed);
    }
  }
} catch { /* ignore */ }
```

**Step 3: Commit**

```bash
git add apps/web/src/components/ChatUI/ChatUI.tsx
git commit -m "feat: persist delegation cards to localStorage for session replay"
```

---

### Task 9: Manual Verification

**Step 1: Restart the API**

Verify PM2 restarts cleanly with no TypeScript/runtime errors.

**Step 2: Open devai.klyde.tech**

Send a message that triggers DEVO delegation (e.g. "Read the README file and summarize it").

**Step 3: Verify collapsed card**

- Delegation card appears inline (not just badges)
- Shows `CHAPO -> DEVO` with task summary
- Progress bar fills as tools execute
- Status changes to "completed" when done
- Tool count matches number of tools used

**Step 4: Verify expanded card**

- Click the card to expand
- Delegation prompt visible
- Tool timeline with numbered steps
- Each step shows tool name and args preview
- DEVO response visible at bottom

**Step 5: Verify session replay**

- Reload the page
- Navigate to the same session
- Delegation cards reconstruct from stored data

**Step 6: Final commit (if any touch-ups needed)**

```bash
git add -A
git commit -m "fix: delegation card polish from manual testing"
```

---

### Summary of Changes

| File | Action | Lines |
|------|--------|-------|
| `apps/api/src/agents/types.ts` | Modify | ~1 line (add optional fields to agent_complete) |
| `apps/api/src/agents/chapo-loop/delegationRunner.ts` | Modify | ~12 lines (timing + tool count) |
| `apps/web/src/components/ChatUI/types.ts` | Modify | ~20 lines (new interfaces) |
| `apps/web/src/components/ChatUI/ChatUI.tsx` | Modify | ~60 lines (delegation state tracking) |
| `apps/web/src/components/ChatUI/DelegationCard.tsx` | Create | ~130 lines |
| `apps/web/src/components/ChatUI/ToolTimeline.tsx` | Create | ~55 lines |
| `apps/web/src/components/ChatUI/MessageList.tsx` | Modify | ~15 lines (render delegation cards) |

**Total: ~295 lines across 7 files.**
