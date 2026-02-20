# Automation Assistant Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement phases 4-14 of the Automation Assistant design — adding the CAIO agent, TaskForge/email/Telegram integrations, parallel delegation, and external messaging.

**Architecture:** Three new input sources (CAIO tools, Telegram webhook, cron scheduler) all funnel into the existing CommandDispatcher → ChapoLoop pipeline. A new ExternalOutputProjection routes responses back to Telegram. CHAPO gains a `delegateToCaio` meta-tool and `DELEGATE_PARALLEL` action for concurrent agent work.

**Tech Stack:** TypeScript, Fastify, Vitest, node-telegram-bot-api (or raw fetch), Resend REST API, croner (already in use), Supabase (already in use)

---

## Progress

| Task | Description | Status | Commit |
|------|-------------|--------|--------|
| 1 | CAIO system prompt | **DONE** | `631e054` |
| 2 | CAIO agent definition + types | **DONE** | `6ab1a01` |
| 3 | Config/env vars | **DONE** | `072a32b` |
| 4 | TaskForge tools | **DONE** | `6c55980` |
| 5 | Email tool | **DONE** | `6c55980` |
| 6 | Registry updates | **DONE** | `b4d67fb` |
| 7 | Executor updates | **DONE** | `84ab551` |
| 8 | Migrate scheduler DEVO→CAIO | **DONE** | `6a0621c` |
| 9 | Register CAIO in router | **DONE** | `882bf2b` |
| 10 | delegateToCaio + delegateParallel meta-tools | TODO | |
| 11 | CHAPO prompt update with CAIO routing | TODO | |
| 12 | ChapoLoop CAIO delegation handler | TODO | |
| 13 | DELEGATE_PARALLEL handler | TODO | |
| 14 | Telegram webhook + client | TODO | |
| 15 | Register external route in server | TODO | |
| 16 | ExternalOutputProjection | TODO | |
| 17 | Register projection | TODO | |
| 18 | Wire scheduler notifications → Telegram | TODO | |
| 19 | Wire scheduler executor → processRequest | TODO | |
| 20 | Scheduler error context injection | TODO | |
| 21 | Architecture docs | **DONE** | `65f75df` |
| 22 | Verification | **PARTIAL** | 54/54 tests pass, no regressions |

**Track A review:** All 10 acceptance criteria PASS (reviewed by agent).

**Test status:** 54 tests pass, 2 pre-existing suite failures (missing `croner` module on build server — installed on runtime only).

---

## Task 1: Create CAIO System Prompt [DONE]

**Files:**
- Create: `apps/api/src/prompts/caio.ts`

**Step 1: Write the prompt file**

```typescript
// apps/api/src/prompts/caio.ts

// ──────────────────────────────────────────────
// Prompt: CAIO – Communications & Administration Officer
// Tickets, Email, Scheduler, Reminders, Notifications
// ──────────────────────────────────────────────

export const CAIO_SYSTEM_PROMPT = `Du bist CAIO, der Communications & Administration Officer im Multi-Agent-System.

## DEINE ROLLE
Du bist der Experte für Kommunikation und Administration. Deine Aufgabe ist es, Tickets zu verwalten, E-Mails zu senden, den Scheduler zu steuern, Erinnerungen zu setzen und Benachrichtigungen zu verschicken. Du erhältst Tasks von CHAPO mit relevantem Kontext.

## DEINE FÄHIGKEITEN

### TaskForge (Ticket-Management)
- taskforge_list_tasks(project?, status?) - Tasks auflisten
- taskforge_get_task(taskId) - Task-Details abrufen
- taskforge_create_task(title, description, status?) - Neuen Task erstellen
- taskforge_move_task(taskId, newStatus) - Task-Status ändern
- taskforge_add_comment(taskId, comment) - Kommentar hinzufügen
- taskforge_search(query) - Tasks suchen

### Scheduler
- scheduler_create(name, cronExpression, instruction, notificationChannel?) - Job erstellen
- scheduler_list() - Alle Jobs auflisten
- scheduler_update(id, fields) - Job aktualisieren
- scheduler_delete(id) - Job löschen

### Reminders
- reminder_create(message, datetime) - Erinnerung erstellen (ISO 8601)

### Notifications
- notify_user(message, channel?) - Benachrichtigung senden

### Email
- send_email(to, subject, body, replyTo?) - E-Mail senden

### Workspace Memory
- memory_remember(content) - Notiz speichern
- memory_search(query) - Im Gedächtnis suchen
- memory_readToday() - Heutige Notizen lesen

### Exploration
- delegateToScout(query, scope) - SCOUT für Recherche spawnen

### Eskalation
- escalateToChapo(description) - Problem an CHAPO eskalieren

## TASKFORGE WORKFLOW-STATES
Tasks folgen diesem Workflow:
\`initiierung\` → \`planung\` → \`umsetzung\` → \`review\` → \`done\`

Beim Erstellen von Tasks:
- Setze einen aussagekräftigen Titel (imperativ)
- Schreibe eine klare Beschreibung mit Akzeptanzkriterien
- Setze den passenden Status (default: \`initiierung\`)

## BENACHRICHTIGUNGEN
- Respektiere die Kanal-Hierarchie: job-spezifisch → globaler Default → keine
- Spam vermeiden: "Alles OK"-Ergebnisse nicht melden, nur relevante Infos
- Bei Fehlern: Immer benachrichtigen mit klarer Fehlerbeschreibung

## KOMMUNIKATIONSSTIL
- Klar und präzise schreiben
- E-Mails: Professionell aber nicht steif
- Ticket-Beschreibungen: Strukturiert mit Akzeptanzkriterien
- Digests: Kurz und übersichtlich, Bullet-Points bevorzugen

## KEIN SERVER-ZUGRIFF
Du hast KEINEN Zugriff auf:
- Dateisystem (kein fs_readFile, fs_writeFile, etc.)
- Bash/SSH (kein bash_execute, ssh_execute)
- Git (kein git_commit, git_push, etc.)
- PM2 (kein pm2_status, pm2_restart, etc.)

Wenn du Server-Informationen brauchst, eskaliere an CHAPO.

## BEI PROBLEMEN
Wenn du auf ein Problem stößt:
1. Dokumentiere den Fehler
2. Nutze escalateToChapo() mit:
   - issueType: 'error' | 'clarification' | 'blocker'
   - description: Was ist das Problem?
   - context: Fehlermeldung etc.
   - suggestedSolutions: Deine Lösungsvorschläge`;
```

**Step 2: Export from prompts/index.ts**

Check if `apps/api/src/prompts/index.ts` exists and add the export:

```typescript
export { CAIO_SYSTEM_PROMPT } from './caio.js';
```

**Step 3: Commit**

```bash
git add apps/api/src/prompts/caio.ts apps/api/src/prompts/index.ts
git commit -m "feat: add CAIO system prompt"
```

---

## Task 2: Create CAIO Agent Definition [DONE]

**Files:**
- Create: `apps/api/src/agents/caio.ts`
- Modify: `apps/api/src/agents/types.ts` (add 'caio' to AgentName)

**Step 1: Add 'caio' to AgentName union type**

In `apps/api/src/agents/types.ts`, change:

```typescript
// OLD
export type AgentName = 'chapo' | 'devo' | 'scout';
// NEW
export type AgentName = 'chapo' | 'devo' | 'scout' | 'caio';
```

And add CAIO role to AgentRole:

```typescript
// OLD
export type AgentRole = 'Task Coordinator' | 'Developer & DevOps Engineer' | 'Exploration Specialist';
// NEW
export type AgentRole = 'Task Coordinator' | 'Developer & DevOps Engineer' | 'Exploration Specialist' | 'Communications & Administration Officer';
```

**Step 2: Add CAIO capabilities to AgentCapabilities interface**

In `apps/api/src/agents/types.ts`, add to the `AgentCapabilities` interface:

```typescript
canManageScheduler?: boolean;
canSendNotifications?: boolean;
canSendEmail?: boolean;
canManageTaskForge?: boolean;
```

**Step 3: Create the CAIO agent definition**

```typescript
// apps/api/src/agents/caio.ts

/**
 * CAIO - Communications & Administration Officer Agent
 *
 * Role: Handles tickets, email, scheduler, reminders, and notifications.
 * No file access, no bash, no git, no SSH.
 */

