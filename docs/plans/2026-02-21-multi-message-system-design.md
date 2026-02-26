# Multi-Message System Design

**Date:** 2026-02-21
**Status:** Approved (brainstorming complete)
**Scope:** Full stack (backend + frontend + Telegram)

---

## Problem

Devai currently processes one message at a time per session. If a user sends a second message while CHAPO is working, a parallel `processRequest()` starts with no locking, corrupting shared state. Users cannot:
- Send independent follow-up questions while CHAPO works
- Amend or change a task mid-execution
- Expand the scope of a running task

## Solution: Session Inbox with In-Loop Classification

New messages arriving during an active ChapoLoop are queued in a per-session inbox. Between each loop iteration, CHAPO checks the inbox and classifies each message as **parallel**, **amendment**, or **expansion** — using its own intelligence and full context.

### Design Principles

- **No external classifier** — CHAPO classifies within the loop (has the most context)
- **Acknowledge + classify** — user always knows what happened to their message
- **Channel-agnostic** — inbox works identically for Web UI and Telegram
- **Smart amendment** — CHAPO decides abort vs finish based on progress

---

## Architecture

### 1. Session Inbox

A per-session in-memory queue that collects messages while a ChapoLoop is running.

```typescript
interface InboxMessage {
  id: string;
  content: string;
  receivedAt: Date;
  acknowledged: boolean;
  source: 'websocket' | 'telegram';
}
```

Lives in `stateManager.ts` alongside existing per-session state:

```typescript
const inboxes = new Map<string, InboxMessage[]>();

export function pushToInbox(sessionId: string, message: InboxMessage): void;
export function drainInbox(sessionId: string): InboxMessage[];
export function peekInbox(sessionId: string): InboxMessage[];
```

### 2. Session Lock + Inbound Event Handler

A boolean flag `isLoopRunning` on the session state. The `CommandDispatcher` checks this before deciding whether to start a new loop or queue the message.

The ChapoLoop registers an **inbound event handler** on construction that listens for new inbox messages. This gives the loop reactive awareness of incoming messages — not just passive polling between iterations.

```
WebSocket/Telegram Message
      |
      v
CommandDispatcher.dispatch()
      |
      v
  isLoopRunning for this session?
      |--- NO  --> Start new ChapoLoop normally
      |--- YES --> Push message into SessionInbox
                --> Emit 'inbox:message' event on session event bus
                --> Send acknowledgment event to frontend
                --> Return immediately
```

The ChapoLoop subscribes to the session event bus on startup:

```typescript
// In ChapoLoop constructor
this.inboxHandler = sessionEvents.on(`inbox:message:${sessionId}`, (msg: InboxMessage) => {
  this.hasInboxMessages = true;  // Flag checked in runLoop()
  this.sendEvent({
    type: 'message_queued',
    messageId: msg.id,
    preview: `Got it — I'll handle that too`,
  });
});

// Cleanup on loop exit
dispose(): void {
  sessionEvents.off(`inbox:message:${this.sessionId}`, this.inboxHandler);
}
```

This means the acknowledgment fires immediately when the message arrives (via the event handler), not on the next iteration poll. The `hasInboxMessages` flag tells the loop to run `checkInbox()` — avoiding unnecessary drain calls on every iteration.

### 3. Inbox Check in ChapoLoop

New method `checkInbox()` runs between every iteration, after tool results and before the next LLM call:

```
runLoop() iteration:
  1. Execute tools / delegation / answer
  2. Feed results back to conversation
  3. --> checkInbox() <-- NEW
  4. Next LLM call (with inbox context injected if any)
```

Implementation:

```typescript
private checkInbox(): void {
  const messages = sessionInbox.drain(this.sessionId);
  if (messages.length === 0) return;

  const inboxBlock = messages.map((m, i) =>
    `[New message #${i + 1} from user while you were working]: "${m.content}"`
  ).join('\n');

  this.conversation.addMessage({
    role: 'system',
    content: `${inboxBlock}\n\n` +
      `Classify each new message:\n` +
      `- PARALLEL: Independent task -> use delegateParallel or handle after current task\n` +
      `- AMENDMENT: Replaces/changes current task -> decide: abort (if early) or finish-then-pivot\n` +
      `- EXPANSION: Adds to current task scope -> integrate into current plan\n` +
      `Acknowledge each message to the user in your response.`
  });

  this.sendEvent({ type: 'inbox_processing', count: messages.length });
}
```

### 4. Classification Behaviors

CHAPO expresses its decision through its normal tool calls and responses:

#### PARALLEL — Independent tasks

CHAPO uses `delegateParallel` to fire off the independent task while continuing its current work. Result feeds back and CHAPO includes both answers in its response.

```
Current task: "Create a website with contact form"
New message: "What's the weather in Frankfurt?"

