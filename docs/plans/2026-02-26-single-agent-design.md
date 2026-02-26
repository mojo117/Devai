# Single-Agent CHAPO — Design

## Problem

Das aktuelle Multi-Agent-System (CHAPO/DEVO/SCOUT/CAIO) hat drei zusammenhaengende Probleme:

1. **Delegation-Overhead** — CHAPO muss entscheiden, an wen delegiert wird. Das kostet Latenz (extra LLM-Call fuer Routing) und trifft manchmal die falsche Wahl.
2. **Kontextverlust** — Sub-Agenten (DEVO, SCOUT, CAIO) laufen in eigenen Sub-Loops mit separatem Konversationskontext. Informationen aus dem Hauptgespraech gehen verloren oder muessen explizit uebergeben werden.
3. **Wartungskomplexitaet** — 4 Agenten mit eigenen Prompt-Dateien, Tool-Whitelists, Sub-Loop-Logik und Delegation-Routing ergeben eine grosse Angriffsflaeche fuer Bugs.

## Ziel

CHAPO wird zum einzigen Agenten. Alle Tools stehen direkt zur Verfuegung — keine Delegation, keine Sub-Loops, keine Agent-Switches. Der Loop wird einfacher, schneller und behaelt den vollen Kontext.

## Design

### Ein Agent, ein Loop

```
User message --> ChapoLoop.run():
    +-- ANSWER --> Kein Tool-Call, Antwort liefern
    +-- ASK    --> askUser, Loop pausieren
    +-- TOOL   --> Tool ausfuehren, Ergebnis zurueck in Loop

    Error --> Als Kontext zurueckfuettern, CHAPO entscheidet
    Loop-Erschoepfung --> User fragen wie weiter
```

Kein DELEGATE-Pfad mehr. Kein Sub-Agent-Runner. Kein Agent-Switching.

### Tool-Domains im System-Prompt

Alle Tools sind immer verfuegbar. Gruppierung ist rein organisatorisch im Prompt — keine funktionale Trennung:

```
## Filesystem
fs_listFiles, fs_readFile, fs_writeFile, fs_glob, fs_grep, fs_edit,
fs_mkdir, fs_move, fs_delete

## Git & GitHub
git_status, git_diff, git_commit, git_push, git_pull, git_add,
github_triggerWorkflow, github_getWorkflowRunStatus

## DevOps
bash_execute, ssh_execute, pm2_status, pm2_restart, pm2_stop,
pm2_start, pm2_logs, pm2_reloadAll, pm2_save, npm_install, npm_run

## Web & Research
web_search, web_fetch, scout_search_fast, scout_search_deep,
scout_site_map, scout_crawl_focused, scout_extract_schema,
scout_research_bundle

## Kommunikation & Admin
taskforge_list_tasks, taskforge_get_task, taskforge_create_task,
taskforge_move_task, taskforge_add_comment, taskforge_search,
scheduler_create, scheduler_list, scheduler_update, scheduler_delete,
reminder_create, notify_user, send_email, telegram_send_document,
deliver_document

## Memory
memory_remember, memory_search, memory_readToday

## Session
askUser, respondToUser, requestApproval
```

### Was entfaellt

| Komponente | Dateien | Grund |
|-----------|---------|-------|
| DEVO Agent | `agents/devo.ts`, `prompts/devo.ts` | Merged in CHAPO |
| SCOUT Agent | `agents/scout.ts`, `prompts/scout.ts` | Merged in CHAPO |
| CAIO Agent | `agents/caio.ts`, `prompts/caio.ts` | Merged in CHAPO |
| Delegation-Tools | `delegateToDevo`, `delegateToScout`, `delegateToCaio`, `delegateParallel` | Nicht mehr noetig |
| Escalation-Tool | `escalateToChapo` | Kein Sub-Agent der eskalieren muss |
| Sub-Agent-Runner | Sub-Loop-Logik in `chapo-loop.ts` | Ein flacher Loop reicht |
| SelfValidator | `agents/self-validation.ts`, `prompts/self-validation.ts` | Loop-Mechanik deckt das ab |
| Agent-Switching Events | `delegation`, `agent_switch` Stream-Events | Kein Agent-Wechsel mehr |