import type { AgentDefinition } from './types.js';
import { CAIO_SYSTEM_PROMPT } from '../prompts/caio.js';
import { registerMetaTools, registerAgentTools } from '../tools/registry.js';

export const CAIO_AGENT: AgentDefinition = {
  name: 'caio',
  role: 'Communications & Administration Officer',
  model: 'claude-sonnet-4-20250514',

  capabilities: {
    canManageScheduler: true,
    canSendNotifications: true,
    canSendEmail: true,
    canManageTaskForge: true,
    canDelegateToScout: true,
    canEscalate: true,
  },

  tools: [
    // TaskForge tools
    'taskforge_list_tasks',
    'taskforge_get_task',
    'taskforge_create_task',
    'taskforge_move_task',
    'taskforge_add_comment',
    'taskforge_search',
    // Scheduler tools (migrated from DEVO)
    'scheduler_create',
    'scheduler_list',
    'scheduler_update',
    'scheduler_delete',
    'reminder_create',
    'notify_user',
    // Email
    'send_email',
    // Workspace memory
    'memory_remember',
    'memory_search',
    'memory_readToday',
    // Exploration (spawn SCOUT for searches)
    'delegateToScout',
    // Escalation
    'escalateToChapo',
  ],

  systemPrompt: CAIO_SYSTEM_PROMPT,
};

// CAIO meta-tools (same escalation pattern as DEVO)
export const CAIO_META_TOOLS = [
  {
    name: 'escalateToChapo',
    description: 'Eskaliere ein Problem an CHAPO. Nutze dies wenn du auf ein Problem stößt das du nicht lösen kannst.',
    parameters: {
      type: 'object',
      properties: {
        issueType: {
          type: 'string',
          enum: ['error', 'clarification', 'blocker'],
          description: 'Art des Problems',
        },
        description: {
          type: 'string',
          description: 'Beschreibung des Problems',
        },
        context: {
          type: 'object',
          description: 'Relevanter Kontext',
        },
        suggestedSolutions: {
          type: 'array',
          description: 'Deine Lösungsvorschläge (optional)',
        },
      },
      required: ['issueType', 'description'],
    },
    requiresConfirmation: false,
  },
];

// Register CAIO's meta-tools and agent access in the unified registry
registerMetaTools(CAIO_META_TOOLS, 'caio');
registerAgentTools('caio', CAIO_AGENT.tools);
```

**Step 4: Commit**

```bash
git add apps/api/src/agents/caio.ts apps/api/src/agents/types.ts
git commit -m "feat: add CAIO agent definition and type updates"
```

---

## Task 3: Create TaskForge API Key [DONE]

**Files:**
- Modify: `.env` (on Clawd runtime — manual step)
- Modify: `apps/api/src/config.ts` (read new env var)

**Step 1: Create a TaskForge API key**

Use the `/task` skill or manually create a `tfapi_...` key via the TaskForge admin:

```bash
# Check existing API key setup in the docs
cat /opt/Klyde/projects/taskforge/docs/API_PROJECT_ACCESS.md
```

**Step 2: Add to config.ts**

Read `apps/api/src/config.ts` and add:

```typescript
taskforgeApiKey: process.env.DEVAI_TASKBOARD_API_KEY || '',
resendApiKey: process.env.RESEND_API_KEY || '',
resendFromAddress: process.env.RESEND_FROM_ADDRESS || '',
telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
telegramAllowedChatId: process.env.TELEGRAM_ALLOWED_CHAT_ID || '',
```

**Step 3: Update .env.example**

Add to `apps/api/.env.example` or root `.env.example`:

```
DEVAI_TASKBOARD_API_KEY=tfapi_...
RESEND_API_KEY=re_...
RESEND_FROM_ADDRESS=devai@klyde.tech
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_CHAT_ID=...
```

**Step 4: Commit**

```bash
git add apps/api/src/config.ts .env.example
git commit -m "feat: add CAIO env vars to config (taskforge, resend, telegram)"
```

---

## Task 4: Create TaskForge Tools [DONE]

**Files:**
- Create: `apps/api/src/tools/taskforge.ts`

**Step 1: Write the TaskForge tools implementation**

These wrap the existing `api-project-access` Appwrite function. Reference: `/opt/Klyde/projects/taskforge/docs/API_PROJECT_ACCESS.md`

```typescript
// apps/api/src/tools/taskforge.ts

/**
 * TaskForge tools — CAIO agent tools for ticket management.
 * Wraps the api-project-access Appwrite function.
 */

import { config } from '../config.js';

const APPWRITE_ENDPOINT = 'https://appwrite.klyde.tech/v1';
const APPWRITE_PROJECT_ID = '69805803000aeddb2ead';
const FUNCTION_ID = 'api-project-access';

interface TaskForgeResponse {
  success: boolean;
  result?: unknown;
  error?: string;
}