-> CHAPO calls delegateParallel([{ agent: 'scout', task: 'Weather Frankfurt' }])
-> Scout runs in parallel, result feeds back
-> CHAPO answers website work AND weather
```

#### AMENDMENT — Task changed

CHAPO decides based on progress (iteration count vs max):
- **Early** (iteration < 5): Abort current approach, pivot to new intent
- **Late** (iteration >= 15): Finish current work, then handle amendment
- **Middle**: CHAPO judges based on context and partial results

```
Iteration 3: "Show me file X" -> reading file...
New message: "Just give me the file as download"

-> CHAPO pivots: calls deliverDocument() instead of showing content
-> Acknowledges: "Understood, providing the file as download instead"
```

#### EXPANSION — Scope grows

CHAPO integrates the additional scope into current work. If Plan Mode is active, it updates the plan. Otherwise, it adds the requirement to its reasoning.

```
Working on: "Create website with contact form"
New message: "And add an imprint subpage"

-> CHAPO acknowledges: "Adding imprint page to the scope"
-> Includes imprint in subsequent work
```

---

## Frontend Changes (Web UI)

### Input stays unlocked

The chat input remains enabled while CHAPO is processing. Visual indicator (pulsing status bar or spinner) shows CHAPO is working, but the input is always available.

### New WebSocket events

| Event | UI Effect |
|-------|-----------|
| `message_queued` | Show status chip: "Message received — processing" |
| `inbox_processing` | Update status: "Handling your follow-up..." |
| `inbox_classified` | Show classification: "Running in parallel" / "Adjusting task" / "Expanding scope" |

These appear as lightweight inline status messages, not full assistant bubbles.

### Response rendering

Responses remain linear in the chat. For parallel tasks, CHAPO formats its answer with clear sections covering all topics. No major UI restructuring needed.

---

## Telegram Integration

### Channel-agnostic inbox

Both WebSocket and Telegram webhook push into the same SessionInbox. The inbox, classification, and loop behavior are identical for both channels.

```
Web UI (WebSocket)  -+
                     +---> CommandDispatcher ---> SessionInbox ---> ChapoLoop
Telegram (webhook)  -+
```

### Telegram-specific delivery

| Aspect | Web UI | Telegram |
|--------|--------|----------|
| Acknowledgment | `message_queued` WS event -> status chip | Quick text reply via bot API |
| Classification feedback | `inbox_classified` WS event | Included in final response |
| Response delivery | Streamed via WebSocket | Single/multiple text messages via bot API |

---

## Edge Cases

### Rapid-fire messages (3+ messages before inbox check)

All accumulate in the inbox. On next `checkInbox()`, CHAPO sees them all at once, classifies each, and handles them together. Messages are processed in order — a late amendment overrides earlier parallel tasks if it changes the overall direction.

### Message during delegation (DEVO/SCOUT sub-loop)

Inbox check runs in ChapoLoop's main loop only, not inside sub-agent loops. Messages queue until the delegation completes and control returns to CHAPO's next iteration. CHAPO is the coordinator.

### Message during Plan Mode

Messages queue normally. When `checkInbox()` runs between plan steps, CHAPO can integrate expansions into the plan or abort planning if the task was amended.

### Loop exhaustion with inbox messages

If the loop hits max iterations (20) with unprocessed inbox messages, CHAPO acknowledges both: "I've reached my iteration limit. I also have your follow-up about X — should I continue with that?"

### Concurrent sessions

No issue — inboxes are per-session. Different sessions are fully independent.

---

## Files to Modify

### Backend (`apps/api/src/`)

| File | Change |
|------|--------|
| `agents/stateManager.ts` | Add `SessionInbox` (pushToInbox, drainInbox, peekInbox), `isLoopRunning` flag |
| `agents/chapo-loop.ts` | Add `checkInbox()` method, call between iterations, set/clear `isLoopRunning` |
| `agents/events.ts` | Add `message_queued`, `inbox_processing`, `inbox_classified` event types |
| `agents/types.ts` | Add `InboxMessage` interface |
| `websocket/dispatcher.ts` | Check `isLoopRunning` before starting loop, push to inbox if running |
| `external/telegram.ts` | Same inbox logic for Telegram webhook messages |
| `prompts/chapo.ts` | Add inbox classification instructions to CHAPO system prompt |

### Frontend (`apps/web/src/`)

| File | Change |
|------|--------|
| `components/ChatUI.tsx` | Keep input unlocked during processing, handle new event types |
| `types.ts` | Add new event type definitions |

### New Files

| File | Purpose |
|------|---------|
| `agents/inbox.ts` | SessionInbox implementation (queue, drain, peek) + session event bus (EventEmitter per session for `inbox:message` events) |

---

## Non-Goals

- Message prioritization or reordering (messages processed in arrival order)
- Per-message cancellation UI (user can't cancel a specific queued message)
- Separate response threads (chat stays linear)
- Multi-user per session (sessions remain single-user)
