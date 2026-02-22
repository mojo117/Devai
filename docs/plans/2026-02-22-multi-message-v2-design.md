# Multi-Message Response System v2 — Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable CHAPO to handle multiple user messages with separate, sequential responses instead of mushing everything into one combined answer.

**Architecture:** Extends CHAPO's existing decision cycle (ASK, ANSWER, DELEGATE, TOOL) with a `respondToUser` tool for intermediate answers and non-blocking `askUser` for parallel questions. No new agents, no new classification systems — CHAPO (GLM-5) decides how to handle each message through the same decision tree.

**Tech Stack:** TypeScript, Fastify WebSocket, existing CHAPO loop + delegation system

---

## Problem Analysis

When a user sends multiple messages while CHAPO is working:

1. **Messages get mushed together** — Independent tasks can't get separate answers because inbox messages are injected as system hints and the LLM produces one combined response.

2. **Inbox obligations are non-blocking** — Queued messages create obligations with `blocking: false`, so the Coverage Guard ignores them. They can silently "slip through."

3. **Inbox injection is a soft prompt** — Messages arrive as system-role text with "Acknowledge each message," leading to meta-responses ("Got it, I'll handle that too") instead of real answers.

4. **Timing gap** — `checkInbox()` only runs after tool results. If the LLM returns a final answer (no tool calls), inbox is never checked. Late-arriving messages are lost or only caught by the loop-exhaustion handler.

5. **No way to send intermediate responses** — The loop can only produce one final answer. There's no mechanism for CHAPO to answer a quick question while continuing work on a complex task.

## Design Decisions

### Decision: Trust the model, not heuristics

CHAPO (GLM-5) decides whether a new message is an amendment or an independent task — not the intake classifier, not the obligation system. The model sees the full conversation and makes its normal ASK/ANSWER/DELEGATE/TOOL decision.

**Rationale:** GLM-5 is strong enough to handle routing in-context. The intake classifier (`intakeClassifier.ts`) stays for cheap gate-routing (yes/no detection, approval matching) but doesn't classify multi-intent or inbox messages. The obligation system stays as a lightweight safety net but isn't the primary tracking mechanism.

**Future consideration:** Both intake classifier and obligation system may be removed if GLM-5 proves reliable enough at self-tracking via conversation context.

### Decision: `respondToUser` as a regular tool

Instead of adding a new orchestration layer, CHAPO gets a `respondToUser` tool that fits naturally into his existing decision cycle. It's a tool call, so the loop keeps iterating — no special logic needed.

**Alternative considered:** Post-loop inbox drain that re-enters `processRequest` for each queued message. Rejected because it doesn't handle amendments vs. independent tasks — the model needs to see everything in context to decide.

**Alternative considered:** `deferToNextTurn` tool that queues a message for a separate loop cycle. Rejected as unnecessary — CHAPO can delegate or answer directly, no need for a new deferral concept.

### Decision: CHAPO handles task tracking himself

CHAPO uses the conversation + `respondToUser` tool as the primary mechanism for tracking multiple tasks. No formal task list, no CAIO triage for normal volumes.

**Alternative considered (Option A):** Make all inbox obligations `blocking: true` and rely on the obligation keyword-matching system. Rejected because it doesn't produce separate answers and keyword matching is fragile.

**Alternative considered (Option B):** Reuse `PlanTask` entries for inbox messages. Rejected as too heavy — PlanTask has `planId`, `blockedBy`, `toolsToExecute` etc., designed for structured plan execution.

**Alternative considered (Option C):** New lightweight `InboxTask` data structure. Rejected as unnecessary complexity if the model can self-track.

**Alternative considered (Option D):** CAIO as inbox manager — triaging, prioritizing, tracking completion for high-volume inboxes. Not needed now but architecturally possible: CHAPO delegates inbox triage to CAIO when volume is high, CAIO organizes tasks and reports back. Documented here for future reference if model self-tracking proves insufficient.

### Decision: Non-blocking `askUser` via inbox

When CHAPO asks a question about task B while working on task A, the loop continues. The user's reply arrives as an inbox message (which is now a `user` role message). CHAPO matches the reply to the question by conversation context — no ID-based routing needed.