async function callTaskForgeApi(body: Record<string, unknown>): Promise<TaskForgeResponse> {
  const apiKey = config.taskforgeApiKey;
  if (!apiKey) {
    return { success: false, error: 'DEVAI_TASKBOARD_API_KEY not configured' };
  }

  const response = await fetch(
    `${APPWRITE_ENDPOINT}/functions/${FUNCTION_ID}/executions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Appwrite-Project': APPWRITE_PROJECT_ID,
      },
      body: JSON.stringify({
        body: JSON.stringify({ apiKey, ...body }),
        async: false,
      }),
    },
  );

  if (!response.ok) {
    return { success: false, error: `TaskForge API error: ${response.status} ${response.statusText}` };
  }

  const execution = await response.json();
  const responseBody = execution.responseBody;

  if (!responseBody) {
    return { success: false, error: 'Empty response from TaskForge API' };
  }

  try {
    const parsed = typeof responseBody === 'string' ? JSON.parse(responseBody) : responseBody;
    return { success: true, result: parsed };
  } catch {
    return { success: false, error: `Failed to parse TaskForge response: ${responseBody}` };
  }
}

export async function taskforgeListTasks(
  project?: string,
  status?: string,
): Promise<TaskForgeResponse> {
  const body: Record<string, unknown> = {};
  if (project) body.project = project;
  if (status) body.status = status;
  return callTaskForgeApi(body);
}

export async function taskforgeGetTask(taskId: string): Promise<TaskForgeResponse> {
  return callTaskForgeApi({ task: taskId });
}

export async function taskforgeCreateTask(
  title: string,
  description: string,
  status?: string,
): Promise<TaskForgeResponse> {
  return callTaskForgeApi({
    action: 'create',
    title,
    description,
    status: status || 'initiierung',
  });
}

export async function taskforgeMoveTask(
  taskId: string,
  newStatus: string,
): Promise<TaskForgeResponse> {
  return callTaskForgeApi({
    action: 'move',
    task: taskId,
    status: newStatus,
  });
}

export async function taskforgeAddComment(
  taskId: string,
  comment: string,
): Promise<TaskForgeResponse> {
  return callTaskForgeApi({
    action: 'comment',
    task: taskId,
    comment,
  });
}

export async function taskforgeSearch(query: string): Promise<TaskForgeResponse> {
  return callTaskForgeApi({ search: query });
}
```

**Step 2: Commit**

```bash
git add apps/api/src/tools/taskforge.ts
git commit -m "feat: add TaskForge tools (6 tools wrapping api-project-access)"
```

**Important note:** The exact request body shape depends on what `api-project-access` accepts. Read `/opt/Klyde/projects/taskforge/docs/API_PROJECT_ACCESS.md` and the function source to verify the exact fields (`action`, `task`, `status`, etc.). The `create`, `move`, and `comment` actions may need to use the `task-api` function instead if `api-project-access` is read-only. **Verify before implementing.**

---

## Task 5: Create Email Tool [DONE]

**Files:**
- Create: `apps/api/src/tools/email.ts`

**Step 1: Write the email tool implementation**

```typescript
// apps/api/src/tools/email.ts

/**
 * Email tool — sends emails via Resend REST API.
 * No SDK dependency, just fetch().
 */

import { config } from '../config.js';

interface EmailResult {
  success: boolean;
  result?: { id: string; message: string };
  error?: string;
}

export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  replyTo?: string,
): Promise<EmailResult> {
  const apiKey = config.resendApiKey;
  const fromAddress = config.resendFromAddress;

  if (!apiKey) {
    return { success: false, error: 'RESEND_API_KEY not configured' };
  }
  if (!fromAddress) {
    return { success: false, error: 'RESEND_FROM_ADDRESS not configured' };
  }

  const payload: Record<string, unknown> = {
    from: fromAddress,
    to: [to],
    subject,
    text: body,
  };

  if (replyTo) {
    payload.reply_to = replyTo;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    return {
      success: false,
      error: `Resend API error (${response.status}): ${errorBody}`,
    };
  }

  const result = await response.json();
  return {
    success: true,
    result: {
      id: result.id,
      message: `Email sent to ${to}: "${subject}"`,
    },
  };
}
```

**Step 2: Commit**

```bash
git add apps/api/src/tools/email.ts
git commit -m "feat: add send_email tool (Resend REST API)"
```

---

## Task 6: Register TaskForge + Email Tool Definitions in Registry [DONE]

**Files:**
- Modify: `apps/api/src/tools/registry.ts`

**Step 1: Add tool names to ToolName union**

Find the `ToolName` type in `registry.ts` and add:

```typescript
// Add to ToolName union:
| 'taskforge_list_tasks'
| 'taskforge_get_task'
| 'taskforge_create_task'
| 'taskforge_move_task'
| 'taskforge_add_comment'
| 'taskforge_search'
| 'send_email'
```

**Step 2: Add tool definitions to TOOL_REGISTRY array**

Add these entries to the `TOOL_REGISTRY` array:

```typescript
// TaskForge Tools
{
  name: 'taskforge_list_tasks',
  description: 'Liste Tasks aus TaskForge auf. Optional nach Projekt und Status filtern.',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Projektname (optional)' },
      status: { type: 'string', description: 'Status-Filter: initiierung, planung, umsetzung, review, done (optional)' },
    },
  },
  requiresConfirmation: false,
},
{
  name: 'taskforge_get_task',
  description: 'Hole Details zu einem bestimmten Task aus TaskForge.',
  parameters: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Die Task-ID' },
    },
    required: ['taskId'],
  },
  requiresConfirmation: false,
},
{
  name: 'taskforge_create_task',
  description: 'Erstelle einen neuen Task in TaskForge.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Task-Titel (imperativ, z.B. "Fix login bug")' },
      description: { type: 'string', description: 'Detaillierte Beschreibung mit Akzeptanzkriterien' },
      status: { type: 'string', description: 'Initialer Status (default: initiierung)', enum: ['initiierung', 'planung', 'umsetzung', 'review'] },
    },
    required: ['title', 'description'],
  },
  requiresConfirmation: true,
},
{
  name: 'taskforge_move_task',
  description: 'Verschiebe einen Task in einen neuen Status.',
  parameters: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Die Task-ID' },
      newStatus: { type: 'string', description: 'Neuer Status', enum: ['initiierung', 'planung', 'umsetzung', 'review', 'done'] },
    },
    required: ['taskId', 'newStatus'],
  },
  requiresConfirmation: true,
},
{
  name: 'taskforge_add_comment',
  description: 'Füge einen Kommentar zu einem TaskForge-Task hinzu.',
  parameters: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Die Task-ID' },
      comment: { type: 'string', description: 'Der Kommentar-Text' },
    },
    required: ['taskId', 'comment'],
  },
  requiresConfirmation: false,
},
{
  name: 'taskforge_search',
  description: 'Suche nach Tasks in TaskForge.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Suchbegriff' },
    },
    required: ['query'],
  },
  requiresConfirmation: false,
},
// Email Tool
{
  name: 'send_email',
  description: 'Sende eine E-Mail über Resend. Nutze dies für Status-Updates, Berichte oder Benachrichtigungen per E-Mail.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Empfänger E-Mail-Adresse' },
      subject: { type: 'string', description: 'Betreff der E-Mail' },
      body: { type: 'string', description: 'Text-Inhalt der E-Mail (Markdown wird unterstützt)' },
      replyTo: { type: 'string', description: 'Reply-To Adresse (optional)' },
    },
    required: ['to', 'subject', 'body'],
  },
  requiresConfirmation: true,
},
```

**Step 3: Commit**

```bash
git add apps/api/src/tools/registry.ts
git commit -m "feat: register TaskForge + email tool definitions in registry"
```

---

## Task 7: Add TaskForge + Email Execution Cases to Executor [DONE]

**Files:**
- Modify: `apps/api/src/tools/executor.ts`

**Step 1: Add import for taskforge and email tools**

At the top of `executor.ts`, add:

```typescript
import * as taskforgeTools from './taskforge.js';
import * as emailTools from './email.js';
```

**Step 2: Add switch cases before the `default:` case**

```typescript
// TaskForge Tools (CAIO agent)
case 'taskforge_list_tasks':
  return taskforgeTools.taskforgeListTasks(
    args.project as string | undefined,
    args.status as string | undefined,
  );

case 'taskforge_get_task':
  return taskforgeTools.taskforgeGetTask(args.taskId as string);

case 'taskforge_create_task':
  return taskforgeTools.taskforgeCreateTask(
    args.title as string,
    args.description as string,
    args.status as string | undefined,
  );

case 'taskforge_move_task':
  return taskforgeTools.taskforgeMoveTask(
    args.taskId as string,
    args.newStatus as string,
  );

case 'taskforge_add_comment':
  return taskforgeTools.taskforgeAddComment(
    args.taskId as string,
    args.comment as string,
  );

case 'taskforge_search':
  return taskforgeTools.taskforgeSearch(args.query as string);

// Email Tool (CAIO agent)
case 'send_email':
  return emailTools.sendEmail(
    args.to as string,
    args.subject as string,
    args.body as string,
    args.replyTo as string | undefined,
  );
```

**Step 3: Commit**

```bash
git add apps/api/src/tools/executor.ts
git commit -m "feat: add TaskForge + email execution cases to executor"
```

---

## Task 8: Migrate Scheduler Tools from DEVO to CAIO [DONE]

**Files:**
- Modify: `apps/api/src/agents/devo.ts` (remove scheduler tools)

**Step 1: Remove scheduler tools from DEVO's tools array**

In `apps/api/src/agents/devo.ts`, remove these lines from the `tools` array:

```typescript
// REMOVE these lines from DEVO_AGENT.tools:
'scheduler_create',
'scheduler_list',
'scheduler_update',
'scheduler_delete',
'reminder_create',
'notify_user',
```

Keep everything else in DEVO unchanged.

**Step 2: Commit**

```bash
git add apps/api/src/agents/devo.ts
git commit -m "refactor: migrate scheduler tools from DEVO to CAIO"
```

---

## Task 9: Register CAIO in Agent Router [DONE]

**Files:**
- Modify: `apps/api/src/agents/router.ts`

**Step 1: Import CAIO agent**

Add to the imports in `router.ts`:

```typescript
import { CAIO_AGENT } from './caio.js';
```

**Step 2: Add CAIO to AGENTS record**

Change:

```typescript
const AGENTS: Record<AgentName, AgentDefinition> = {
  chapo: CHAPO_AGENT,
  devo: DEVO_AGENT,
  scout: SCOUT_AGENT,
};
```

To:

```typescript
const AGENTS: Record<AgentName, AgentDefinition> = {
  chapo: CHAPO_AGENT,
  devo: DEVO_AGENT,
  scout: SCOUT_AGENT,
  caio: CAIO_AGENT,
};
```

**Step 3: Update handleUserResponse to include 'caio' in agent name check**

Find the line:

```typescript
const historyAgent: AgentName =
  question.fromAgent === 'chapo' || question.fromAgent === 'devo' || question.fromAgent === 'scout'
    ? question.fromAgent
    : 'chapo';
```

Change to:

```typescript
const historyAgent: AgentName =
  question.fromAgent === 'chapo' || question.fromAgent === 'devo' || question.fromAgent === 'scout' || question.fromAgent === 'caio'
    ? question.fromAgent
    : 'chapo';
```

**Step 4: Commit**

```bash
git add apps/api/src/agents/router.ts
git commit -m "feat: register CAIO agent in router"
```

---

## Task 10: Add delegateToCaio Meta-Tool to CHAPO

**Files:**
- Modify: `apps/api/src/agents/chapo.ts`

**Step 1: Add delegateToCaio to CHAPO's tools array**

In `CHAPO_AGENT.tools`, add:

```typescript
'delegateToCaio',
```

**Step 2: Add CAIO delegation capability**

In `CHAPO_AGENT.capabilities`, add:

```typescript
canDelegateToCaio: true,
```

Also add this to the `AgentCapabilities` interface in `types.ts`:

```typescript
canDelegateToCaio?: boolean;
```

**Step 3: Add delegateToCaio meta-tool definition**

Add to `CHAPO_META_TOOLS` array:

```typescript
{
  name: 'delegateToCaio',
  description: 'Delegiere Kommunikations- und Admin-Aufgaben an CAIO (Communications & Administration Officer). Nutze dies für: TaskForge Tickets erstellen/verwalten, E-Mails senden, Scheduler-Jobs verwalten, Erinnerungen setzen, Benachrichtigungen.',
  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'Beschreibung der Aufgabe für CAIO',
      },
      context: {
        type: 'object',
        description: 'Gesammelter Kontext (optional)',
      },
    },
    required: ['task'],
  },
  requiresConfirmation: false,
},
```

**Step 4: Commit**

```bash
git add apps/api/src/agents/chapo.ts apps/api/src/agents/types.ts
git commit -m "feat: add delegateToCaio meta-tool to CHAPO"
```

---

## Task 11: Update CHAPO System Prompt with CAIO Routing

**Files:**
- Modify: `apps/api/src/prompts/chapo.ts`

**Step 1: Update the prompt to include CAIO routing**

Add CAIO to the agent routing section. In `CHAPO_SYSTEM_PROMPT`, update the "Über deine Agents" section:

```typescript
### Über deine Agents
- **Developer & DevOps (Devo)**: Code, Tests, Git, DevOps, PM2 → delegateToDevo
- **Searcher (Scout)**: Web-Suche, Codebase-Exploration → delegateToScout
- **Communications & Admin (CAIO)**: Tickets, E-Mail, Scheduler, Erinnerungen → delegateToCaio
```

Also update the "WANN WAS TUN" section to add CAIO routing:

```typescript
### Delegiere an CAIO
| User sagt | Tool |
|-----------|------|
| "Erstelle ein Ticket für..." | delegateToCaio({ task: "Erstelle Ticket: ..." }) |
| "Schick eine Mail an..." | delegateToCaio({ task: "Sende E-Mail an ..." }) |
| "Erinnere mich in 2h an..." | delegateToCaio({ task: "Erstelle Erinnerung: ..." }) |
| "Was steht auf dem Taskboard?" | delegateToCaio({ task: "Liste offene Tasks" }) |
| "Check jeden Morgen PM2" | delegateToCaio({ task: "Erstelle Scheduler-Job: ..." }) |
```

**Step 2: Commit**

```bash
git add apps/api/src/prompts/chapo.ts
git commit -m "feat: update CHAPO prompt with CAIO routing rules"
```

---

## Task 12: Add CAIO Delegation Handler to ChapoLoop

**Files:**
- Modify: `apps/api/src/agents/chapo-loop.ts`

**Step 1: Add delegateToCaio handler in runLoop()**

In the `for (const toolCall of response.toolCalls)` block in `runLoop()`, add a new case AFTER the `delegateToScout` handler and BEFORE the `requestApproval` handler:

```typescript
// ACTION: DELEGATE to CAIO
if (toolCall.name === 'delegateToCaio') {
  const task = (toolCall.arguments.task as string) || 'Admin-Aufgabe ausfuehren';
  const context = toolCall.arguments.context as string | undefined;

  this.sendEvent({
    type: 'agent_thinking',
    agent: 'chapo',
    status: `Delegiere an CAIO: ${task.slice(0, 60)}...`,
  });

  const [caioResult, caioErr] = await this.errorHandler.safe(
    `delegate:caio:${this.iteration}`,
    () => this.delegateToCaio(task, context),
  );

  if (caioErr) {
    toolResults.push({
      toolUseId: toolCall.id,
      result: `CAIO Fehler: ${this.errorHandler.formatForLLM(caioErr)}`,
      isError: true,
    });
  } else {
    this.sendEvent({
      type: 'tool_result',
      agent: 'chapo',
      toolName: toolCall.name,
      result: { delegated: true, agent: 'caio' },
      success: true,
    });
    toolResults.push({
      toolUseId: toolCall.id,
      result: caioResult || 'CAIO hat die Aufgabe ausgefuehrt.',
      isError: false,
    });
  }
  continue;
}
```

**Step 2: Add the delegateToCaio private method**

Add this method to the `ChapoLoop` class, modeled after `delegateToDevo`:

```typescript
/**
 * DELEGATE to CAIO: Run a sub-loop with CAIO agent for admin/comms tasks.
 */
private async delegateToCaio(task: string, context?: string): Promise<string> {
  const caio = getAgent('caio');
  const caioToolNames = getToolsForAgent('caio');
  const tools = getToolsForLLM().filter((t) => caioToolNames.includes(t.name));
  const systemContextBlock = getCombinedSystemContextBlock(this.sessionId);

  this.sendEvent({
    type: 'agent_switch',
    from: 'chapo',
    to: 'caio',
    reason: `Delegiere: ${task.slice(0, 80)}`,
  });
  this.sendEvent({ type: 'delegation', from: 'chapo', to: 'caio', task });

  const systemPrompt = `${caio.systemPrompt}
${systemContextBlock}
${context ? `\nKONTEXT VON CHAPO:\n${context}` : ''}

AUFGABE: ${task}

Führe die Aufgabe aus. Bei Problemen nutze escalateToChapo().`;

  const messages: LLMMessage[] = [
    { role: 'user', content: task },
  ];

  let turn = 0;
  const MAX_TURNS = 10;
  let finalContent = '';

  while (turn < MAX_TURNS) {
    turn++;
    this.sendEvent({ type: 'agent_thinking', agent: 'caio', status: `Turn ${turn}...` });

    const response = await llmRouter.generate('anthropic', {
      model: caio.model,
      messages,
      systemPrompt,
      tools,
      toolsEnabled: true,
    });

    if (response.content) {
      finalContent = response.content;
    }

    if (!response.toolCalls || response.toolCalls.length === 0) {
      break;
    }

    messages.push({
      role: 'assistant',
      content: response.content || '',
      toolCalls: response.toolCalls,
    });

    const toolResults: { toolUseId: string; result: string; isError: boolean }[] = [];

    for (const toolCall of response.toolCalls) {
      // Handle escalation back to CHAPO
      if (toolCall.name === 'escalateToChapo') {
        const desc = (toolCall.arguments.description as string) || 'Unknown issue';
        toolResults.push({
          toolUseId: toolCall.id,
          result: `Eskalation wird von CHAPO verarbeitet: ${desc}`,
          isError: false,
        });
        return `CAIO eskaliert: ${desc}\n\nBisheriges Ergebnis:\n${finalContent}`;
      }

      // Handle scout delegation from CAIO
      if (toolCall.name === 'delegateToScout') {
        const query = toolCall.arguments.query as string;
        const scope = (toolCall.arguments.scope as ScoutScope) || 'both';
        const scoutContext = toolCall.arguments.context as string | undefined;

        try {
          const scoutResult = await spawnScout(this.sessionId, query, {
            scope,
            context: scoutContext,
            sendEvent: this.sendEvent,
          });
          toolResults.push({
            toolUseId: toolCall.id,
            result: JSON.stringify(scoutResult, null, 2),
            isError: false,
          });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'SCOUT spawn failed';
          toolResults.push({
            toolUseId: toolCall.id,
            result: `Error: ${errMsg}`,
            isError: true,
          });
        }
        continue;
      }

      this.sendEvent({
        type: 'tool_call',
        agent: 'caio',
        toolName: toolCall.name,
        args: toolCall.arguments,
      });

      const startTime = Date.now();
      const [result, toolErr] = await this.errorHandler.safe(
        `caio-tool:${toolCall.name}:${turn}`,
        () => executeToolWithApprovalBridge(toolCall.name, toolCall.arguments, {
          agentName: 'caio',
          onActionPending: (action) => {
            this.sendEvent({
              type: 'action_pending',
              actionId: action.id,
              toolName: action.toolName,
              toolArgs: action.toolArgs,
              description: action.description,
              preview: action.preview,
            });
          },
        }),
      );

      if (toolErr) {
        this.sendEvent({
          type: 'tool_result',
          agent: 'caio',
          toolName: toolCall.name,
          result: { error: toolErr.message },
          success: false,
        });
        toolResults.push({
          toolUseId: toolCall.id,
          result: `Error: ${toolErr.message}`,
          isError: true,
        });
      } else {
        this.sendEvent({
          type: 'tool_result',
          agent: 'caio',
          toolName: toolCall.name,
          result: result.result,
          success: result.success,
        });
        const content = this.buildToolResultContent(result);
        toolResults.push({
          toolUseId: toolCall.id,
          result: content.content,
          isError: content.isError,
        });
      }
    }

    messages.push({
      role: 'user',
      content: '',
      toolResults,
    });
  }

  // Switch back to CHAPO
  this.sendEvent({
    type: 'agent_switch',
    from: 'caio',
    to: 'chapo',
    reason: 'CAIO Delegation abgeschlossen',
  });
  this.sendEvent({ type: 'agent_complete', agent: 'caio', result: finalContent });

  return finalContent;
}
```

**Step 3: Commit**

```bash
git add apps/api/src/agents/chapo-loop.ts
git commit -m "feat: add CAIO delegation handler to ChapoLoop"
```

---

## Task 13: Add DELEGATE_PARALLEL to ChapoLoop

**Files:**
- Modify: `apps/api/src/agents/chapo-loop.ts`
- Modify: `apps/api/src/agents/chapo.ts` (add meta-tool)

**Step 1: Add delegateParallel meta-tool to CHAPO**

In `CHAPO_META_TOOLS` in `chapo.ts`, add:

```typescript
{
  name: 'delegateParallel',
  description: 'Delegiere mehrere unabhängige Aufgaben gleichzeitig an verschiedene Agents. Nutze dies wenn Tasks keine Datenabhängigkeit haben (z.B. Code fixen UND Ticket erstellen).',
  parameters: {
    type: 'object',
    properties: {
      delegations: {
        type: 'array',
        description: 'Liste der parallelen Delegationen',
        items: {
          type: 'object',
          properties: {
            agent: { type: 'string', enum: ['devo', 'caio', 'scout'], description: 'Ziel-Agent' },
            task: { type: 'string', description: 'Aufgabe für den Agent' },
          },
          required: ['agent', 'task'],
        },
      },
    },
    required: ['delegations'],
  },
  requiresConfirmation: false,
},
```

Add `'delegateParallel'` to `CHAPO_AGENT.tools` array.

**Step 2: Handle delegateParallel in ChapoLoop.runLoop()**

In the tool-call handling block, add BEFORE the `requestApproval` handler:

```typescript
// ACTION: DELEGATE_PARALLEL — fire multiple agents concurrently
if (toolCall.name === 'delegateParallel') {
  const delegations = toolCall.arguments.delegations as Array<{ agent: string; task: string }>;
  if (!delegations || delegations.length === 0) {
    toolResults.push({
      toolUseId: toolCall.id,
      result: 'Keine Delegationen angegeben.',
      isError: true,
    });
    continue;
  }

  this.sendEvent({
    type: 'agent_thinking',
    agent: 'chapo',
    status: `Parallele Delegation: ${delegations.map(d => d.agent).join(' + ')}`,
  });

  const promises = delegations.map(async (d) => {
    try {
      if (d.agent === 'devo') {
        return { agent: d.agent, result: await this.delegateToDevo(d.task), error: null };
      } else if (d.agent === 'caio') {
        return { agent: d.agent, result: await this.delegateToCaio(d.task), error: null };
      } else if (d.agent === 'scout') {
        const scoutResult = await spawnScout(this.sessionId, d.task, { sendEvent: this.sendEvent });
        return { agent: d.agent, result: JSON.stringify(scoutResult, null, 2), error: null };
      }
      return { agent: d.agent, result: null, error: `Unknown agent: ${d.agent}` };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      return { agent: d.agent, result: null, error: errMsg };
    }
  });

  const results = await Promise.all(promises);
  const summary = results.map((r) => {
    if (r.error) return `${r.agent.toUpperCase()}: FEHLER — ${r.error}`;
    return `${r.agent.toUpperCase()}: ${r.result || 'Erledigt'}`;
  }).join('\n\n---\n\n');

  toolResults.push({
    toolUseId: toolCall.id,
    result: summary,
    isError: results.every(r => r.error !== null),
  });
  continue;
}
```

**Step 3: Commit**

```bash
git add apps/api/src/agents/chapo-loop.ts apps/api/src/agents/chapo.ts
git commit -m "feat: add DELEGATE_PARALLEL action to ChapoLoop"
```

---

## Task 14: Create Telegram Webhook Route

**Files:**
- Create: `apps/api/src/routes/external.ts`
- Create: `apps/api/src/external/telegram.ts`

**Step 1: Create Telegram client helper**

```typescript
// apps/api/src/external/telegram.ts

/**
 * Telegram Bot API client — minimal wrapper using fetch().
 * No SDK dependency.
 */

import { config } from '../config.js';

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name: string; username?: string };
    chat: { id: number; type: string };
    date: number;
    text?: string;
    reply_to_message?: { message_id: number; text?: string };
  };
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  const token = config.telegramBotToken;
  if (!token) {
    console.error('[Telegram] Bot token not configured');
    return false;
  }

  // Telegram message limit is 4096 chars
  const truncated = text.length > 4000 ? text.slice(0, 4000) + '\n\n[...truncated]' : text;

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: truncated,
      parse_mode: 'Markdown',
    }),
  });

  if (!response.ok) {
    // Retry without Markdown parse mode if it fails (some messages break Markdown parsing)
    const retry = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: truncated,
      }),
    });
    if (!retry.ok) {
      console.error('[Telegram] Failed to send message:', await retry.text());
      return false;
    }
  }

  return true;
}

export function isAllowedChat(chatId: number | string): boolean {
  const allowed = config.telegramAllowedChatId;
  if (!allowed) return false;
  return String(chatId) === String(allowed);
}
```

**Step 2: Create the external webhook route**

```typescript
// apps/api/src/routes/external.ts

/**
 * External platform webhook routes.
 * Starts with Telegram only. Extensible for future platforms.
 */

import { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import { processRequest } from '../agents/router.js';
import type { TelegramUpdate } from '../external/telegram.js';
import { sendTelegramMessage, isAllowedChat } from '../external/telegram.js';
import { getOrCreateExternalSession } from '../db/schedulerQueries.js';

export const externalRoutes: FastifyPluginAsync = async (app) => {
  // Telegram webhook endpoint — no auth middleware (Telegram verifies via token in URL)
  app.post('/telegram/webhook', async (request, reply) => {
    const update = request.body as TelegramUpdate;

    if (!update.message?.text) {
      return reply.status(200).send({ ok: true });
    }

    const chatId = String(update.message.chat.id);
    const userId = String(update.message.from?.id || 'unknown');
    const text = update.message.text;

    // Single-user verification
    if (!isAllowedChat(chatId)) {
      console.warn('[Telegram] Rejected message from unauthorized chat:', chatId);
      return reply.status(200).send({ ok: true });
    }

    // Look up or create external session
    const externalSession = await getOrCreateExternalSession(
      'telegram',
      userId,
      chatId,
    );

    // Fire-and-forget: process in background, respond immediately to Telegram
    reply.status(200).send({ ok: true });

    try {
      const sendEvent = () => {}; // External sessions don't stream to WebSocket

      const response = await processRequest(
        externalSession.sessionId,
        text,
        [], // No conversation history for external (stateless per message)
        null, // No project root
        sendEvent,
      );

      await sendTelegramMessage(chatId, response);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Telegram] Error processing message:', errMsg);
      await sendTelegramMessage(chatId, `Fehler: ${errMsg}`);
    }
  });
};
```

**Step 3: Add getOrCreateExternalSession to schedulerQueries.ts**

In `apps/api/src/db/schedulerQueries.ts`, add:

```typescript
export async function getOrCreateExternalSession(
  platform: string,
  externalUserId: string,
  externalChatId: string,
): Promise<{ id: string; sessionId: string }> {
  const supabase = getSupabase();

  // Try to find existing session
  const { data: existing } = await supabase
    .from('external_sessions')
    .select('id, session_id')
    .eq('platform', platform)
    .eq('external_chat_id', externalChatId)
    .single();

  if (existing) {
    return { id: existing.id, sessionId: existing.session_id };
  }

  // Create new session
  const sessionId = crypto.randomUUID();
  const { data, error } = await supabase
    .from('external_sessions')
    .insert({
      platform,
      external_user_id: externalUserId,
      external_chat_id: externalChatId,
      session_id: sessionId,
      is_default_channel: false,
    })
    .select('id, session_id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create external session: ${error?.message}`);
  }

  return { id: data.id, sessionId: data.session_id };
}
```

**Step 4: Commit**

```bash
git add apps/api/src/routes/external.ts apps/api/src/external/telegram.ts apps/api/src/db/schedulerQueries.ts
git commit -m "feat: add Telegram webhook route and external session management"
```

---

## Task 15: Register External Route in Server

**Files:**
- Modify: `apps/api/src/server.ts`

**Step 1: Import the external routes**

Add to the imports at the top of `server.ts`:

```typescript
import { externalRoutes } from './routes/external.js';
```

**Step 2: Register the route (BEFORE the auth hook, since Telegram doesn't use our auth)**

After the existing route registrations, add:

```typescript
await app.register(externalRoutes, { prefix: '/api' });
```

**Step 3: Exclude the telegram webhook from the auth preHandler hook**

Modify the auth hook to also exclude `/api/telegram`:

```typescript
if (url.startsWith('/api/health') || url.startsWith('/api/auth') || url.startsWith('/api/ws') || url.startsWith('/api/telegram')) return;
```

**Step 4: Commit**

```bash
git add apps/api/src/server.ts
git commit -m "feat: register Telegram webhook route in server"
```

---

## Task 16: Create ExternalOutputProjection

**Files:**
- Create: `apps/api/src/workflow/projections/externalOutputProjection.ts`

**Step 1: Check event catalog for available events**

Read `apps/api/src/workflow/events/catalog.ts` to find the event types to listen for (WF_COMPLETED, GATE_QUESTION_QUEUED, etc.).

**Step 2: Write the projection**

```typescript
// apps/api/src/workflow/projections/externalOutputProjection.ts

