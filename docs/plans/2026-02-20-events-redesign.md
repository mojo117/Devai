# Events-System Redesign: Server-Persistenz & UX

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Tool-Events serverseitig persistieren und die Event-Darstellung im Chat verbessern (Agent-Labels, Thinking-Merging).

**Architecture:** Events werden als JSONB-Spalte auf `session_messages` gespeichert, beim Session-Laden mit den Messages mitgeliefert, und im Frontend mit Agent-Labels + Thinking-Merging dargestellt.

**Tech Stack:** Supabase (PostgreSQL JSONB), Fastify API, React Frontend

---

## Kontext

### Aktuelles Problem

- Tool-Events leben NUR in `localStorage` (`devai_events_${sessionId}`)
- localStorage hat 5MB-Limit → bei großen Payloads schlägt Write fehl, Events verschwinden
- Kein Cleanup alter Sessions → localStorage füllt sich
- Events überleben keinen Browser-Wechsel / Page-Refresh bei vollem Storage
- Keine Agent-Zuordnung sichtbar im UI
- Consecutive Thinking-Events erzeugen Noise (20+ identische Badges)

### Lösung

1. **Server-Persistenz:** Events werden als `tool_events` JSONB auf `session_messages` gespeichert
2. **Agent-Labels:** Jeder Event-Badge zeigt den Agent-Namen mit farbigem Prefix
3. **Thinking-Merging:** Aufeinanderfolgende Thinking-Events desselben Agents → ein Badge mit Count

---

## Task 1: DB-Migration — `tool_events` Spalte

**Files:**
- Modify: Supabase SQL / Migration

**Step 1:** Spalte hinzufügen

```sql
ALTER TABLE session_messages ADD COLUMN tool_events JSONB DEFAULT NULL;
```

**Step 2:** Verifizieren

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'session_messages' AND column_name = 'tool_events';
```

---

## Task 2: Backend — Events mit Messages speichern

**Files:**
- Modify: `apps/api/src/db/sessionQueries.ts` — INSERT um `tool_events` erweitern
- Modify: `apps/api/src/routes/sessions.ts` — Message-Response um `tool_events` erweitern

**Step 1:** `saveSessionMessage` (oder äquivalent) anpassen:

```typescript
// Beim Speichern einer Assistant-Message die Events mitspeichern
async function saveSessionMessage(
  sessionId: string,
  message: ChatMessage,
  toolEvents?: ToolEvent[]
) {
  await supabase.from('session_messages').insert({
    session_id: sessionId,
    role: message.role,
    content: message.content,
    tool_events: toolEvents ? JSON.stringify(toolEvents) : null,
    // ... existing fields
  });
}
```

**Step 2:** `fetchSessionMessages` Response erweitern:

```typescript
// tool_events aus DB lesen und im Response mitliefern
const { data } = await supabase
  .from('session_messages')
  .select('id, role, content, timestamp, tool_events')
  .eq('session_id', sessionId)
  .order('timestamp', { ascending: true });
```

---

## Task 3: Backend — Stream-Events sammeln und zurückgeben

**Files:**
- Modify: `apps/api/src/agents/router.ts` — Events im processRequest sammeln
- Modify: `apps/api/src/routes/actions.ts` (oder wo der Chat-Endpoint lebt) — Events an die Message-Speicherung übergeben

**Step 1:** Im `processRequest` die Stream-Events in ein Array sammeln:

```typescript
const collectedEvents: ToolEvent[] = [];
const wrappedEmit = (event: AgentStreamEvent) => {
  // Bestehendes emit beibehalten
  emit(event);
  // Zusätzlich sammeln
  if (['status', 'tool_call', 'tool_result', 'agent_thinking'].includes(event.type)) {
    collectedEvents.push(convertToToolEvent(event));
  }
};
```

**Step 2:** `collectedEvents` zusammen mit der Response-Message zurückgeben, damit der Chat-Endpoint sie an `saveSessionMessage` weitergeben kann.

---

## Task 4: Frontend API — `tool_events` im Response verarbeiten

**Files:**
- Modify: `apps/web/src/api.ts` — `fetchSessionMessages` Response-Typ erweitern
- Modify: `apps/web/src/types.ts` — `ChatMessage` Interface erweitern

**Step 1:** `ChatMessage` um optionales `tool_events` Feld erweitern:

```typescript
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  tool_events?: ToolEvent[];  // NEU
}
```

**Step 2:** `sendMultiAgentMessage` Response so anpassen, dass `tool_events` auf der Message landet (falls der Server sie mitliefert).

---

## Task 5: Frontend — `messageToolEvents` aus Server statt localStorage

**Files:**
- Modify: `apps/web/src/components/ChatUI/ChatUI.tsx`
- Modify: `apps/web/src/components/ChatUI/hooks/useChatSession.ts`

**Step 1:** `useChatSession.refreshSessions` erweitern — nach `fetchSessionMessages` die Events aus den Messages extrahieren:

```typescript
const refreshSessions = useCallback(async (selectId?: string | null) => {
  const sessionList = await fetchSessions();
  setSessions(sessionList.sessions);
  const targetId = selectId || sessionList.sessions[0]?.id || null;
  if (targetId) {
    setSessionId(targetId);
    const history = await fetchSessionMessages(targetId);
    setMessages(history.messages);

    // NEU: Events aus Messages extrahieren
    const eventsMap: Record<string, ToolEvent[]> = {};
    for (const msg of history.messages) {
      if (msg.tool_events?.length) {
        eventsMap[msg.id] = msg.tool_events;
      }
    }
    // Callback to set events in ChatUI
    onEventsLoaded?.(eventsMap);
  }
}, [setMessages]);
```

**Step 2:** `ChatUI.tsx` — localStorage-Persistence durch Server-Events ersetzen:

- `useEffect` für localStorage-Write (Zeile 104-112): Entfernen oder als Fallback belassen
- `useEffect` für localStorage-Read (Zeile 114-133): Server-Daten bevorzugen, localStorage als Fallback
- `freezeToolEvents`: Nach dem Freeze auch Events an Server schicken

**Step 3:** Migration-Logik:

```typescript
// Server-Events haben Priorität
if (serverEvents && Object.keys(serverEvents).length > 0) {
  setMessageToolEvents(serverEvents);
  // Alten localStorage-Key aufräumen
  localStorage.removeItem(`devai_events_${sessionId}`);
} else {
  // Fallback: localStorage (für alte Sessions)
  const stored = localStorage.getItem(`devai_events_${sessionId}`);
  if (stored) setMessageToolEvents(JSON.parse(stored));
}
```

---

## Task 6: Frontend — Agent-Labels auf Event-Badges

**Files:**
- Modify: `apps/web/src/components/ChatUI/MessageList.tsx` — `InlineSystemEvent` Component

**Step 1:** Agent-Farbschema definieren:

```typescript
const AGENT_COLORS: Record<string, string> = {
  chapo: 'text-cyan-400',
  devo: 'text-orange-400',
  caio: 'text-blue-400',
  scout: 'text-purple-400',
};

