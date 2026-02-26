# Parallel CHAPO Loops

## Problem

CHAPO verarbeitet User-Nachrichten strikt seriell. Wenn CHAPO an einem Task arbeitet und der User eine neue Nachricht sendet, wird diese in eine Inbox-Queue gelegt und erst nach Abschluss des laufenden Loops verarbeitet. Der User muss warten.

## Ziel

Der User soll CHAPO mehrere Aufgaben gleichzeitig geben koennen. Neue Nachrichten starten sofort einen neuen parallelen Loop — ohne den laufenden zu unterbrechen. Beide Loops sehen live was der andere tut.

Ein `/mode` Toggle wechselt zwischen paralleler und serieller Verarbeitung (Status Quo). Default ist serial fuer Stabilitaet waehrend der Entwicklung.

## Design

### User-Verhalten

| Aktion | Serial Mode (Default) | Parallel Mode |
|--------|----------------------|---------------|
| Nachricht senden, kein Loop aktiv | Normaler Loop-Start | Normaler Loop-Start |
| Nachricht senden, Loop laeuft | Inbox-Queue (Status Quo) | Sofort neuer Loop parallel |
| `/stop` | Aktuellen Loop abbrechen | Alle Loops abbrechen |
| `/mode` | Wechselt zu Parallel | Wechselt zu Serial |

### Parallel-Context-Buffer

Kernidee: Jeder Loop registriert seine Actions in einem geteilten Buffer. Bei jeder LLM-Iteration wird der Buffer der **anderen** Loops als System-Message injiziert. Template-basiert, kein extra LLM-Call.

#### Datenstruktur

```typescript
interface ParallelLoopEntry {
  turnId: string;
  taskLabel: string;           // Kurzer Name, z.B. "Bug in auth.ts"
  originalPrompt: string;      // Der volle User-Prompt der den Loop gestartet hat
  status: 'running' | 'completed' | 'aborted';
  finalAnswer?: string;        // Wenn completed: die Antwort (gekuerzt)
  actions: Array<{
    iteration: number;
    tool: string;              // "fs_readFile" | "delegateToDevo" | "DEVO result"
    summary: string;           // "auth.ts gelesen (45 Zeilen)"
  }>;
}
```

#### Injection-Template

Bei jeder Iteration bekommt CHAPO eine System-Message mit dem Kontext aller anderen Loops:

```
[Parallel Context — 1 other loop active]

Loop "Bug in auth.ts" (User: "Fix den null check in auth.ts, der crasht bei leeren tokens"):
  Status: running
  - delegateToDevo("Fix null check in validateToken") → laeuft
  - DEVO result: success, auth.ts Zeile 42 gefixt
  - fs_readFile(auth.test.ts) → gelesen

[Hinweis: Vermeide Konflikte mit Dateien die andere Loops bearbeiten.]
```

Das gibt jedem Loop:
- Den Original-Prompt des anderen (versteht WARUM der andere arbeitet)
- Live-Action-Log (versteht WAS der andere gerade tut)
- File-Awareness (vermeidet Write-Konflikte)

#### Detail-Level

Jede Action wird als **Tool + 1-Zeiler Summary** geschrieben. Nicht die vollen Tool-Results, aber genug um zu verstehen was passiert ist. Beispiele:

- `fs_readFile(auth.ts)` → `"auth.ts gelesen (45 Zeilen)"`
- `delegateToDevo("Fix null check")` → `"DEVO laeuft: Fix null check in validateToken"`
- DEVO Result → `"DEVO fertig: success, auth.ts Zeile 42 gefixt"`
- `web_search("react 19 breaking changes")` → `"3 Ergebnisse gefunden"`

### Loop-Lifecycle

```
User sendet Nachricht (Parallel Mode, Loop 1 laeuft)
│
├─ commandHandlers.handleRequest()
│  ├─ sessionMode === 'parallel'?
│  ├─ Ja → neuen turnId generieren
│  ├─ history = getMessages(sessionId)        ← DB-History (inkl. Loop 1's bisherige Ausgaben)
│  └─ processRequest(sessionId, message, history, turnId)
│
├─ ChapoLoop.run(message, history, turnId)
│  ├─ registerParallelLoop(sessionId, turnId, { taskLabel, originalPrompt })
│  ├─ Iteration 0:
│  │  ├─ parallelContext = getOtherLoopContexts(sessionId, turnId)
│  │  ├─ injectParallelContext(parallelContext)   ← System-Message
│  │  ├─ LLM Call
│  │  ├─ Tool execution
│  │  └─ appendAction(sessionId, turnId, { tool, summary })
│  ├─ Iteration 1: (gleicher Zyklus)
│  └─ ...
│
├─ Loop 2 antwortet
│  ├─ updateLoopStatus(sessionId, turnId, 'completed', finalAnswer)
│  └─ Loop 1 sieht bei naechster Iteration: "Loop 2 completed: ..."
│
└─ Loop 1 antwortet spaeter
   └─ updateLoopStatus(sessionId, turnId, 'completed', finalAnswer)
```

### Wenn ein Loop antwortet