**Rationale:** GLM-5 can match "JWT" to the auth provider question as long as the full Q&A history is in the conversation. This is the same pattern as Claude Code interrupts.

---

## Architecture Changes

### 1. `respondToUser` Tool

**Purpose:** Lets CHAPO send a user-visible chat bubble at any point during the loop without ending the loop.

```typescript
// Tool definition
{
  name: 'respondToUser',
  description: 'Send an intermediate response to the user while continuing to work on other tasks. Use this when you have completed one task but still have other tasks to handle.',
  parameters: {
    message: { type: 'string', description: 'The response text to show the user' },
    inReplyTo: { type: 'string', description: 'Optional: quote or reference to which user message this answers', optional: true },
  },
}
```

**Backend behavior:**
1. Persist message to DB as an assistant message
2. Emit `partial_response` WebSocket event with message content
3. Return tool result `"delivered"` so the loop continues
4. Message stays in conversation context

**Frontend behavior:**
- `partial_response` event renders immediately as a normal assistant chat bubble
- Tool events keep streaming below it for ongoing work
- Loading indicator stays visible until final `response` event

### 2. Non-blocking `askUser`

**Current:** `askUser` always sets phase to `waiting_user`, loop pauses.

**New:** `askUser` gains a `blocking` parameter:

```typescript
{
  name: 'askUser',
  parameters: {
    question: { type: 'string' },
    blocking: { type: 'boolean', default: true, description: 'If false, the loop continues while waiting for the answer. Reply arrives via inbox.' },
  },
}
```

- `blocking: true` — same as today, pauses loop (default, backwards compatible)
- `blocking: false` — question emitted to user, tool returns `"question sent, continuing"`, loop does NOT pause, reply arrives via inbox

### 3. Inbox Message Injection as `user` Role

**Before:** `contextManager.checkInbox()` injects inbox as system hint with classification instructions.

**After:** Inbox messages injected as `user` role messages:

```typescript
// contextManager.ts — simplified checkInbox()
checkInbox(): boolean {
  if (!this.hasInboxMessages) return false;
  this.hasInboxMessages = false;

  const messages = drainInbox(this.sessionId);
  if (messages.length === 0) return false;

  for (const msg of messages) {
    this.conversation.addMessage({
      role: 'user',
      content: msg.content,
    });
  }
  return true; // signals that new messages were injected
}
```

**Removed:**
- `mapIntakeToInboxClassification()` — no more PARALLEL/AMENDMENT/EXPANSION labels
- System prompt with classification instructions
- `inbox_classified` event emission

### 4. Timing Fix — Check Inbox Before Final Answer

In `chapo-loop.ts`, the answer path (no tool calls) checks inbox before exiting:

```typescript
// No tool calls → ACTION: ANSWER
if (!response.toolCalls || response.toolCalls.length === 0) {
  // Check inbox before finalizing — catch late-arriving messages
  const hasNew = this.contextManager.checkInbox();
  if (hasNew) {
    // Save current answer as intermediate response, continue loop
    this.conversation.addMessage({
      role: 'assistant',
      content: response.content || '',
    });
    continue;
  }

  // No new messages — proceed to validation and exit
  const answer = response.content || '';
  // ... existing validation logic
}
```

### 5. Obligation Adjustment

- Inbox obligations become `blocking: true` in `commandHandlers.ts:154`
- `respondToUser` tool results satisfy corresponding inbox obligations (keyword match)
- Coverage Guard catches dropped messages as last-resort safety net

### 6. CHAPO Prompt Update

Add to CHAPO's system prompt:

```
- Nutze respondToUser um Zwischenantworten zu senden wenn du mehrere Aufgaben bearbeitest
- Nutze askUser mit blocking=false wenn du eine Frage zu einer Aufgabe hast aber an einer anderen weiterarbeiten kannst
- Neue User-Nachrichten waehrend du arbeitest sind eigenstaendige Anfragen — entscheide ob sie die aktuelle Aufgabe aendern oder unabhaengig sind
- Bei unabhaengigen Anfragen: beantworte sie per respondToUser oder delegiere sie, dann arbeite an der aktuellen Aufgabe weiter
```

### 7. Frontend: `partial_response` Event Handler