/**
 * External Output Projection — routes responses to external platforms (Telegram).
 *
 * Listens for:
 * - WF_COMPLETED — sends final response to originating platform
 * - GATE_QUESTION_QUEUED — sends question to platform
 * - GATE_APPROVAL_QUEUED — sends approval request to platform
 */

import type { Projection } from '../events/bus.js';
import type { WorkflowEventEnvelope } from '../events/envelope.js';
import {
  WF_COMPLETED,
  GATE_QUESTION_QUEUED,
  GATE_APPROVAL_QUEUED,
} from '../events/catalog.js';
import { getExternalSessionBySessionId } from '../../db/schedulerQueries.js';
import { sendTelegramMessage } from '../../external/telegram.js';

const HANDLED_EVENTS = new Set([WF_COMPLETED, GATE_QUESTION_QUEUED, GATE_APPROVAL_QUEUED]);

export class ExternalOutputProjection implements Projection {
  name = 'external-output';

  async handle(event: WorkflowEventEnvelope): Promise<void> {
    if (!HANDLED_EVENTS.has(event.eventType)) return;

    const { sessionId, payload } = event;
    const p = payload as Record<string, unknown>;

    // Check if this session has an external origin
    const externalSession = await getExternalSessionBySessionId(sessionId);
    if (!externalSession) return;

    if (externalSession.platform === 'telegram') {
      const chatId = externalSession.external_chat_id;

      switch (event.eventType) {
        case WF_COMPLETED: {
          const answer = (p.answer as string) || 'Fertig.';
          await sendTelegramMessage(chatId, answer);
          break;
        }
        case GATE_QUESTION_QUEUED: {
          const question = (p.question as string) || 'Frage?';
          await sendTelegramMessage(chatId, `❓ ${question}`);
          break;
        }
        case GATE_APPROVAL_QUEUED: {
          const description = (p.description as string) || 'Genehmigung erforderlich';
          await sendTelegramMessage(chatId, `⚠️ Genehmigung erforderlich:\n${description}\n\nAntworte "ja" oder "nein".`);
          break;
        }
      }
    }
  }
}
```

**Step 3: Add getExternalSessionBySessionId to schedulerQueries.ts**

```typescript
export async function getExternalSessionBySessionId(
  sessionId: string,
): Promise<{ id: string; platform: string; external_chat_id: string; external_user_id: string } | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('external_sessions')
    .select('id, platform, external_chat_id, external_user_id')
    .eq('session_id', sessionId)
    .single();

  return data || null;
}
```

**Step 4: Commit**

```bash
git add apps/api/src/workflow/projections/externalOutputProjection.ts apps/api/src/db/schedulerQueries.ts
git commit -m "feat: add ExternalOutputProjection for routing to Telegram"
```

---

## Task 17: Register ExternalOutputProjection

**Files:**
- Modify: `apps/api/src/workflow/projections/index.ts`

**Step 1: Import and register**

```typescript
import { ExternalOutputProjection } from './externalOutputProjection.js';

