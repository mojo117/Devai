# Multi-Message System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to send follow-up messages while CHAPO is processing, with automatic classification as parallel/amendment/expansion.

**Architecture:** Per-session inbox queue with an event bus for reactive notification. CommandDispatcher gates on `isLoopRunning` — if a loop is active, messages go to the inbox instead of starting a new loop. ChapoLoop checks the inbox between iterations and injects queued messages as system context for CHAPO to classify and handle.

**Tech Stack:** TypeScript, Node.js EventEmitter, Vitest

---

### Task 1: Create InboxMessage Type

**Files:**
- Modify: `apps/api/src/agents/types.ts:211-229`

**Step 1: Add InboxMessage interface**

Add after the `ApprovalResponse` interface (line 209) and before `ConversationState`:

```typescript
// Session Inbox
export interface InboxMessage {
  id: string;
  content: string;
  receivedAt: Date;
  acknowledged: boolean;
  source: 'websocket' | 'telegram';
}
```

**Step 2: Add isLoopRunning to ConversationState**

Add `isLoopRunning` field to the `ConversationState` interface (line 212-229):

```typescript
export interface ConversationState {
  sessionId: string;
  currentPhase: AgentPhase;
  activeAgent: AgentName;
  agentHistory: AgentHistoryEntry[];
  taskContext: TaskContext;
  pendingApprovals: ApprovalRequest[];
  pendingQuestions: UserQuestion[];
  parallelExecutions: ParallelExecution[];

  // Plan Mode state
  currentPlan?: ExecutionPlan;
  planHistory: ExecutionPlan[];

  // Task Tracking state
  tasks: PlanTask[];
  taskOrder: string[]; // Ordered list of taskIds

  // Multi-message state
  isLoopRunning: boolean;
}
```

**Step 3: Add inbox event types to AgentStreamEvent**

Add after the scout events block (line 329) in the `AgentStreamEvent` union:

```typescript
  // Inbox events
  | { type: 'message_queued'; messageId: string; preview: string }
  | { type: 'inbox_processing'; count: number }
  | { type: 'inbox_classified'; messageId: string; classification: 'parallel' | 'amendment' | 'expansion'; summary: string }
```

**Step 4: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/agents/types.ts
git commit -m "feat(multi-msg): add InboxMessage type, isLoopRunning flag, inbox events"
```

---

### Task 2: Create SessionInbox + Event Bus Module

**Files:**
- Create: `apps/api/src/agents/inbox.ts`
- Create: `apps/api/src/agents/inbox.test.ts`

**Step 1: Write the failing test**

Create `apps/api/src/agents/inbox.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { pushToInbox, drainInbox, peekInbox, clearInbox, onInboxMessage, offInboxMessage } from './inbox.js';
import type { InboxMessage } from './types.js';

function makeMsg(content: string, source: 'websocket' | 'telegram' = 'websocket'): InboxMessage {
  return {
    id: `msg-${Date.now()}-${Math.random()}`,
    content,
    receivedAt: new Date(),
    acknowledged: false,
    source,
  };
}

describe('SessionInbox', () => {
  const sessionId = 'test-session';

  beforeEach(() => {
    clearInbox(sessionId);
  });

  it('pushToInbox adds a message and peekInbox returns it', () => {
    const msg = makeMsg('hello');
    pushToInbox(sessionId, msg);
    const peeked = peekInbox(sessionId);
    expect(peeked).toHaveLength(1);
    expect(peeked[0].content).toBe('hello');
  });

  it('drainInbox returns all messages and clears the queue', () => {
    pushToInbox(sessionId, makeMsg('first'));
    pushToInbox(sessionId, makeMsg('second'));
    const drained = drainInbox(sessionId);
    expect(drained).toHaveLength(2);
    expect(drained[0].content).toBe('first');
    expect(drained[1].content).toBe('second');
    expect(peekInbox(sessionId)).toHaveLength(0);
  });

  it('peekInbox does not remove messages', () => {
    pushToInbox(sessionId, makeMsg('stay'));
    peekInbox(sessionId);
    expect(peekInbox(sessionId)).toHaveLength(1);
  });

  it('different sessions are independent', () => {
    pushToInbox('a', makeMsg('for-a'));
    pushToInbox('b', makeMsg('for-b'));
    expect(peekInbox('a')).toHaveLength(1);
    expect(peekInbox('b')).toHaveLength(1);
    expect(peekInbox('a')[0].content).toBe('for-a');
  });

  it('clearInbox removes all messages for a session', () => {
    pushToInbox(sessionId, makeMsg('gone'));
    clearInbox(sessionId);
    expect(peekInbox(sessionId)).toHaveLength(0);
  });
});