```typescript
// ChatUI.tsx — new case in handleStreamEvent
case 'partial_response': {
  const assistantMessage = createChatMessage('assistant', event.message);
  setMessages(prev => [...prev, assistantMessage]);
  // Freeze current tool events to this message
  freezeToolEvents(assistantMessage.id);
  // Keep isLoading true — loop is still running
  break;
}
```

---

## Flow Examples

### Two independent tasks

```
User: "Fix the login bug"              → Loop starts
User: "What's the weather?"            → Inbox queue

Iteration 1: CHAPO analyzes login bug
Iteration 2: checkInbox() → "What's the weather?" injected as user message
Iteration 3: CHAPO calls respondToUser("In Darmstadt sind es 15°C und sonnig.")
             → User sees weather bubble immediately
Iteration 4: CHAPO calls delegateToDevo({ objective: "Fix login validation" })
             → DEVO works on the bug
Iteration 5: DEVO result → CHAPO answers about the fix (no tool calls → loop exits)
             → User sees login fix bubble
```

### Amendment to current task

```
User: "Fix the login bug"              → Loop starts
User: "Actually use OAuth instead"     → Inbox queue

Iteration 1: CHAPO starts analyzing login bug
Iteration 2: checkInbox() → "Actually use OAuth" injected as user message
Iteration 3: CHAPO sees this changes the current task
             → Integrates OAuth into the fix
             → Delegates to DEVO with updated objective
Iteration 4: DEVO result → single answer covering both
```

### Parallel questions

```
User: "Set up auth"                    → Loop starts
User: "Send the report to Max"         → Inbox queue

Iteration 1: CHAPO analyzes auth task
Iteration 2: checkInbox() → report request injected
Iteration 3: CHAPO calls askUser(question: "Which auth provider — OAuth or JWT?", blocking: false)
             → Question shown to user, loop continues
Iteration 4: CHAPO calls delegateToCaio({ objective: "Send report to Max" })
             → CAIO works on the email
Iteration 5: CAIO result → CHAPO calls respondToUser("Report an Max gesendet.")
User: "JWT"                            → Inbox queue
Iteration 6: checkInbox() → "JWT" injected as user message
             → CHAPO matches to auth question by context
             → Delegates auth setup to DEVO with JWT
...
```

---

## Implementation Order

1. **Timing fix** — add `checkInbox()` before answer exit in `chapo-loop.ts`
2. **Inbox injection as `user` messages** — simplify `contextManager.ts`, remove classification
3. **`respondToUser` tool** — tool definition, handler, `partial_response` event, DB persistence
4. **Frontend `partial_response` handler** — render intermediate bubbles in `ChatUI.tsx`
5. **Non-blocking `askUser`** — add `blocking` parameter, skip phase change when false
6. **Obligation adjustment** — inbox obligations `blocking: true`, `respondToUser` satisfies obligations
7. **CHAPO prompt update** — document new tools in system prompt

---

## Architecture Notes (Future Reference)

### CAIO as Task Manager (not implemented, documented for future)

If CHAPO's self-tracking proves insufficient at high inbox volumes, CAIO can be introduced as an inbox manager:
- CHAPO delegates inbox triage to CAIO when 3+ messages pile up
- CAIO organizes tasks, identifies dependencies/overlaps, prioritizes
- CAIO reports back with structured task list
- CHAPO executes based on CAIO's triage

This uses existing delegation infrastructure — no new systems needed.

### Intake Classifier (may be removed)

The intake classifier (`intakeClassifier.ts`) currently handles:
- yes/no detection for pending approvals
- Explicit `/answer` prefix for gate responses
- Smalltalk detection
- Default `task_request` classification

With GLM-5 handling routing in-loop, the classifier may become redundant. Keep it for now as a cheap pre-filter, evaluate removal after v2 is stable.

### Obligation System (may be simplified)

The obligation ledger currently tracks:
- User request obligations (with keyword-based coverage checking)
- Delegation obligations (resolved by delegation results)
- Inbox obligations (currently `blocking: false`, changed to `true` in v2)

With `respondToUser` providing structural evidence that a task was answered, keyword-based coverage checking may become unnecessary. Evaluate simplification after v2 is stable.