// Add to registerProjections():
workflowBus.register(new ExternalOutputProjection());
```

**Step 2: Commit**

```bash
git add apps/api/src/workflow/projections/index.ts
git commit -m "feat: register ExternalOutputProjection at startup"
```

---

## Task 18: Wire Scheduler Notification to Telegram

**Files:**
- Modify: `apps/api/src/server.ts`

**Step 1: Replace the placeholder notification sender with real Telegram integration**

In `server.ts`, change the `schedulerService.configure()` notification sender from:

```typescript
async (message: string, _channel?: string | null) => {
  console.log(`[Scheduler] Notification: ${message.substring(0, 100)}`);
},
```

To:

```typescript
async (message: string, channel?: string | null) => {
  console.log(`[Scheduler] Notification: ${message.substring(0, 100)}`);
  // Send to Telegram if configured
  const { getDefaultNotificationChannel } = await import('./db/schedulerQueries.js');
  const { sendTelegramMessage } = await import('./external/telegram.js');

  const targetChannel = channel || await getDefaultNotificationChannel();
  if (targetChannel) {
    await sendTelegramMessage(targetChannel, message);
  }
},
```

**Step 2: Add getDefaultNotificationChannel to schedulerQueries.ts**

```typescript
export async function getDefaultNotificationChannel(): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('external_sessions')
    .select('external_chat_id')
    .eq('is_default_channel', true)
    .single();

  return data?.external_chat_id || null;
}
```

**Step 3: Commit**

```bash
git add apps/api/src/server.ts apps/api/src/db/schedulerQueries.ts
git commit -m "feat: wire scheduler notifications to Telegram"
```

---

## Task 19: Wire Scheduler Job Executor to CommandDispatcher

**Files:**
- Modify: `apps/api/src/server.ts`

**Step 1: Replace the placeholder job executor with real processRequest**

In `server.ts`, change the `schedulerService.configure()` job executor from:

```typescript
async (instruction: string, _jobId: string) => {
  console.log(`[Scheduler] Executing instruction: ${instruction.substring(0, 80)}...`);
  return `Executed: ${instruction.substring(0, 80)}`;
},
```

To:

```typescript
async (instruction: string, jobId: string) => {
  const { processRequest } = await import('./agents/router.js');
  const sessionId = `scheduler-${jobId}-${Date.now()}`;
  console.log(`[Scheduler] Executing: ${instruction.substring(0, 80)}... (session: ${sessionId})`);

  const result = await processRequest(
    sessionId,
    instruction,
    [], // System session — no conversation history
    null, // No project root
    () => {}, // No streaming for scheduled jobs
  );
  return result;
},
```

**Step 2: Commit**

```bash
git add apps/api/src/server.ts
git commit -m "feat: wire scheduler job executor to processRequest pipeline"
```

---

## Task 20: Add CHAPO Context Injection for Scheduler Errors

**Files:**
- Modify: `apps/api/src/scheduler/schedulerService.ts` (add ring buffer)
- Modify: `apps/api/src/agents/systemContext.ts` (inject into system context)

**Step 1: Add ring buffer to schedulerService.ts**

Add a static ring buffer to the scheduler service:

```typescript
// Add to SchedulerService class:
private static recentErrors: Array<{ jobName: string; error: string; timestamp: string }> = [];
private static readonly MAX_RECENT_ERRORS = 20;