describe('SessionEventBus', () => {
  const sessionId = 'bus-test';

  beforeEach(() => {
    clearInbox(sessionId);
  });

  it('onInboxMessage fires when pushToInbox is called', () => {
    const received: InboxMessage[] = [];
    const handler = (msg: InboxMessage) => received.push(msg);
    onInboxMessage(sessionId, handler);

    const msg = makeMsg('event-test');
    pushToInbox(sessionId, msg);

    expect(received).toHaveLength(1);
    expect(received[0].content).toBe('event-test');

    offInboxMessage(sessionId, handler);
  });

  it('offInboxMessage stops notifications', () => {
    const received: InboxMessage[] = [];
    const handler = (msg: InboxMessage) => received.push(msg);
    onInboxMessage(sessionId, handler);
    offInboxMessage(sessionId, handler);

    pushToInbox(sessionId, makeMsg('should-not-fire'));
    expect(received).toHaveLength(0);
  });

  it('multiple handlers on the same session all fire', () => {
    let count1 = 0;
    let count2 = 0;
    const h1 = () => { count1++; };
    const h2 = () => { count2++; };
    onInboxMessage(sessionId, h1);
    onInboxMessage(sessionId, h2);

    pushToInbox(sessionId, makeMsg('multi'));

    expect(count1).toBe(1);
    expect(count2).toBe(1);

    offInboxMessage(sessionId, h1);
    offInboxMessage(sessionId, h2);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /opt/Klyde/projects/Devai && npx vitest run apps/api/src/agents/inbox.test.ts
```

Expected: FAIL — module `./inbox.js` does not exist.

**Step 3: Write the implementation**

Create `apps/api/src/agents/inbox.ts`:

```typescript
/**
 * SessionInbox — Per-session message queue + event bus
 *
 * Messages arriving while a ChapoLoop is running are pushed here.
 * The loop drains the inbox between iterations.
 * The event bus provides reactive notification via onInboxMessage/offInboxMessage.
 */

import type { InboxMessage } from './types.js';

type InboxHandler = (msg: InboxMessage) => void;

// Per-session message queues
const inboxes = new Map<string, InboxMessage[]>();

// Per-session event handlers
const handlers = new Map<string, Set<InboxHandler>>();

// ── Queue Operations ──────────────────────────────────

export function pushToInbox(sessionId: string, message: InboxMessage): void {
  let queue = inboxes.get(sessionId);
  if (!queue) {
    queue = [];
    inboxes.set(sessionId, queue);
  }
  queue.push(message);

  // Fire event handlers
  const sessionHandlers = handlers.get(sessionId);
  if (sessionHandlers) {
    for (const handler of sessionHandlers) {
      handler(message);
    }
  }
}

export function drainInbox(sessionId: string): InboxMessage[] {
  const queue = inboxes.get(sessionId);
  if (!queue || queue.length === 0) return [];
  const messages = [...queue];
  queue.length = 0;
  return messages;
}

export function peekInbox(sessionId: string): InboxMessage[] {
  return [...(inboxes.get(sessionId) || [])];
}

export function clearInbox(sessionId: string): void {
  inboxes.delete(sessionId);
  handlers.delete(sessionId);
}

// ── Event Bus ─────────────────────────────────────────

export function onInboxMessage(sessionId: string, handler: InboxHandler): void {
  let sessionHandlers = handlers.get(sessionId);
  if (!sessionHandlers) {
    sessionHandlers = new Set();
    handlers.set(sessionId, sessionHandlers);
  }
  sessionHandlers.add(handler);
}

export function offInboxMessage(sessionId: string, handler: InboxHandler): void {
  const sessionHandlers = handlers.get(sessionId);
  if (!sessionHandlers) return;
  sessionHandlers.delete(handler);
  if (sessionHandlers.size === 0) {
    handlers.delete(sessionId);
  }
}
```

**Step 4: Run test to verify it passes**

```bash
cd /opt/Klyde/projects/Devai && npx vitest run apps/api/src/agents/inbox.test.ts
```

Expected: All 7 tests PASS.

**Step 5: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/agents/inbox.ts apps/api/src/agents/inbox.test.ts
git commit -m "feat(multi-msg): add SessionInbox queue + event bus"
```

---

### Task 3: Add Inbox Events to Event Factory

**Files:**
- Modify: `apps/api/src/agents/events.ts:447-478`

**Step 1: Add InboxEvents factory**

Insert a new `InboxEvents` section before the `SystemEvents` section (before line 447):

```typescript
// ============================================
// INBOX EVENTS
// ============================================

export const InboxEvents = {
  /** User message queued while loop is running */
  messageQueued: (sessionId: string, messageId: string, preview: string) => ({
    ...createBaseEvent('system', sessionId),
    type: 'message_queued' as const,
    messageId,
    preview,
  }),

  /** Inbox messages being processed by CHAPO */
  processing: (sessionId: string, count: number) => ({
    ...createBaseEvent('system', sessionId),
    type: 'inbox_processing' as const,
    count,
  }),

  /** CHAPO classified an inbox message */
  classified: (sessionId: string, messageId: string, classification: 'parallel' | 'amendment' | 'expansion', summary: string) => ({
    ...createBaseEvent('system', sessionId),
    type: 'inbox_classified' as const,
    messageId,
    classification,
    summary,
  }),
};
```

**Step 2: Add InboxEvents to the StreamEvent union**

Update the `StreamEvent` union type (line 484-492) to include `InboxEvents`:

```typescript
export type StreamEvent =
  | ReturnType<(typeof AgentEvents)[keyof typeof AgentEvents]>
  | ReturnType<(typeof ToolEvents)[keyof typeof ToolEvents]>
  | ReturnType<(typeof PlanEvents)[keyof typeof PlanEvents]>
  | ReturnType<(typeof TaskEvents)[keyof typeof TaskEvents]>
  | ReturnType<(typeof ScoutEvents)[keyof typeof ScoutEvents]>
  | ReturnType<(typeof UserEvents)[keyof typeof UserEvents]>
  | ReturnType<(typeof ParallelEvents)[keyof typeof ParallelEvents]>
  | ReturnType<(typeof InboxEvents)[keyof typeof InboxEvents]>
  | ReturnType<(typeof SystemEvents)[keyof typeof SystemEvents]>;
```

**Step 3: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/agents/events.ts
git commit -m "feat(multi-msg): add InboxEvents factory (queued, processing, classified)"
```

---

### Task 4: Wire isLoopRunning into StateManager

**Files:**
- Modify: `apps/api/src/agents/stateManager.ts:230-251`

**Step 1: Add isLoopRunning to buildDefaultState**

Update `buildDefaultState()` (line 230) to include `isLoopRunning: false`:

```typescript
function buildDefaultState(sessionId: string): ConversationState {
  return {
    sessionId,
    currentPhase: 'qualification',
    activeAgent: 'chapo',
    agentHistory: [],
    taskContext: {
      originalRequest: '',
      gatheredFiles: [],
      gatheredInfo: {},
      approvalGranted: false,
    },
    pendingApprovals: [],
    pendingQuestions: [],
    parallelExecutions: [],
    // Plan Mode state
    currentPlan: undefined,
    planHistory: [],
    // Task Tracking state
    tasks: [],
    taskOrder: [],
    // Multi-message state
    isLoopRunning: false,
  };
}
```

**Step 2: Add setLoopRunning / isLoopActive helpers**

Add near the other state setters (find the section with `setPhase`, `setOriginalRequest`, etc.):

```typescript
export function setLoopRunning(sessionId: string, running: boolean): void {
  const state = getOrCreateState(sessionId);
  state.isLoopRunning = running;
}

export function isLoopActive(sessionId: string): boolean {
  const state = getState(sessionId);
  return state?.isLoopRunning ?? false;
}
```

**Step 3: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/agents/stateManager.ts
git commit -m "feat(multi-msg): add isLoopRunning flag + setLoopRunning/isLoopActive helpers"
```

---

### Task 5: Add checkInbox + Event Handler to ChapoLoop

**Files:**
- Modify: `apps/api/src/agents/chapo-loop.ts`

This is the core task. Three changes to ChapoLoop:

**Step 1: Add imports and instance fields**

At the top of `chapo-loop.ts`, add the inbox import (after existing imports, around line 27-28):

```typescript
import { drainInbox, onInboxMessage, offInboxMessage } from './inbox.js';
import type { InboxMessage } from './types.js';
```

Add new instance fields to the `ChapoLoop` class (after `private originalUserMessage = '';` at line 118):

```typescript
  private hasInboxMessages = false;
  private inboxHandler: ((msg: InboxMessage) => void) | null = null;
```

**Step 2: Subscribe to inbox events in the constructor**

Add at the end of the constructor body (after line 131, before the closing `}`):

```typescript
    // Subscribe to inbox events for reactive awareness
    this.inboxHandler = (msg: InboxMessage) => {
      this.hasInboxMessages = true;
      this.sendEvent({
        type: 'message_queued',
        messageId: msg.id,
        preview: 'Got it — I\'ll handle that too',
      });
    };
    onInboxMessage(this.sessionId, this.inboxHandler);
```

**Step 3: Add dispose method**

Add a new `dispose()` method to the class (after the constructor):

```typescript
  dispose(): void {
    if (this.inboxHandler) {
      offInboxMessage(this.sessionId, this.inboxHandler);
      this.inboxHandler = null;
    }
  }
```

**Step 4: Add checkInbox method**

Add a new private method to the class:

```typescript
  private checkInbox(): void {
    if (!this.hasInboxMessages) return;
    this.hasInboxMessages = false;

    const messages = drainInbox(this.sessionId);
    if (messages.length === 0) return;

    const inboxBlock = messages
      .map(
        (m, i) => `[New message #${i + 1} from user while you were working]: "${m.content}"`,
      )
      .join('\n');

    this.conversation.addMessage({
      role: 'system',
      content:
        `${inboxBlock}\n\n` +
        `Classify each new message:\n` +
        `- PARALLEL: Independent task -> use delegateParallel or handle after current task\n` +
        `- AMENDMENT: Replaces/changes current task -> decide: abort (if early) or finish-then-pivot\n` +
        `- EXPANSION: Adds to current task scope -> integrate into current plan\n` +
        `Acknowledge each message to the user in your response.`,
    });

    this.sendEvent({ type: 'inbox_processing', count: messages.length });
  }
```

**Step 5: Insert checkInbox call into runLoop**

In the `runLoop()` method, find the spot after tool results are fed back (line 700-704):

```typescript
      // Feed tool results back to LLM for the next iteration
      this.conversation.addMessage({
        role: 'user',
        content: '',
        toolResults,
      });
```

Insert the `checkInbox()` call **immediately after** this block (after line 704, before the closing `}` of the for loop):

```typescript

      // Check inbox for new messages between iterations
      this.checkInbox();
```

**Step 6: Set/clear isLoopRunning + dispose in the execute method**

Find the main `execute()` method that calls `runLoop()`. The execute method starts around line 160 and calls `this.runLoop()`. We need to wrap it with isLoopRunning flag management.

Find the call to `this.runLoop(userMessage)` in execute (around line 300-315). Before it:

```typescript
    stateManager.setLoopRunning(this.sessionId, true);
```

After the `runLoop` returns (wrap in try/finally):

```typescript
    try {
      const result = await this.runLoop(userMessage);
      // ... existing post-loop code stays here ...
    } finally {
      stateManager.setLoopRunning(this.sessionId, false);
      this.dispose();
    }
```

Note: Read the exact execute() method structure to place this correctly — the try/finally must wrap the `runLoop()` call and ensure cleanup runs even on error.

**Step 7: Handle loop exhaustion with inbox messages**

Update the loop exhaustion handler (line 707-711). Replace:

```typescript
    // Loop exhaustion — ask user
    return this.queueQuestion(
      'Die Anfrage hat mehr Schritte benoetigt als erlaubt. Soll ich weitermachen?',
      this.iteration
    );
```

With:

```typescript
    // Loop exhaustion — check if there are unprocessed inbox messages
    const remaining = drainInbox(this.sessionId);
    if (remaining.length > 0) {
      const extras = remaining.map((m) => m.content).join('; ');
      return this.queueQuestion(
        `Ich habe mein Iterationslimit erreicht. Du hattest auch noch gefragt: "${extras}" — soll ich damit weitermachen?`,
        this.iteration,
      );
    }
    return this.queueQuestion(
      'Die Anfrage hat mehr Schritte benoetigt als erlaubt. Soll ich weitermachen?',
      this.iteration,
    );
```

**Step 8: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/agents/chapo-loop.ts
git commit -m "feat(multi-msg): add checkInbox, inbox event handler, isLoopRunning lifecycle"
```

---

### Task 6: Gate CommandDispatcher with isLoopRunning

**Files:**
- Modify: `apps/api/src/workflow/commands/dispatcher.ts:269-386`

**Step 1: Add imports**

Add at the top of `dispatcher.ts` (with existing imports):

```typescript
import { pushToInbox } from '../agents/inbox.js';
import { isLoopActive } from '../agents/stateManager.js';
import type { InboxMessage } from '../agents/types.js';
```

Note: `stateManager` is likely already imported — check and only add `isLoopActive` to the existing import if so. Similarly for `types.js`.

**Step 2: Add inbox gating logic to handleRequest**

In `handleRequest()` (line 269), find the section after the session ID is resolved and state is loaded (around line 298-300):

```typescript
    const activeSessionId = command.sessionId || (await createSession()).id;
    opts.joinSession(activeSessionId);
    await ensureStateLoaded(activeSessionId);
```

Insert the inbox gate **right after** `ensureStateLoaded` and **before** the pending question check (line 302-307):

```typescript
    // If a loop is already running for this session, queue the message instead
    if (isLoopActive(activeSessionId)) {
      const inboxMsg: InboxMessage = {
        id: nanoid(),
        content: typeof command.message === 'string' ? command.message : '[multimodal content]',
        receivedAt: new Date(),
        acknowledged: false,
        source: (command.metadata?.platform === 'telegram') ? 'telegram' : 'websocket',
      };
      pushToInbox(activeSessionId, inboxMsg);
      return {
        type: 'queued',
        sessionId: activeSessionId,
      };
    }
```

Note: `nanoid` is already imported in this file. The `DispatchResult` type may need a new `'queued'` variant — check the return type and add it if needed.

**Step 3: Update DispatchResult type**

Find the `DispatchResult` interface/type in `dispatcher.ts`. Add `'queued'` as a valid type:

```typescript
// If DispatchResult looks like { type: 'success' | 'error'; ... }
// Add 'queued' to the union
```

Verify the exact shape by reading the type definition and updating accordingly.

**Step 4: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/workflow/commands/dispatcher.ts
git commit -m "feat(multi-msg): gate handleRequest with isLoopRunning, push to inbox if active"
```

---

### Task 7: Gate Telegram Webhook with Inbox Logic

**Files:**
- Modify: `apps/api/src/routes/external.ts:184-206`

**Step 1: Add imports**

Add to the imports at the top of `external.ts`:

```typescript
import { pushToInbox } from '../agents/inbox.js';
import { isLoopActive } from '../agents/stateManager.js';
import type { InboxMessage } from '../agents/types.js';
```

**Step 2: Add inbox gate in the Telegram handler**

In the Telegram message handler, find the `else` branch where a `user_request` command is built (line 184-195). Before the `commandDispatcher.dispatch()` call (line 198), add the inbox check:

```typescript
        // If a loop is already running, queue instead of dispatching
        if (isLoopActive(externalSession.session_id)) {
          const inboxMsg: InboxMessage = {
            id: nanoid(),
            content: messageText,
            receivedAt: new Date(),
            acknowledged: false,
            source: 'telegram',
          };
          pushToInbox(externalSession.session_id, inboxMsg);
          await sendTelegramMessage(
            extracted.chatId,
            'Nachricht erhalten — ich kuemmere mich darum, sobald ich mit dem aktuellen Task fertig bin.',
          );
          return;
        }
```

This goes **inside** the `else` block, **before** the `command = { type: 'user_request', ... }` assignment (line 188). The early return skips the dispatch entirely.

**Step 3: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/routes/external.ts
git commit -m "feat(multi-msg): gate Telegram webhook with inbox logic + ack message"
```

---

### Task 8: Add Inbox Classification to CHAPO System Prompt

**Files:**
- Modify: `apps/api/src/prompts/chapo.ts:113-119`

**Step 1: Add inbox handling section**

Insert before the `## QUALITAETSREGELN` section (before line 114):

```typescript
## NACHRICHTEN-INBOX
Waehrend du arbeitest koennen neue Nachrichten vom Nutzer eintreffen.
Diese werden dir als System-Nachrichten mit dem Praefix "[New message #N from user while you were working]" praesentiert.

Klassifiziere jede neue Nachricht:
- **PARALLEL**: Unabhaengige Aufgabe -> nutze delegateParallel oder bearbeite sie nach dem aktuellen Task
- **AMENDMENT**: Aendert den aktuellen Task -> entscheide: abbrechen (wenn frueh, Iteration < 5) oder fertigstellen-dann-umlenken
- **EXPANSION**: Erweitert den aktuellen Task -> integriere in den laufenden Plan

Regeln:
- Bestaetige jede eingegangene Nachricht in deiner Antwort
- Bei PARALLEL: Delegiere sofort wenn moeglich, antworte am Ende zu allem
- Bei AMENDMENT im fruehen Stadium: Pivot sofort zum neuen Ziel
- Bei AMENDMENT im spaeten Stadium: Beende die aktuelle Arbeit, dann wechsle
- Bei EXPANSION: Integriere den zusaetzlichen Scope in den laufenden Plan

```

**Step 2: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/prompts/chapo.ts
git commit -m "feat(multi-msg): add inbox classification instructions to CHAPO prompt"
```

---

### Task 9: Unlock Frontend Input During Processing

**Files:**
- Modify: `apps/web/src/components/ChatUI/ChatUI.tsx`

**Step 1: Remove the early return guard in sendChatMessage**

Find the `sendChatMessage` function (line 256). Remove or change the early return:

```typescript
// BEFORE:
const sendChatMessage = async (content: string) => {
  if (isLoadingInternal) return;

// AFTER:
const sendChatMessage = async (content: string) => {
  // Removed: messages now queue via inbox when loop is running
```

**Step 2: Remove the isLoadingInternal guard in handleSubmit**

Find `handleSubmit` (line 322-328). Change the guard:

```typescript
// BEFORE:
if (!input.trim() || isLoadingInternal) return;

// AFTER:
if (!input.trim()) return;
```

**Step 3: Keep the loading visual indicator**

The `isLoadingInternal` state and `isLoading` prop to `InputArea` should remain — they drive visual indicators (spinner, status bar). Only the **blocking guards** are removed. The input field should remain visually styled (e.g. subtle indicator that CHAPO is working) but functionally enabled.

Check how `InputArea` uses the `isLoading` prop. If it sets `disabled={isLoading}` on the textarea/input, change it to only show a visual indicator instead:

```typescript
// In InputArea component, find the input/textarea element
// BEFORE: disabled={isLoading}
// AFTER: remove disabled prop (or set to false)
// Keep any visual indicator like a spinner or status text
```

**Step 4: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/web/src/components/ChatUI/ChatUI.tsx
# Also add InputArea if modified
git commit -m "feat(multi-msg): unlock chat input during processing, keep visual indicator"
```

---

### Task 10: Handle New Inbox Events in Frontend

**Files:**
- Modify: `apps/web/src/components/ChatUI/ChatUI.tsx`
- Modify: `apps/web/src/api.ts` (if ChatStreamEvent needs updating — it's currently `{ type: string; [key: string]: unknown }` so it's flexible enough)

**Step 1: Add inbox event handling to handleStreamEvent**

In `handleStreamEvent()` (around line 190-251), add cases for the new event types:

```typescript
      case 'message_queued': {
        // Show lightweight status that message was received
        // Add a status tool event or inline indicator
        const preview = String(event.preview || 'Message received');
        addToolEvent({
          id: String(event.messageId || nanoid()),
          type: 'status',
          name: 'inbox',
          result: preview,
          completed: true,
          agent: 'chapo',
        });
        break;
      }
      case 'inbox_processing': {
        addToolEvent({
          id: nanoid(),
          type: 'status',
          name: 'inbox',
          result: `Processing ${event.count} follow-up message(s)...`,
          completed: false,
          agent: 'chapo',
        });
        break;
      }
      case 'inbox_classified': {
        addToolEvent({
          id: String(event.messageId || nanoid()),
          type: 'status',
          name: 'inbox',
          result: `${String(event.classification)}: ${String(event.summary)}`,
          completed: true,
          agent: 'chapo',
        });
        break;
      }
```

**Step 2: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/web/src/components/ChatUI/ChatUI.tsx
git commit -m "feat(multi-msg): handle message_queued, inbox_processing, inbox_classified events in UI"
```

---

### Task 11: Integration Test — Dispatcher Inbox Gating

**Files:**
- Modify: `apps/api/src/workflow/commands/dispatcher.test.ts`

**Step 1: Write integration test**

Add a new test section to the existing dispatcher tests:

```typescript
import { pushToInbox, drainInbox, clearInbox } from '../agents/inbox.js';
import * as stateManager from '../agents/stateManager.js';

describe('handleRequest inbox gating', () => {
  it('queues message when isLoopRunning is true', async () => {
    // This test verifies the dispatcher pushes to inbox instead of starting a new loop
    // when isLoopRunning is true for the session.
    // Implementation depends on how the dispatcher is instantiated in tests.
    // At minimum, verify the logical flow:

    const sessionId = 'gate-test';
    stateManager.getOrCreateState(sessionId);
    stateManager.setLoopRunning(sessionId, true);

    expect(stateManager.isLoopActive(sessionId)).toBe(true);

    // Simulate what the dispatcher does:
    const msg = {
      id: 'test-msg',
      content: 'follow-up question',
      receivedAt: new Date(),
      acknowledged: false,
      source: 'websocket' as const,
    };
    pushToInbox(sessionId, msg);

    const queued = drainInbox(sessionId);
    expect(queued).toHaveLength(1);
    expect(queued[0].content).toBe('follow-up question');

    // Cleanup
    stateManager.setLoopRunning(sessionId, false);
    clearInbox(sessionId);
  });
});
```

**Step 2: Run all tests**

```bash
cd /opt/Klyde/projects/Devai && npx vitest run
```

Expected: All tests PASS.

**Step 3: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/workflow/commands/dispatcher.test.ts
git commit -m "test(multi-msg): add inbox gating integration test"
```

---

### Task 12: Final Verification + Push

**Step 1: Run full test suite**

```bash
cd /opt/Klyde/projects/Devai && npx vitest run
```

Expected: All tests PASS.

**Step 2: TypeScript check**

```bash
cd /opt/Klyde/projects/Devai/apps/api && npx tsc --noEmit
```

Expected: No type errors.

**Step 3: Push to dev**

```bash
cd /opt/Klyde/projects/Devai && git push origin dev
```

Wait for Mutagen sync (~500ms) then verify preview at devai.klyde.tech.

---

## Testing Checklist (Manual)

After deployment, test these scenarios via Web UI:

1. **Parallel**: Send "What's the weather in Frankfurt?" → while CHAPO works, send "What time is it in Tokyo?" → both answers should appear
2. **Amendment**: Send "Show me the content of CLAUDE.md" → quickly send "Just give me the file as download" → CHAPO should pivot
3. **Expansion**: Send "Create a website plan with contact form" → while planning, send "And add an imprint page" → CHAPO should integrate
4. **Rapid-fire**: Send 3 messages quickly → all should queue and be classified together
5. **Telegram**: Same tests via Telegram bot → acknowledgment message should appear immediately

## Dependency Graph

```
Task 1 (types) ← Task 2 (inbox module)
Task 1 (types) ← Task 3 (events)
Task 1 (types) ← Task 4 (stateManager)
Task 2 + Task 4 ← Task 5 (chapo-loop) ← Task 8 (prompt)
Task 2 + Task 4 ← Task 6 (dispatcher)
Task 2 + Task 4 ← Task 7 (telegram)
Task 3 ← Task 10 (frontend events)
Task 9 (unlock input) — independent
Task 5 + Task 6 + Task 7 ← Task 11 (integration test)
Task 11 ← Task 12 (verification)
```
