# Conversation Persistence & Global Context

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix CHAPO losing conversation context and add a global context input field.

**Architecture:** Load chat history from DB before processing requests. Add global context setting that gets appended to system prompts.

**Tech Stack:** Supabase (existing), React, Fastify

---

## Problem Statement

1. **Conversation Persistence:** CHAPO only receives the current message, not chat history. Users have to repeat context.
2. **Global Context:** Users want to provide persistent context that applies to all sessions (e.g., "I'm working on auth").

---

## Task 1: Add History Loading to Chat Endpoint

**Files:**
- Modify: `apps/api/src/routes/chat.ts`

**Changes:**

In the `/chat/agents` endpoint, after getting `activeSessionId`, load history:

```typescript
import { getMessages } from '../db/queries.js';

// ... inside the endpoint, after activeSessionId is set:

// Load conversation history (last 30 messages)
const historyMessages = await getMessages(activeSessionId);
const recentHistory = historyMessages.slice(-30);
```

Pass history to the router:

```typescript
const result = await processMultiAgentRequest(
  activeSessionId,
  message,
  recentHistory,  // NEW
  validatedProjectRoot || config.allowedRoots[0],
  sendEvent
);
```

---

## Task 2: Update Router to Accept History

**Files:**
- Modify: `apps/api/src/agents/router.ts`

**Changes:**

Update `processRequest` signature:

```typescript
export async function processRequest(
  sessionId: string,
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>,  // NEW
  projectRoot: string | null,
  sendEvent: SendEventFn
): Promise<string> {
```

In `executeSimpleTask` and `runChapoQualification`, build messages with history:

```typescript
const messages: LLMMessage[] = [
  ...conversationHistory.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content
  })),
  { role: 'user', content: userMessage },
];
```

---

## Task 3: Update New Router to Accept History

**Files:**
- Modify: `apps/api/src/agents/newRouter.ts`

**Changes:**

Update `NewProcessRequestOptions` interface:

```typescript
export interface NewProcessRequestOptions {
  sessionId: string;
  userMessage: string;
  conversationHistory: Array<{ role: string; content: string }>;  // NEW
  projectRoot: string | null;
  sendEvent: SendEventFn;
}
```

Pass history to analyzer and executor as needed.

---

## Task 4: Add Global Context API Endpoint

**Files:**
- Modify: `apps/api/src/routes/chat.ts`

**Changes:**

The settings endpoints already exist. Just need to load global context in chat endpoints:

```typescript
import { getSetting } from '../db/queries.js';

// In both /chat and /chat/agents endpoints:
const globalContext = await getSetting('globalContext') || '';

// Append to system prompt:
const globalContextBlock = globalContext
  ? `\n\nUser Context:\n${globalContext}`
  : '';

// Use in systemPrompt: SYSTEM_PROMPT + projectContextBlock + globalContextBlock + ...
```

---

## Task 5: Add Global Context UI

**Files:**
- Modify: `apps/web/src/App.tsx`

**Changes:**

Add state for global context:

```typescript
const [globalContext, setGlobalContext] = useState('');
const [contextSaving, setContextSaving] = useState(false);
const [contextSaved, setContextSaved] = useState(false);
```

Load on mount:

```typescript
useEffect(() => {
  fetchSetting('globalContext').then(res => {
    if (res.value) setGlobalContext(res.value);
  });
}, []);
```

Add save handler:

```typescript
const handleSaveContext = async () => {
  if (globalContext.length > 2000) return;
  setContextSaving(true);
  await saveSetting('globalContext', globalContext);
  setContextSaving(false);
  setContextSaved(true);
  setTimeout(() => setContextSaved(false), 2000);
};
```

Add UI in sidebar (alongside existing tabs):

```tsx
<div className="p-3">
  <h3 className="text-sm font-medium text-gray-300 mb-2">Global Context</h3>
  <textarea
    value={globalContext}
    onChange={(e) => setGlobalContext(e.target.value)}
    maxLength={2000}
    rows={6}
    className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-gray-200 resize-none"
    placeholder="Add context that applies to all conversations..."
  />
  <div className="flex justify-between items-center mt-2">
    <span className={`text-xs ${globalContext.length > 1800 ? 'text-red-400' : 'text-gray-500'}`}>
      {globalContext.length} / 2000
    </span>
    <button
      onClick={handleSaveContext}
      disabled={contextSaving || globalContext.length > 2000}
      className="text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white px-3 py-1 rounded"
    >
      {contextSaved ? 'Saved ✓' : contextSaving ? 'Saving...' : 'Save'}
    </button>
  </div>
</div>
```

---

## Error Handling

| Scenario | Handling |
|----------|----------|
| History loading fails | Log warning, continue with empty history |
| Global context > 2000 chars | Frontend prevents save, shows character count in red |
| Settings API unreachable | Show toast notification |

---

## Verification

1. Start a new chat session
2. Ask "What folders do you have access to?"
3. Wait for response listing folders
4. Ask "What's the difference between the klyde folders?"
5. **Expected:** CHAPO remembers the previous response and answers correctly

6. Add global context: "Always respond in German"
7. Start new session, ask any question
8. **Expected:** Response is in German

---

## Summary

- **Task 1:** Load history in chat endpoint
- **Task 2:** Update legacy router for history
- **Task 3:** Update new router for history
- **Task 4:** Load global context in API
- **Task 5:** Add global context UI