### Was bleibt

| Komponente | Grund |
|-----------|-------|
| ChapoLoop (vereinfacht) | Kern-Loop: LLM aufrufen, Tools ausfuehren, Ergebnis zurueckfuettern |
| ConversationManager | 180k Sliding Window + Compaction bleibt gleich |
| AgentErrorHandler | Error-Resilience bleibt gleich |
| Inbox/Multi-Message | Funktioniert unabhaengig von der Agent-Anzahl |
| Memory System | Bleibt komplett unveraendert |
| Plan Mode | Bleibt, aber ohne DEVO-Perspektive — nur CHAPO-Perspektive |
| Tool Registry | Bleibt, aber ohne Agent-Whitelists — alle Tools fuer CHAPO |
| Intake Seed / Exit Gate | Bleiben unveraendert |
| Heartbeat | Bleibt, laeuft jetzt direkt als CHAPO-Loop |

### CHAPO System-Prompt Aenderungen

Der CHAPO-Prompt muss erweitert werden um Faehigkeiten, die vorher in DEVO/SCOUT/CAIO-Prompts steckten:

- **DevOps-Verhalten** (aus DEVO): Vorsicht bei destruktiven Operationen, git-Workflow, PM2-Handling
- **Research-Verhalten** (aus SCOUT): Gruendliche Exploration, strukturierte Ergebnisse
- **Kommunikations-Verhalten** (aus CAIO): TaskForge-Workflow, E-Mail-Formulierung, Scheduler-Nutzung

Diese werden als Domain-Abschnitte im Prompt integriert, nicht als separate Prompts.

### Frontend-Aenderungen

| Komponente | Aenderung |
|-----------|-----------|
| `AgentStatus` | Zeigt nur noch "CHAPO" — kein Agent-Switching |
| `AgentHistory` | Keine Delegation-Cards mehr, nur Tool-Calls |
| `ChatUI` | `delegation`/`agent_switch` Events entfernen |
| Delegation Cards | Komplett entfernen (kein Delegation mehr) |

### Stream-Events (bereinigt)

Events die entfallen:
- `delegation` (from/to)
- `agent_switch`
- `scout_start`, `scout_tool`, `scout_complete`

Events die bleiben:
- `agent_start`, `agent_thinking`, `agent_response`, `agent_complete` (immer agent='chapo')
- `tool_call`, `tool_result`
- `plan_*`, `task_*`
- `user_question`, `approval_request`
- `message_queued`, `inbox_processing`, `inbox_classified`
- `system_error`, `heartbeat`

### Test-Umgebung

Separate Umgebung parallel zu dev:

| | Dev (bestehend) | Test (neu) |
|--|--|--|
| Branch | `dev` | `feature/single-agent` |
| Frontend-Port | 3008 | 3011 |
| API-Port | 3009 | 3012 |
| PM2 | `devai-dev` / `devai-api-dev` | `devai-test` / `devai-api-test` |
| Klyde-Pfad | `/opt/Klyde/projects/Devai` | `/opt/Klyde/projects/Devai-test` |
| Clawd-Pfad | `/opt/Devai` | `/opt/Devai-test` |
| Mutagen | `devai-dev` | `devai-test` |

### Risiken

1. **Prompt-Groesse** — Alle Tools + alle Domain-Anweisungen in einem Prompt. Koennte Token-intensiv werden. Mitigation: Prompt schlank halten, YAGNI.
2. **Tool-Ueberflutung** — LLM sieht ~50+ Tools gleichzeitig. Kann Entscheidungsqualitaet senken. Mitigation: Klare Domain-Gruppierung, gute Tool-Descriptions.
3. **Fehlende Spezialisierung** — DEVO/SCOUT hatten fokussierte Prompts fuer ihre Domaene. Ein genereller Prompt koennte weniger praezise sein. Mitigation: Domain-Abschnitte im Prompt.