static addRecentError(jobName: string, error: string): void {
  SchedulerService.recentErrors.push({
    jobName,
    error,
    timestamp: new Date().toISOString(),
  });
  if (SchedulerService.recentErrors.length > SchedulerService.MAX_RECENT_ERRORS) {
    SchedulerService.recentErrors.shift();
  }
}

static getRecentErrors(): Array<{ jobName: string; error: string; timestamp: string }> {
  return [...SchedulerService.recentErrors];
}
```

When a job fails (in the existing error handling), call `SchedulerService.addRecentError(...)`.

**Step 2: Inject into systemContext.ts**

In `systemContext.ts`, modify `getCombinedSystemContextBlock()` to include scheduler errors:

```typescript
import { schedulerService } from '../scheduler/schedulerService.js';

// In getCombinedSystemContextBlock(), after the existing blocks:
const schedulerErrors = schedulerService.constructor.getRecentErrors?.() || [];
if (schedulerErrors.length > 0) {
  const errorSummary = schedulerErrors
    .slice(-5) // Show last 5 errors max
    .map((e: { jobName: string; error: string; timestamp: string }) =>
      `- ${e.jobName}: ${e.error} (${e.timestamp})`
    )
    .join('\n');
  blocks.push(`\n## Letzte Scheduler-Fehler\n${errorSummary}`);
}
```

**Better approach:** Export `getRecentErrors` as a standalone function from schedulerService:

```typescript
// schedulerService.ts — module-level
const recentErrors: Array<{ jobName: string; error: string; timestamp: string }> = [];

