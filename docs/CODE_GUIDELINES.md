# DevAI Code Guidelines

> Verbindliche Entwicklungsrichtlinien fuer das DevAI-Projekt.
> Gilt fuer alle Aenderungen in `apps/api/`, `apps/web/` und `shared/`.

**Navigation:** [SOLID](#solid-prinzipien) · [DRY/KISS/YAGNI](#dry--dont-repeat-yourself) · [Separation of Concerns](#trennung-von-verantwortlichkeiten) · [Lesbarkeit](#lesbarkeit-vor-cleverness) · [Funktionen](#kleine-fokussierte-funktionen) · [Architektur](#klare-architektur-und-modulgrenzen) · [Testbarkeit](#testbarkeit) · [Konsistenz](#konsistenz) · [TypeScript](#typescript-konventionen) · [Projekt-Patterns](#devai-spezifische-patterns)

---

## SOLID-Prinzipien

Die fuenf SOLID-Prinzipien sind zentrale Leitlinien der Softwareentwicklung in DevAI.

### Single Responsibility Principle (SRP)

Eine Klasse, ein Modul oder eine Datei sollte **genau eine Verantwortung** haben.

```typescript
// Schlecht: Eine Datei verarbeitet Uploads, speichert in Supabase UND parst Inhalte
async function handleUpload(file: Buffer, name: string) {
  const parsed = await parsePdf(file);           // Parsing
  await supabase.storage.upload(path, file);      // Storage
  await supabase.from('user_files').insert({...}); // DB
}

// Gut: Getrennte Module mit klarer Verantwortung
// fileParser.ts     — Parsing-Logik (parsePdf, parseDocx, parseXlsx)
// userfileService.ts — Upload-Orchestrierung (Validierung + Storage + DB)
// userfileQueries.ts — Datenbankzugriff (insertUserfile, getUserfileById)
```

**DevAI befolgt dieses Prinzip bereits bei:**
- `agents/chapo-loop.ts` (Entscheidungslogik) vs. `agents/conversation-manager.ts` (Token-Verwaltung)
- `tools/registry.ts` (Tool-Definitionen) vs. `tools/executor.ts` (Ausfuehrung)
- `llm/router.ts` (Provider-Routing) vs. `llm/providers/*.ts` (Implementierungen)
- `routes/*.ts` (HTTP-Handling) vs. `services/*.ts` (Geschaeftslogik)

**Faustregel:** Wenn eine Datei mehr als 300 Zeilen hat, pruefe ob sich Verantwortlichkeiten trennen lassen.

### Open/Closed Principle (OCP)

Software sollte **offen fuer Erweiterung**, aber **geschlossen fuer Veraenderung** sein.

```typescript
// Schlecht: Neue LLM-Provider erfordern Aenderungen am Router
if (provider === 'anthropic') { ... }
else if (provider === 'openai') { ... }
else if (provider === 'gemini') { ... }
else if (provider === 'zai') { ... }  // Jeder neue Provider aendert diesen Code

// Gut: Provider-Map — neue Provider werden registriert, nicht eingebaut
// So macht es llm/router.ts:
const providers = new Map<string, LLMProvider>();
providers.set('anthropic', new AnthropicProvider());
providers.set('zai', new ZaiProvider());
// Neuer Provider = neue Datei + eine Zeile Registrierung
```

**DevAI-Beispiele:**
- `tools/executor.ts` nutzt `TOOL_HANDLERS: Record<string, ToolHandler>` statt switch/case
- `llm/router.ts` nutzt eine Provider-Map mit dynamischer Registrierung
- Skill-System: Neue Skills werden als Dateien hinzugefuegt, nicht in bestehendem Code verdrahtet

### Liskov Substitution Principle (LSP)

Abgeleitete Typen muessen sich wie ihre Basistypen verhalten. In TypeScript bedeutet das:

```typescript
// Gut: Alle Parser liefern dasselbe ParseResult-Interface
interface ParseResult {
  content: string | null;
  status: 'parsed' | 'metadata_only' | 'failed';
  error?: string;
}

// parsePdf(), parseDocx(), parseXlsx(), parseText()
// — alle liefern ParseResult, alle sind austauschbar in parseFileContent()
```

Wenn ein neuer Parser hinzukommt, muss er dasselbe `ParseResult`-Interface erfuellen — keine Sonderfaelle, keine zusaetzlichen Felder.

### Interface Segregation Principle (ISP)

Viele kleine, spezialisierte Interfaces sind besser als ein grosses.

```typescript
// Schlecht: Ein "God Interface" fuer alle Tool-Operationen
interface ToolContext {
  fsRead(): Promise<string>;
  fsWrite(): Promise<void>;
  bashExecute(): Promise<string>;
  gitCommit(): Promise<void>;
  sendEmail(): Promise<void>;
  // ...20 weitere Methoden
}

// Gut: Schlanke, fokussierte Interfaces
interface ToolExecutionOptions {
  timeoutMs: number;
  confirmationRequired: boolean;
}

interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
}
```

**DevAI-Beispiel:** Agent-Definitionen nutzen `AgentCapabilities` statt ein monolithisches Agent-Interface. Jeder Agent deklariert nur die Faehigkeiten, die er braucht.

### Dependency Inversion Principle (DIP)

Abhaengigkeiten sollten auf Abstraktionen zeigen, nicht auf konkrete Implementierungen.

```typescript
// Schlecht: Direkte Abhaengigkeit auf konkreten Provider
import { AnthropicProvider } from './providers/anthropic.js';
const response = await new AnthropicProvider().generate(messages);

// Gut: Abhaengigkeit auf Abstraktion
import type { LLMProvider } from './types.js';
async function generate(provider: LLMProvider, messages: Message[]) {
  return provider.generate(messages);
}
```

**DevAI-Muster:**
- `llm/router.ts` arbeitet mit dem `LLMProvider`-Interface, nicht mit konkreten Klassen
- `tools/executor.ts` ruft `ToolHandler`-Funktionen auf, unabhaengig von der Implementierung
- `db/index.ts` exportiert `getSupabase()` als Abstraktion — Consumer wissen nicht, wie der Client konfiguriert ist

---

## DRY — Don't Repeat Yourself

Wiederhole keine Logik. Doppelte Logik fuehrt zu Inkonsistenzen, mehr Wartungsaufwand und Fehleranfaelligkeit.

```typescript
// Schlecht: Gleiche Fehlerbehandlung in jeder Route
app.post('/api/sessions', async (req, reply) => {
  try { ... } catch (err) {
    console.error('Failed:', err);
    reply.status(500).send({ error: err instanceof Error ? err.message : 'Unknown' });
  }
});

// Gut: Fehlerbehandlung als wiederverwendbares Pattern
// DevAI nutzt AgentErrorHandler.safe() fuer alle async Operationen:
const [result, err] = await errorHandler.safe('operation', () => doSomething());
if (err) { /* einheitliche Fehlerbehandlung */ }
```

**Aber Achtung:** Nicht zu frueh abstrahieren. Erst wenn sich ein Muster **mindestens dreimal** klar wiederholt, lohnt sich eine Abstraktion. Drei aehnliche Zeilen sind besser als eine voreilige Hilfsfunktion.

---

## KISS — Keep It Simple, Stupid

Bevorzuge einfache Loesungen. Komplexer Code ist schwer verstaendlich, schwer testbar und fehleranfaelliger.

```typescript
// Schlecht: Ueberkomplizierte Abstraktion fuer eine einfache Aufgabe
class ToolExecutionPipelineFactory {
  static createPipeline(config: PipelineConfig): ExecutionPipeline {
    return new ExecutionPipeline(
      new ValidationStage(config),
      new AuthorizationStage(config),
      new ExecutionStage(config),
      new ResultTransformStage(config),
    );
  }
}

// Gut: Direkte, lesbare Loesung
async function executeTool(name: string, args: unknown): Promise<ToolResult> {
  const handler = TOOL_HANDLERS[name];
  if (!handler) return { success: false, error: 'Unknown tool' };
  return handler(args, context);
}
```

**Leitfrage:** Wenn eine Loesung schwer zu erklaeren ist, ist sie meist zu kompliziert.

---

## YAGNI — You Aren't Gonna Need It

Baue nur das, was **jetzt** gebraucht wird.

**Keine:**
- "Vielleicht brauchen wir spaeter..."-Features
- Uebergenerische Architekturen
- Unnoetige Abstraktionsebenen
- Feature-Flags fuer hypothetische Szenarien
- Rueckwaerts-kompatible Shims fuer nicht-existierende Consumer

```typescript
// Schlecht: Generisches Plugin-System fuer genau einen Use Case
interface PluginHost<T extends Plugin> {
  register(plugin: T): void;
  unregister(id: string): void;
  getPlugin<U extends T>(type: new () => U): U | undefined;
}

// Gut: Direkte Loesung fuer den aktuellen Bedarf
const providers = new Map<string, LLMProvider>();
```

---

## Trennung von Verantwortlichkeiten (Separation of Concerns)

Logik, UI, Datenzugriff und Infrastruktur muessen klar getrennt sein.

### DevAI Layer-Architektur

```
apps/web/                          apps/api/
+-- src/                           +-- src/
    +-- components/  (UI)              +-- routes/      (HTTP/WS Interface)
    +-- hooks/       (State)           +-- services/    (Geschaeftslogik)
    +-- api.ts       (API Client)      +-- agents/      (Agent-Orchestrierung)
    +-- types.ts     (Shared Types)    +-- tools/       (Tool-Ausfuehrung)
                                       +-- db/          (Datenbankzugriff)
                                       +-- llm/         (LLM-Integration)
                                       +-- memory/      (Memory-System)
                                       +-- external/    (Externe APIs)
```

**Regeln:**
- `routes/` darf `services/` aufrufen, aber nie direkt `db/`
- `services/` enthaelt Geschaeftslogik, kein HTTP-Handling
- `db/` kennt keine Geschaeftsregeln — nur CRUD-Operationen
- `agents/` orchestriert, implementiert aber keine Tools selbst
- `tools/` fuehrt aus, trifft aber keine Entscheidungen
- `components/` rendern UI, enthalten keine API-Logik
- `hooks/` verwalten State, machen aber kein direktes HTTP

**Anti-Pattern:**
```typescript
// Schlecht: Route-Handler mit Geschaeftslogik UND Datenbankzugriff
app.post('/api/upload', async (req) => {
  const ext = path.extname(req.body.filename);
  if (!ALLOWED.has(ext)) return { error: 'Not allowed' };  // Validierung
  const parsed = await parsePdf(buffer);                      // Geschaeftslogik
  await supabase.from('user_files').insert({...});            // Datenbankzugriff
});

// Gut: Route delegiert an Service
app.post('/api/upload', async (req) => {
  const result = await uploadUserfileFromBuffer(buffer, name, mimeType);
  if (isUploadError(result)) return reply.status(400).send(result);
  return result;
});
```

---

## Lesbarkeit vor Cleverness

Guter Code ist leicht zu lesen, nicht nur technisch "smart".

### Sprechende Namen

```typescript
// Schlecht
const r = await db.from('uf').select('*').eq('ps', 'f');
const x = r.data?.filter(d => d.mt === 'application/pdf');

// Gut
const failedFiles = await supabase.from('user_files').select('*').eq('parse_status', 'failed');
const pdfFiles = failedFiles.data?.filter(f => f.mime_type === 'application/pdf');
```

### Kein verschachtelter Ternary

```typescript
// Schlecht
const icon = agent === 'chapo' ? '🎯' : agent === 'devo' ? '🔧' : agent === 'scout' ? '🔍' : '🤖';

// Gut
const AGENT_ICONS: Record<AgentName, string> = {
  chapo: '🎯',
  devo: '🔧',
  scout: '🔍',
  caio: '📋',
};
const icon = AGENT_ICONS[agent] ?? '🤖';
```

### Vermeide

- Kryptische Abkuerzungen (`msg` ist ok, `m` oder `d` nicht)
- Uebertrieben verschachtelte Logik (max. 3 Ebenen Einrueckung)
- Unnoetige Optimierungen (Lesbarkeit > Mikro-Performance)
- Clevere Einzeiler, die 30 Sekunden Nachdenken brauchen

---

## Kleine, fokussierte Funktionen

Eine Funktion sollte **nur eine Aufgabe** haben, moeglichst kurz und gut benannt sein.

```typescript
// Schlecht: Eine Funktion macht alles
async function processUpload(file: Buffer, name: string, mime: string) {
  // 80 Zeilen: Validierung, Sanitization, Upload, Parsing, DB-Insert, Fehlerbehandlung
}

// Gut: Aufgeteilt in fokussierte Funktionen
function sanitizeFilename(name: string): string { ... }
async function parsePdf(buffer: Buffer): Promise<ParseResult> { ... }
async function uploadUserfileFromBuffer(buffer: Buffer, name: string, mime: string): Promise<UploadResult> {
  // Orchestriert die Einzelschritte
}
```

**Faustregel:** Wenn du beim Lesen "und dann noch..." denkst, sollte es eine zweite Funktion sein.

**Richtwerte:**
- Funktionen: max. ~50 Zeilen (ohne Kommentare)
- Dateien: max. ~300 Zeilen — darueber hinaus auf SRP pruefen
- Parameter: max. 4-5 — darueber hinaus ein Options-Objekt verwenden

```typescript
// Schlecht: Zu viele Parameter
function createSession(id: string, title: string, userId: string, provider: string, model: string, trust: boolean) { ... }

// Gut: Options-Objekt
interface CreateSessionOptions {
  id: string;
  title: string;
  userId: string;
  provider: string;
  model: string;
  trustMode: boolean;
}
function createSession(options: CreateSessionOptions) { ... }
```

---

## Klare Architektur und Modulgrenzen

### Abhaengigkeitsrichtung

```
routes/ --> services/ --> db/
              |
              +--> agents/ --> tools/
              |               |
              |               +--> llm/
              |
              +--> memory/
```

**Regeln:**
- Abhaengigkeiten fliessen nur **nach unten** (routes → services → db)
- **Keine zyklischen Abhaengigkeiten** — wenn A von B importiert, darf B nicht von A importieren
- Shared Types (`types.ts`, `@devai/shared`) sind die Ausnahme — sie werden auf allen Ebenen genutzt
- Neue Module muessen sich in die bestehende Hierarchie einfuegen

### Import-Regeln

```typescript
// Innerhalb eines Moduls: relative Importe mit .js Extension
import { parseFileContent } from './fileParser.js';
import { getSupabase } from '../db/index.js';

// Shared Types: via Package-Alias
import type { ActionStatus, ToolName } from '@devai/shared';

// Schwere Abhaengigkeiten: Dynamic Import (Lazy Loading)
const { PDFParse } = await import('pdf-parse');
const mammoth = await import('mammoth');
```

---

## Testbarkeit

Code sollte leicht testbar sein. DevAI nutzt **Vitest** fuer API-Tests.

### Testbarer Code

```typescript
// Schlecht: Nicht testbar — direkte Abhaengigkeit auf globalen State
async function getUser() {
  const supabase = createClient(process.env.URL!, process.env.KEY!);
  return supabase.from('users').select('*');
}

// Gut: Testbar — Abhaengigkeit wird injiziert
async function getUser(db: SupabaseClient) {
  return db.from('users').select('*');
}
// Oder via Modul-Export (wie DevAI es macht):
import { getSupabase } from '../db/index.js';
async function getUser() {
  return getSupabase().from('users').select('*');
}
```

### Prinzipien fuer Testbarkeit

- **Geringe Kopplung:** Module kommunizieren ueber Interfaces, nicht ueber Implementierungsdetails
- **Dependency Injection:** Schwere Abhaengigkeiten (DB, LLM, externe APIs) sind austauschbar
- **Reine Funktionen wo moeglich:** `sanitizeFilename()`, `stripNullBytes()`, `truncate()` — deterministisch, keine Seiteneffekte
- **Discriminated Unions fuer Ergebnisse:** `ParseResult`, `UploadResult | UploadError` — einfach assertbar

### Teststruktur

```
apps/api/
+-- src/
|   +-- services/fileParser.ts
+-- tests/
    +-- services/fileParser.test.ts
```

---

## Konsistenz

Ein Projekt muss in allen Bereichen konsistent sein. Konsistenz ist **wichtiger als "die perfekte Loesung"**.

### Namensgebung

| Bereich | Konvention | Beispiel |
|---------|------------|----------|
| **Dateien** | `camelCase.ts` | `fileParser.ts`, `userfileService.ts` |
| **React Components** | `PascalCase.tsx` | `ChatUI.tsx`, `AgentStatus.tsx` |
| **React Hooks** | `use[Feature].ts` | `useAuth.ts`, `useChatSession.ts` |
| **Interfaces** | `PascalCase` | `ParseResult`, `UploadError`, `UserfileRow` |
| **Type Aliases** | `PascalCase` | `AgentName`, `AgentPhase`, `ToolName` |
| **Funktionen** | `camelCase` | `parseFileContent()`, `getUserfileById()` |
| **Konstanten** | `UPPER_SNAKE_CASE` | `MAX_FILE_SIZE`, `STORAGE_BUCKET` |
| **DB Queries** | `verb + Entity` | `insertUserfile()`, `listUserfiles()`, `deleteExpiredUserfiles()` |
| **Tool-Namen** | `snake_case` | `fs_readFile`, `git_status`, `web_search` |
| **Event-Typen** | `snake_case` | `tool_call`, `agent_start`, `message_queued` |

### Ordnerstruktur

Neue Dateien gehoeren in die bestehende Struktur:

| Was | Wohin |
|-----|-------|
| Neuer API-Endpunkt | `apps/api/src/routes/` |
| Neue Geschaeftslogik | `apps/api/src/services/` |
| Neue DB-Queries | `apps/api/src/db/` |
| Neues Tool | `apps/api/src/tools/` + Registrierung in `registry.ts` |
| Neuer LLM-Provider | `apps/api/src/llm/providers/` + Registrierung in `router.ts` |
| Neue React-Komponente | `apps/web/src/components/` |
| Neuer React-Hook | `apps/web/src/hooks/` |
| Shared Types | `shared/src/` |

### Fehlerbehandlung

```typescript
// Konsistentes Pattern in Services:
async function doSomething(): Promise<Result | null> {
  const { data, error } = await getSupabase().from('table').select('*');
  if (error) {
    console.error('Failed to do something:', error);
    return null;
  }
  return data as Result;
}

// Konsistentes Pattern in Agents (Tuple-Style):
const [result, err] = await errorHandler.safe('operation', () => riskyCall());
if (err) {
  conversation.addMessage({ role: 'assistant', content: errorHandler.formatForLLM(err) });
  continue;
}
```

### Logging

```typescript
// Format: [Modul] Nachricht mit Kontext
console.log('[ChatGW] Client registered for session', sessionId);
console.error('[WS] Failed to send event:', err);
console.warn('[db] devai_memories table not found:', error.message);
console.info('[mcp:serena] Connected');
```

### Code Style

- **Semikolons:** Ja (Projekt-Standard ist mit Semikolon)
- **Quotes:** Single Quotes (`'text'`)
- **Trailing Commas:** Ja
- **Indentation:** 2 Spaces
- **Max Line Length:** Kein hartes Limit, aber ~120 Zeichen bevorzugt
- **Imports:** ESM mit `.js`-Extension, Type-Imports mit `import type`

```typescript
// Korrekt:
import { useState, useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { fetchSessions, createSession } from '../../../api'
import type { ChatMessage, SessionSummary } from '../../../types'
```

---

## TypeScript-Konventionen

### Kein `any`

**Niemals `any` verwenden.** Definiere stattdessen passende Interfaces.

```typescript
// Verboten
const items = response.data.map((d: any) => d.name)

// Richtig
interface ItemDocument {
  $id: string
  name: string
  status: 'active' | 'inactive'
}
const items = (response.data as ItemDocument[]).map((d) => d.name)
```

### Discriminated Unions statt Optionals

```typescript
// Gut: Klar unterscheidbare Ergebnis-Typen
interface UploadResult {
  success: true
  file: { id: string; filename: string }
}

interface UploadError {
  success: false
  error: string
}

// Mit Type Guard
function isUploadError(result: UploadResult | UploadError): result is UploadError {
  return !result.success && 'error' in result
}
```

### Strict Mode

Beide Apps laufen mit `"strict": true` in der `tsconfig.json`. Das bedeutet:
- `strictNullChecks` — `null` und `undefined` muessen explizit behandelt werden
- `noImplicitAny` — Typen muessen deklariert werden
- `strictFunctionTypes` — Funktionsparameter werden strikt geprueft

Zusaetzlich in `apps/web`:
- `noUnusedLocals` — Keine ungenutzten Variablen
- `noUnusedParameters` — Keine ungenutzten Parameter
- `noFallthroughCasesInSwitch` — Switch-Cases brauchen `break`/`return`

### Type-Only Imports

```typescript
// Wenn nur der Typ gebraucht wird:
import type { AgentName, AgentPhase } from '../AgentStatus'

// Gemischt:
import { useState, useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
```

---

## DevAI-spezifische Patterns

### Error-Feed-Back Pattern (Agents)

Fehler crashen **nie** die Konversation. Sie werden als Kontext zurueckgefuehrt:

```typescript
const [result, err] = await this.errorHandler.safe('llm_call', () =>
  llmRouter.generateWithFallback(messages, tools)
)

if (err) {
  // Fehler wird Teil der Konversation — CHAPO entscheidet, was als Naechstes passiert
  this.conversation.addMessage({
    role: 'assistant',
    content: this.errorHandler.formatForLLM(err),
  })
  continue // Naechste Iteration
}
```

### Trust the Model

Keine Code-Validatoren fuer Dinge, die das LLM ueber seinen Prompt steuern kann:

```typescript
// Schlecht: Coded Guardrails fuer LLM-Verhalten
if (response.includes('DELETE') && !userApproved) {
  return 'Cannot delete without approval'
}

// Gut: Im Prompt definieren, nicht im Code erzwingen
// CHAPO_SYSTEM_PROMPT enthaelt die Regeln — das Modell haelt sich daran
// Code-Checks nur fuer Dinge ausserhalb der Modell-Kontrolle:
if (tokenCount > MAX_TOKENS) { /* Token-Limit ist technisch, nicht verhaltensbezogen */ }
```

### Dynamic Imports fuer schwere Abhaengigkeiten

```typescript
// Gut: Schwere Bibliotheken nur laden wenn benoetigt
async function parsePdf(buffer: Buffer): Promise<ParseResult> {
  const { PDFParse } = await import('pdf-parse')
  // ...
}

async function parseDocx(buffer: Buffer): Promise<ParseResult> {
  const mammoth = await import('mammoth')
  // ...
}
```

### Hook-Pattern (React)

```typescript
// Konsistenter Aufbau:
interface UseChatSessionOptions {
  sessionCommand?: ChatSessionCommandEnvelope | null
  onSessionStateChange?: (state: ChatSessionState) => void
  messages: ChatMessage[]
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>
}

export function useChatSession(options: UseChatSessionOptions) {
  // 1. State
  const [sessionId, setSessionId] = useState<string | null>(null)

  // 2. Callbacks (useCallback mit Dependency Arrays)
  const refreshSessions = useCallback(async () => { ... }, [deps])

  // 3. Effects (useEffect mit Cleanup)
  useEffect(() => {
    let isMounted = true
    // ...
    return () => { isMounted = false }
  }, [deps])

  // 4. Return-Objekt
  return { sessionId, sessions, refreshSessions }
}
```

### Supabase Query Pattern

```typescript
// Standard-Pattern fuer DB-Queries:
export async function getUserfileById(id: string): Promise<UserfileRow | null> {
  const { data, error } = await getSupabase()
    .from('user_files')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null  // Not found
    console.error('Failed to get userfile:', error)
    return null
  }

  return data as UserfileRow
}
```

---

## Checkliste vor jedem Commit

- [ ] Keine `any`-Typen eingefuehrt
- [ ] Keine zyklischen Abhaengigkeiten erzeugt
- [ ] Neue Dateien in die bestehende Ordnerstruktur eingeordnet
- [ ] Funktionen kurz und fokussiert (max. ~50 Zeilen)
- [ ] Fehlerbehandlung konsistent mit bestehendem Code
- [ ] Naming Conventions eingehalten (siehe Tabelle oben)
- [ ] Keine unnoetige Komplexitaet hinzugefuegt (KISS/YAGNI)
- [ ] Duplizierte Logik vermieden oder bewusst akzeptiert (DRY, aber nicht voreilig)
- [ ] TypeScript `strict` laeuft ohne Fehler
- [ ] ESM-Importe mit `.js`-Extension (im API-Code)