- Antwort wird im Chat angezeigt (mit Task-Label wenn >1 Loop parallel lief)
- Loop-Entry im Buffer wechselt auf `status: 'completed'` mit `finalAnswer`
- Andere laufende Loops sehen bei naechster Iteration: Task X ist fertig, Ergebnis: ...
- Completed Entries bleiben im Buffer bis alle Loops der Session fertig sind

### Naechste User-Nachricht nach Antwort

- **Parallel Mode, anderer Loop laeuft noch:** Neuer Loop 3 startet, sieht Loop 2's Live-Actions + Loop 1's Ergebnis in DB-History
- **Serial Mode:** Inbox-Queue, wartet bis laufender Loop fertig ist (Status Quo)

### Messages sofort persistieren

Aktuell schreibt der Loop Messages erst am Ende in die DB. Fuer Parallel-Loops muss jede Message **sofort** in die DB geschrieben werden, damit ein neuer Loop beim Start den aktuellen Stand sieht.

### `/stop` Command

- Neuer Command-Typ: `stop_all_loops`
- Iteriert ueber alle aktiven turnIds der Session
- AbortController.abort() auf jeden laufenden LLM-Call
- Laufende Delegationen bekommen Timeout/Abort-Signal
- Alle Loop-Entries werden auf `status: 'aborted'` gesetzt

### `/mode` Toggle

- Neuer Command-Typ: `toggle_mode`
- Wechselt `sessionMode` zwischen `'serial'` und `'parallel'`
- Emitiert Event an Frontend: `{ type: 'mode_changed', mode: 'parallel' | 'serial' }`
- Frontend zeigt kurze Bestaetigung: "Parallel Mode aktiviert" / "Serial Mode aktiviert"

### Task-Labels

Jeder Loop braucht ein kurzes Label fuer die Chat-Darstellung. Ableitung:
1. Wenn CHAPO `chapo_plan_set` aufruft → Plan-Titel als Label
2. Fallback: Erste ~8 Woerter des User-Prompts

## Aenderungen

### Backend

| Datei | Aenderung |
|-------|-----------|
| `agents/state-manager/sessionState.ts` | `activeLoops: Map<sessionId, Map<turnId, ParallelLoopEntry>>`, `sessionMode` pro Session, Helper-Funktionen: `registerParallelLoop`, `appendAction`, `getOtherLoopContexts`, `updateLoopStatus` |
| `workflow/commands/commandHandlers.ts` | Wenn `parallel` + Loop aktiv → neuen Loop starten statt Inbox-Queue. Drain-Inbox bleibt fuer Serial Mode |
| `agents/chapo-loop.ts` | (1) Actions in Buffer schreiben nach jedem Tool-Call, (2) Parallel-Context bei jeder Iteration injizieren, (3) Messages sofort in DB persistieren, (4) turnId + taskLabel auf allen Events |
| `workflow/commands/dispatcher.ts` | `/stop` + `/mode` Command-Typen registrieren und routen |
| `agents/chapo-loop/contextManager.ts` | `buildParallelContextMessage()` — Template-basierte System-Message aus Buffer |

### Frontend

| Datei | Aenderung |
|-------|-----------|
| `components/ChatUI/ChatUI.tsx` | (1) Input immer aktiv (kein Disable bei laufendem Loop), (2) `/stop` + `/mode` Commands erkennen und senden, (3) Mode-Indicator in der UI |
| `components/ChatUI/MessageList.tsx` | Task-Labels anzeigen wenn >1 Loop parallel lief/laeuft |
| Stream-Events | `turnId` + `taskLabel` Felder auf allen Events auswerten |

### Nicht betroffen

- DEVO, SCOUT, CAIO — keine Aenderungen, die werden weiterhin normal delegiert
- Tool-Registry — keine Aenderungen
- LLM-Router — keine Aenderungen
- Conversation-Manager — keine Aenderungen (jeder Loop hat seinen eigenen)

## Risiken

| Risiko | Mitigation |
|--------|-----------|
| File-Write-Konflikte (2x DEVO auf gleicher Datei) | Parallel-Context zeigt welche Dateien der andere Loop bearbeitet. CHAPO-Prompt enthaelt Hinweis Konflikte zu vermeiden |
| Token-Budget bei vielen parallelen Actions | Action-Summaries sind kompakt (~20 Tokens/Action). Bei >50 Actions pro Loop: aelteste trimmen |
| Race Condition beim Session-State | `activeLoops` Map mit turnId-Keys verhindert Kollisionen. Jeder Loop arbeitet auf eigenem turnId |
| Memory-Leak bei vielen Loops | Completed/Aborted Entries werden nach 5 Minuten aus dem Buffer entfernt |

## Testplan

1. **Serial Mode (Regression):** Alles funktioniert wie bisher
2. **`/mode` Toggle:** Wechselt korrekt, zeigt Bestaetigung
3. **Parallel — 2 Loops:** User sendet 2 Nachrichten schnell hintereinander, beide Loops laufen, beide antworten
4. **Parallel-Context:** Loop 2 sieht Loop 1's Actions im System-Prompt
5. **Loop-Completion:** Wenn Loop 1 fertig ist, sieht Loop 2 das Ergebnis
6. **`/stop`:** Beide Loops werden abgebrochen
7. **Labels:** Chat zeigt Task-Labels wenn >1 Loop parallel lief