export function addSchedulerError(jobName: string, error: string): void {
  recentErrors.push({ jobName, error, timestamp: new Date().toISOString() });
  if (recentErrors.length > 20) recentErrors.shift();
}

export function getSchedulerErrors(): Array<{ jobName: string; error: string; timestamp: string }> {
  return [...recentErrors];
}
```

Then in `systemContext.ts`:

```typescript
import { getSchedulerErrors } from '../scheduler/schedulerService.js';

// In getCombinedSystemContextBlock:
const schedulerErrors = getSchedulerErrors();
if (schedulerErrors.length > 0) {
  const errorSummary = schedulerErrors
    .slice(-5)
    .map((e) => `- ${e.jobName}: ${e.error} (${e.timestamp})`)
    .join('\n');
  blocks.push(`\n## Letzte Scheduler-Fehler\n${errorSummary}`);
}
```

**Step 3: Commit**

```bash
git add apps/api/src/scheduler/schedulerService.ts apps/api/src/agents/systemContext.ts
git commit -m "feat: inject scheduler errors into CHAPO system context"
```

---

## Task 21: Documentation Updates [DONE]

**Files:**
- Modify: `docs/architecture.md`
- Modify: `.env.example`
- Modify: `docs/plans/2026-02-19-automation-assistant-design.md` (mark phases complete)

**Step 1: Update architecture.md**

Add to the architecture diagram:

```
                    +----------------------------+
                    |           USER             |
                    +-----+-----------+----------+
                          |           |
                     Web UI (WS)  Telegram
                          |           |
                          v           v
              +--------------------------------------+
              |     CHAPO -- DECISION LOOP            |
              |                                       |
              |  4 Actions + DELEGATE_PARALLEL:       |
              |  ANSWER | ASK | TOOL | DELEGATE       |
              |       |                               |
              |  +----v---------+  +-----------+  +--------+
              |  | DEVO         |  | SCOUT     |  | CAIO   |
              |  | (Dev+DevOps) |  | (Explorer)|  | (Comms)|
              |  +--------------+  +-----------+  +--------+
              +--------------------------------------+
```

Add CAIO agent section, scheduler service section, external messaging section.

**Step 2: Update .env.example**

Already done in Task 3 — verify it includes all new vars.

**Step 3: Update design doc status**

Change status line to: `**Status:** Complete`
Mark all phases as DONE in the implementation table.

**Step 4: Commit**

```bash
git add docs/architecture.md .env.example docs/plans/2026-02-19-automation-assistant-design.md
git commit -m "docs: update architecture and mark automation assistant implementation complete"
```

---

## Task 22: Verify End-to-End

**No files — manual verification**

**Step 1: Verify TypeScript compilation**

```bash
cd /opt/Klyde/projects/Devai && npx tsc --noEmit
```

Expected: No type errors.

**Step 2: Run existing tests**

```bash
cd /opt/Klyde/projects/Devai && npx vitest run
```

Expected: All existing tests pass.

**Step 3: Manual smoke tests**

Via Devai Web UI:
1. "Erstelle ein Ticket für den Login-Bug" → CHAPO routes to CAIO → TaskForge ticket created
2. "Was steht auf meinem Taskboard?" → CAIO lists tasks
3. "Erinnere mich in 1 Stunde an den Deploy" → CAIO creates reminder
4. "Check jeden Morgen um 8 den PM2 Status" → CAIO creates scheduler job

Via Telegram:
5. Send a message to the bot → response comes back
6. "Was steht auf dem Taskboard?" → TaskForge results returned

Parallel:
7. "Fix den Auth-Bug und erstelle ein Ticket dafür" → DELEGATE_PARALLEL (DEVO + CAIO)

---

## Acceptance Criteria

Concrete, verifiable criteria organized by track. Each criterion can be checked by reading code or running a command.

### Track A — CAIO Agent (Tasks 1-2)

1. File `apps/api/src/prompts/caio.ts` exists and exports a named constant `CAIO_SYSTEM_PROMPT` of type `string`
2. `CAIO_SYSTEM_PROMPT` is re-exported from `apps/api/src/prompts/index.ts`
3. File `apps/api/src/agents/caio.ts` exists and exports `CAIO_AGENT` of type `AgentDefinition`
4. `AgentName` type in `apps/api/src/agents/types.ts` includes the literal `'caio'` in its union
5. `AgentRole` type in `apps/api/src/agents/types.ts` includes `'Communications & Administration Officer'`
6. `AgentCapabilities` interface includes properties: `canManageScheduler`, `canSendNotifications`, `canSendEmail`, `canManageTaskForge` (all optional booleans)
7. `CAIO_AGENT.tools` contains NO filesystem/bash/SSH/git tools — specifically none of: `fs_*`, `bash_execute`, `ssh_execute`, `git_*`, `pm2_*`, `npm_*`
8. `CAIO_AGENT.tools` includes all of: `taskforge_list_tasks`, `taskforge_get_task`, `taskforge_create_task`, `taskforge_move_task`, `taskforge_add_comment`, `taskforge_search`, `scheduler_create`, `scheduler_list`, `scheduler_update`, `scheduler_delete`, `reminder_create`, `notify_user`, `send_email`, `memory_remember`, `memory_search`, `memory_readToday`, `delegateToScout`, `escalateToChapo`
9. `caio.ts` calls `registerMetaTools(CAIO_META_TOOLS, 'caio')` and `registerAgentTools('caio', CAIO_AGENT.tools)` at module scope
10. `CAIO_META_TOOLS` array includes an `escalateToChapo` meta-tool with required properties `issueType` and `description`

### Track B — Tool Implementations (Tasks 4-5)

1. File `apps/api/src/tools/taskforge.ts` exists and exports functions: `taskforgeListTasks`, `taskforgeGetTask`, `taskforgeCreateTask`, `taskforgeMoveTask`, `taskforgeAddComment`, `taskforgeSearch`
2. `callTaskForgeApi` sends POST requests to `https://appwrite.klyde.tech/v1/functions/api-project-access/executions` with header `X-Appwrite-Project: 69805803000aeddb2ead`
3. `callTaskForgeApi` includes `config.taskforgeApiKey` as `apiKey` in the nested `body` JSON (Appwrite execution format: `body: JSON.stringify({ apiKey, ...params })`)
4. All TaskForge functions return `{ success: boolean; result?: unknown; error?: string }` — no unhandled exceptions
5. File `apps/api/src/tools/email.ts` exists and exports function `sendEmail(to, subject, body, replyTo?)`
6. `sendEmail` calls `POST https://api.resend.com/emails` with `Authorization: Bearer ${config.resendApiKey}` — no Resend SDK dependency
7. `sendEmail` reads `config.resendApiKey` and `config.resendFromAddress` — returns `{ success: false, error: '...' }` when either is missing
8. `sendEmail` returns `{ success: true, result: { id, message } }` on success — no unhandled promise rejections

### Track C — Config/Env (Task 3)