const AGENT_DOT_COLORS: Record<string, string> = {
  chapo: 'bg-cyan-400',
  devo: 'bg-orange-400',
  caio: 'bg-blue-400',
  scout: 'bg-purple-400',
};
```

**Step 2:** `getEventLabel()` anpassen:

```typescript
const getEventLabel = () => {
  const agentPrefix = event.agent ? `${event.agent.toUpperCase()}: ` : '';
  if (event.type === 'thinking') return `${agentPrefix}Thinking`;
  if (event.type === 'status') return `${agentPrefix}${String(event.result || 'Status')}`;
  if (event.type === 'tool_call') return `${agentPrefix}Using: ${event.name || 'tool'}`;
  if (event.type === 'tool_result') return `${agentPrefix}Result: ${event.name || 'tool'}`;
  return `${agentPrefix}${event.type}`;
};
```

**Step 3:** Farbigen Dot vor dem Agent-Label rendern:

```tsx
{event.agent && (
  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${AGENT_DOT_COLORS[event.agent] || 'bg-gray-400'}`} />
)}
```

---

## Task 7: Frontend — Thinking-Event-Merging

**Files:**
- Create: `apps/web/src/components/ChatUI/mergeEvents.ts`
- Modify: `apps/web/src/components/ChatUI/MessageList.tsx`

**Step 1:** Merge-Utility erstellen:

```typescript
export interface MergedToolEvent extends ToolEvent {
  mergedCount?: number;
}

export function mergeConsecutiveThinking(events: ToolEvent[]): MergedToolEvent[] {
  const result: MergedToolEvent[] = [];

  for (const event of events) {
    const last = result[result.length - 1];

    if (
      event.type === 'thinking' &&
      last?.type === 'thinking' &&
      event.agent === last.agent
    ) {
      // Merge: Increment count, keep latest text
      last.mergedCount = (last.mergedCount || 1) + 1;
      last.result = event.result; // Letzter Thinking-Text ist informativster
    } else {
      result.push({ ...event });
    }
  }

  return result;
}
```

**Step 2:** In `MessageList.tsx` das Merging anwenden:

```typescript
const renderToolEventsBlock = (events: ToolEvent[], live: boolean) => {
  const merged = mergeConsecutiveThinking(events);
  return (
    <div className="space-y-1.5">
      {merged.map((event) => (
        <InlineSystemEvent
          key={event.id}
          event={event}
          mergedCount={event.mergedCount}
          // ...
        />
      ))}
    </div>
  );
};
```

**Step 3:** Badge-Label für gemergtes Thinking:

```typescript
if (event.type === 'thinking') {
  const countSuffix = mergedCount && mergedCount > 1 ? ` (${mergedCount}x)` : '';
  return `${agentPrefix}Thinking${countSuffix}`;
}
```

---

## Zusammenfassung

| Task | Was | Bereich |
|------|-----|---------|
| 1 | DB-Migration: `tool_events` JSONB Spalte | DB |
| 2 | Backend: Events mit Messages speichern/laden | API |
| 3 | Backend: Stream-Events sammeln und zurückgeben | API |
| 4 | Frontend API: `tool_events` Response verarbeiten | Frontend |
| 5 | Frontend: Server-Events statt localStorage | Frontend |
| 6 | Frontend: Agent-Labels + Farben | Frontend |
| 7 | Frontend: Thinking-Merging | Frontend |