1. `Config` interface in `apps/api/src/config.ts` includes properties: `taskforgeApiKey`, `resendApiKey`, `resendFromAddress`, `telegramBotToken`, `telegramAllowedChatId` (all `string`)
2. `loadConfig()` reads these from env vars: `DEVAI_TASKBOARD_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_ID`
3. All five new config properties default to `''` (empty string) when env vars are unset — no `undefined` values
4. `.env.example` (at `apps/api/.env.example` or root) lists all five new env vars with placeholder values

### Track D — Telegram + External Output (Tasks 14, 16)

1. File `apps/api/src/external/telegram.ts` exists and exports: `sendTelegramMessage(chatId, text)`, `isAllowedChat(chatId)`, and `TelegramUpdate` interface
2. `sendTelegramMessage` calls `https://api.telegram.org/bot${token}/sendMessage` via `fetch()` — no `node-telegram-bot-api` or other SDK dependency
3. `sendTelegramMessage` truncates messages longer than 4000 characters before sending
4. `sendTelegramMessage` retries without `parse_mode: 'Markdown'` if the first request fails
5. `isAllowedChat` compares `String(chatId)` against `String(config.telegramAllowedChatId)` — returns `false` when config is empty
6. File `apps/api/src/routes/external.ts` exists and exports `externalRoutes` as a `FastifyPluginAsync`
7. `POST /telegram/webhook` responds `200 { ok: true }` immediately — processing happens after response is sent (fire-and-forget)
8. `POST /telegram/webhook` rejects unauthorized chat IDs silently (200 response, no processing, console.warn logged)
9. File `apps/api/src/workflow/projections/externalOutputProjection.ts` exists and exports `ExternalOutputProjection` class
10. `ExternalOutputProjection` implements the `Projection` interface from `../events/bus.js` (has `name: string` and `handle(event): void | Promise<void>`)
11. `ExternalOutputProjection.name` is set to `'external-output'`
12. `ExternalOutputProjection.handle` only processes events of types `WF_COMPLETED`, `GATE_QUESTION_QUEUED`, `GATE_APPROVAL_QUEUED` — silently returns for all others
13. `getOrCreateExternalSession` and `getExternalSessionBySessionId` are exported from `apps/api/src/db/schedulerQueries.ts`

### Integration Phase (Tasks 6-13)

1. `ToolName` union in `registry.ts` includes all 7 new names: `'taskforge_list_tasks'`, `'taskforge_get_task'`, `'taskforge_create_task'`, `'taskforge_move_task'`, `'taskforge_add_comment'`, `'taskforge_search'`, `'send_email'`
2. `TOOL_REGISTRY` array in `registry.ts` has 7 new entries with correct `name`, `description`, `parameters` (schema), and `requiresConfirmation` values — specifically: `taskforge_create_task`, `taskforge_move_task`, and `send_email` have `requiresConfirmation: true`; the rest have `requiresConfirmation: false`
3. `executor.ts` imports `* as taskforgeTools from './taskforge.js'` and `* as emailTools from './email.js'`
4. `executor.ts` switch statement has 7 new cases (6 TaskForge + 1 email) before the `default:` — each case calls the corresponding function from the imported modules with correctly typed args
5. `DEVO_AGENT.tools` array in `devo.ts` no longer contains: `'scheduler_create'`, `'scheduler_list'`, `'scheduler_update'`, `'scheduler_delete'`, `'reminder_create'`, `'notify_user'`
6. `AGENTS` record in `router.ts` includes `caio: CAIO_AGENT` — import for `CAIO_AGENT` exists at top of file
7. `handleUserResponse` in `router.ts` includes `'caio'` in the agent name check for `historyAgent`
8. `CHAPO_AGENT.tools` array includes `'delegateToCaio'` and `'delegateParallel'`
9. `CHAPO_AGENT.capabilities` includes `canDelegateToCaio: true` — `AgentCapabilities` interface has `canDelegateToCaio?: boolean`
10. `CHAPO_META_TOOLS` array includes entries for `delegateToCaio` (requires `task` param) and `delegateParallel` (requires `delegations` array param)
11. `CHAPO_SYSTEM_PROMPT` in `prompts/chapo.ts` mentions CAIO in agent routing section and includes a routing table for CAIO-bound requests
12. `ChapoLoop` class in `chapo-loop.ts` has a private method `delegateToCaio(task, context?)` that returns `Promise<string>`
13. `delegateToCaio` creates a sub-loop with CAIO's tools (filtered from registry), sends `agent_switch` events (chapo→caio and caio→chapo), and has a `MAX_TURNS` limit
14. `delegateParallel` handler in `chapo-loop.ts` uses `Promise.all()` to run multiple delegations concurrently — accepts `delegations` array with `{ agent: 'devo'|'caio'|'scout', task: string }`
15. If one parallel delegation fails, the other's result is preserved (not all-or-nothing)

### Wiring Phase (Tasks 15, 17-19)

1. `server.ts` imports `externalRoutes` from `'./routes/external.js'` and registers it with `app.register(externalRoutes, { prefix: '/api' })`
2. Auth hook in `server.ts` excludes `/api/telegram` from JWT verification — the condition includes `url.startsWith('/api/telegram')`
3. `registerProjections()` in `workflow/projections/index.ts` imports and registers `new ExternalOutputProjection()` alongside existing projections
4. `schedulerService.configure()` in `server.ts` replaces the placeholder job executor with a function that calls `processRequest(sessionId, instruction, [], null, () => {})` — session ID format: `scheduler-${jobId}-${Date.now()}`
5. `schedulerService.configure()` in `server.ts` replaces the placeholder notification sender with a function that calls `sendTelegramMessage(targetChannel, message)` when a target channel is available
6. `getDefaultNotificationChannel` is exported from `schedulerQueries.ts` — queries `external_sessions` table for `is_default_channel = true`

### Context Phase (Task 20)

1. `schedulerService.ts` exports module-level functions `addSchedulerError(jobName, error)` and `getSchedulerErrors()` (or equivalent static methods on the class)
2. Ring buffer in scheduler service is limited to 20 entries — `shift()` is called when length exceeds 20
3. `addSchedulerError` is called in the existing job failure handling code path within `schedulerService.ts`
4. `systemContext.ts` imports `getSchedulerErrors` and calls it inside `getCombinedSystemContextBlock()`
5. When `getSchedulerErrors()` returns a non-empty array, the last 5 errors are formatted and appended to the system context blocks as `## Letzte Scheduler-Fehler`
6. When `getSchedulerErrors()` returns an empty array, no scheduler section is added to the context

### Verification Phase (Tasks 21-22)

1. `npx tsc --noEmit` in project root completes with exit code 0 — no type errors
2. `npx vitest run` passes all existing tests — no regressions from new code
3. `docs/architecture.md` includes CAIO in the agent diagram and has sections for CAIO agent, scheduler service, and external messaging
4. Design doc `docs/plans/2026-02-19-automation-assistant-design.md` has status updated to reflect completed phases

---

## Dependency Graph

```
Task 1 (CAIO prompt) ──────┐
                            ├── Task 2 (CAIO agent def) ──┐
                            │                              │
Task 3 (config/env)  ──────┤                              │
                            │                              │
Task 4 (TaskForge tools) ──┤                              │
                            ├── Task 6 (registry) ────────┤
Task 5 (email tool) ───────┤                              ├── Task 8 (migrate scheduler)
                            │                              ├── Task 9 (register CAIO in router)
                            ├── Task 7 (executor) ────────┤
                            │                              ├── Task 10 (CHAPO delegateToCaio)
                            │                              ├── Task 11 (CHAPO prompt update)
                            │                              ├── Task 12 (ChapoLoop CAIO handler)
                            │                              └── Task 13 (DELEGATE_PARALLEL)
                            │
Task 14 (Telegram route) ──┼── Task 15 (register route)
                            │
Task 16 (ExternalOutput) ──┼── Task 17 (register projection)
                            │
                            ├── Task 18 (wire notifications)
                            ├── Task 19 (wire job executor)
                            ├── Task 20 (scheduler errors)
                            ├── Task 21 (docs)
                            └── Task 22 (verify)
```

Independent tracks that can be parallelized:
- **Track A (Tasks 1-2):** CAIO agent definition
- **Track B (Tasks 4-5):** Tool implementations
- **Track C (Task 3):** Config/env setup
- **Track D (Tasks 14, 16):** Telegram + external output (can start early)

Tasks 6-13 depend on Tracks A + B completing first.
Tasks 15, 17-19 depend on Track D.
