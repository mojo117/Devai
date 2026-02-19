# Devai Automation Assistant — Design

**Date:** 2026-02-19
**Status:** In Progress — Phases 1-4 complete + resilience fixes
**Branch:** dev

## Overview

Evolve Devai from a web-UI-only developer assistant into a general automation assistant reachable via Telegram. Three new capabilities layered onto the existing CHAPO decision loop:

1. **Telegram messaging** — talk to Devai from your phone
2. **Job scheduler** — cron jobs stored in Supabase, executed by CHAPO
3. **General assistant tools** — reminders, TaskForge management, automated digests

**Core principle:** No new decision-making layer. Telegram and cron are just new input sources into the existing CommandDispatcher → ChapoLoop pipeline. CHAPO calls the shots.

---

## Architecture

```
Telegram webhook ─┐
                  ├──► CommandDispatcher ──► processRequest() ──► ChapoLoop
Web UI (WS)      ─┤    (existing)                                   │
Scheduler (cron) ─┘                                            ┌────┴────┐
                                                               │DEVO  SCOUT│
                                                               └────┬────┘
                                                                    │
                         ┌──────────────────────────────────────────┘
                         ▼
                  Event Bus (existing)
                  ├── StateProjection      (existing)
                  ├── StreamProjection     (existing → WS)
                  ├── AuditProjection      (existing)
                  ├── MarkdownLogProjection (existing)
                  └── ExternalOutputProjection  ◄── NEW: routes responses to Telegram
```

**What stays untouched:**
- CHAPO decision loop (ANSWER / ASK / TOOL / DELEGATE)
- CommandDispatcher routing logic
- All existing tools (fs, git, PM2, web search, memory, context)
- State management, audit logging, session persistence
- Web UI and WebSocket transport

---

## 1. Telegram Integration

### Setup

- New bot via @BotFather — separate token from OpenClaw
- Webhook mode: Telegram POSTs to `https://devai.klyde.tech/api/telegram/webhook`
- Single-user only — verify `chat_id` matches configured ID, reject all others

### Message Flow

```
Telegram message
  → POST /api/telegram/webhook
  → Parse update (text, chatId, userId)
  → Look up session in external_sessions table
  → CommandDispatcher.dispatch({ type: 'external_message', ... })
  → processRequest() → ChapoLoop
  → ExternalOutputProjection catches WF_COMPLETED
  → Telegram Bot API: sendMessage(chatId, response)
```

### Gate Handling (Approvals / Questions)

When CHAPO triggers `askUser`, the ExternalOutputProjection sends the question to Telegram. User's reply comes back as another webhook POST, mapped to `user_question_answered` command. Same flow as web UI, different transport.

### New Route

**`apps/api/src/routes/external.ts`**

Single route file for external platform webhooks. Starts with Telegram only. Handles:
- Incoming messages → `external_message` command
- Reply to gates → `user_question_answered` / `user_approval_decided`
- Webhook verification (Telegram sends a verification challenge)

### New Projection

**`apps/api/src/workflow/projections/externalOutputProjection.ts`**

Listens for:
- `WF_COMPLETED` — sends final response to originating platform
- `GATE_QUESTION_QUEUED` — sends question to platform
- `GATE_APPROVAL_QUEUED` — sends approval request to platform
- Scheduler notification events — sends cron results / alerts

Registered alongside existing projections in `workflow/projections/index.ts`.

### Database: `external_sessions`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid | PK |
| `platform` | text | `telegram` (extensible later) |
| `external_user_id` | text | Telegram userId |
| `external_chat_id` | text | Where to send responses |
| `session_id` | uuid | FK to Devai session |
| `is_default_channel` | boolean | Default notification target |
| `created_at` | timestamptz | |

### Global Setting

`default_notification_channel` in settings table — points to one `external_sessions` row. All cron notifications, reminders, and digests go there unless overridden per job.

---

## 2. Job Scheduler

### Design

In-process scheduler inside Devai's API. No edge functions, no external services.

- On startup: load enabled jobs from Supabase, register with croner
- On fire: create `scheduled_job` command, dispatch through CommandDispatcher
- CHAPO gets the job instruction, delegates to DEVO/SCOUT as needed
- After execution: update `last_run_at` + `last_result`, send to notification channel

### Database: `scheduled_jobs`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid | PK |
| `name` | text | Human label ("Morning PM2 check") |
| `cron_expression` | text | Standard cron (`0 8 * * *`) |
| `instruction` | text | Natural language task for CHAPO |
| `notification_channel` | text | null = use global default |
| `enabled` | boolean | Pause/resume without deleting |
| `one_shot` | boolean | Auto-disable after first execution (for reminders) |
| `status` | text | `active`, `disabled_by_error`, `paused` |
| `consecutive_failures` | integer | Resets on success |
| `last_run_at` | timestamptz | |
| `last_result` | text | Summary of last execution |
| `last_error_at` | timestamptz | |
| `created_at` | timestamptz | |

### Error Handling

| Scenario | Behavior |
|----------|----------|
| Transient error (timeout, connection refused) | Retry once after 60s. If retry fails → notify user, wait for next run |
| 3 consecutive failures | Auto-disable job, notify user: "Disabled 'X' after 3 failures" |
| LLM rate limit / CHAPO loop error | Same retry-once. Don't burn credits in a loop |

### CHAPO Context Injection

Recent scheduler errors (last 20) stored in a ring buffer. Injected into CHAPO's system context alongside workspace memory and pending approvals. CHAPO can proactively mention: "By the way, your morning PM2 check has been failing for 3 days."

### Lightweight Execution

Scheduled jobs run in a "system" session — no conversation history accumulation. Fire, execute, report, done.

### Resilience & Known Limitations

**Fixed:**

| Issue | Fix |
|-------|-----|
| **Reminder fires yearly** (critical) | Changed `reminderCreate` from cron expression (`min hour day month *`) to ISO 8601 datetime string — croner treats this as a one-time execution |
| **Overlapping executions** | Added `protect: true` to croner options — if a job is still running when the next tick fires, the tick is skipped |

**Accepted limitations (single-user, single-process):**

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| **No catch-up for missed runs** | If API is down during a cron tick, that run is silently skipped | Acceptable for monitoring/digest jobs. One-shot reminders are the only risk — user can recreate |
| **PM2 reload gap** | Brief window during PM2 restart where no scheduler is running | PM2 `fork` mode stops old → starts new, gap is <1s. `protect: true` prevents double-fire in edge cases |
| **No timezone support** | All cron expressions use server time (Europe/Berlin on Klyde) | Future: add `timezone` column to `scheduled_jobs`, pass to croner `{ timezone }` option. DEVO tool already accepts ISO 8601 for reminders (timezone-aware) |
| **In-memory state lost on restart** | Ring buffer (recent errors) resets | Error history is also in DB (`last_error_at`, `consecutive_failures`). Ring buffer is convenience for CHAPO context, not critical |

### New DEVO Tools

```
scheduler_create(name, cron_expression, instruction, notification_channel?)
scheduler_list() → all jobs with status and last result
scheduler_update(id, fields)
scheduler_delete(id)
reminder_create(message, datetime) → creates one_shot scheduled job
notify_user(message, channel?) → send to default or specified channel
```

---

## 3. General Assistant Features

### 3a. Reminders

A reminder is a one-shot scheduled job. No separate table, no separate logic.

`reminder_create("Review the PR", "2026-02-20T09:00")`
→ inserts into `scheduled_jobs` with `one_shot: true`
→ fires at specified time, sends message, auto-disables

### 3b. TaskForge Integration

Devai already has the `api-project-access` Appwrite function wired up. New DEVO tools that wrap it:

```
taskforge_list_tasks(project?, status?)
taskforge_get_task(task_id)
taskforge_create_task(title, description, status?)
taskforge_move_task(task_id, new_status)
taskforge_add_comment(task_id, comment)
taskforge_search(query)
```

API key already in `.env` on Clawd (`DEVAI_TASKBOARD_API_KEY`).

### 3c. Send Email (Resend API)

New DEVO tool for sending emails. Uses [Resend](https://resend.com/) — simple API, generous free tier (100 emails/day).

```
send_email(to, subject, body, replyTo?)
```

**Implementation:**
- Single function in `apps/api/src/tools/email.ts`
- Uses Resend REST API directly (`POST https://api.resend.com/emails`) — no SDK needed
- `RESEND_API_KEY` in `.env`
- `RESEND_FROM_ADDRESS` in `.env` (e.g. `devai@klyde.tech` — requires DNS verification)
- Register in `registry.ts` as a standard DEVO tool
- Permission level: requires confirmation (sending email is an external side effect)

**Use cases:**
- DEVO sends email reports (daily digest results, scheduler notifications)
- User asks: "email me a summary of today's work"
- Scheduled job instruction: "Check PM2 and email me if anything is down"

**Why Resend:**
- REST API, no SDK dependency
- Free tier sufficient for single-user automation
- Simple domain verification via DNS TXT record
- Markdown → HTML rendering built-in

### 3d. Daily/Weekly Digests

A digest is a scheduled job with a rich instruction. No special engine.

Example: user says "every morning at 8 give me a briefing"
→ DEVO creates scheduled job with instruction:
"Run a morning briefing: 1) Check PM2 status for all projects. 2) Check open GitHub PRs. 3) List in-progress tasks from TaskForge. Summarize concisely."
→ When it fires, CHAPO executes like any other request, sends result to Telegram.

---

## 4. Clean Coding Goals

### Avoid Redundancy

- **Reminders = scheduled jobs.** No separate reminder system — `one_shot: true` flag on the same table.
- **Digests = scheduled jobs.** No digest engine — just a well-written cron instruction.
- **External messaging reuses CommandDispatcher.** No parallel message-handling pipeline.
- **ExternalOutputProjection follows the existing projection pattern.** Same registration, same interface, same lifecycle as the 4 existing projections.
- **DEVO tools follow existing tool registration pattern.** Same `registry.ts`, same permission model, same audit logging.

### Single Responsibility

| Component | Does ONE thing |
|-----------|---------------|
| `routes/external.ts` | Parses platform webhooks into commands |
| `ExternalOutputProjection` | Routes events back to external platforms |
| `SchedulerService` | Loads jobs, manages croner, fires commands |
| DEVO tools | CRUD for scheduler + TaskForge + notify |

No tool does dispatch. No route does business logic. No projection does database writes.

### Patterns to Follow

- **New tools** follow the same shape as existing tools in `registry.ts` — name, description, parameters schema, execute function, permission level
- **New routes** follow existing route patterns — Fastify plugin, auth hook, typed request/response
- **New projection** implements the same `Projection` interface — `name`, `handles(eventType)`, `apply(event)`
- **Database migrations** as Supabase SQL migrations — same as existing tables

### What NOT to Build

- No separate "automation engine" — CHAPO IS the engine
- No message queue (Redis, Bull, etc.) — in-process `node-cron` is sufficient for single-user
- No Discord integration yet — Telegram first, expand later if needed
- No multi-user support — single verified user per platform
- No media handling in v1 — text messages only

---

## 5. Documentation Updates

After implementation, update:

| Document | Changes |
|----------|---------|
| `docs/architecture.md` | Add Scheduler Service section, External Messaging section, updated architecture diagram |
| `CLAUDE.md` | Add scheduler tools to Quick Commands, add Telegram webhook info |
| `docs/agents.md` | Add new DEVO tools (scheduler, TaskForge, notify) to tool reference |
| `README.md` | Add Telegram setup instructions, scheduler overview |
| `.env.example` | Add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_ID`, `RESEND_API_KEY`, `RESEND_FROM_ADDRESS` |

---

## 6. Implementation Order

| Phase | What | Depends on | Status |
|-------|------|------------|--------|
| **1** | Supabase migrations (`scheduled_jobs`, `external_sessions`) | — | **DONE** |
| **2** | SchedulerService (croner + DB loader + error handling + resilience) | Phase 1 | **DONE** |
| **3** | DEVO scheduler tools (`scheduler_create/list/update/delete`, `reminder_create`) | Phase 2 | **DONE** |
| **4** | `notify_user` tool + global notification channel setting | Phase 1 | **DONE** (placeholder notifier, wired to Telegram in Phase 7) |
| **5** | Telegram webhook route (`routes/external.ts`) | Phase 1 | TODO |
| **6** | ExternalOutputProjection | Phase 5 | TODO |
| **7** | Wire Telegram as notification channel for scheduler | Phase 4 + 6 | TODO |
| **8** | DEVO TaskForge tools | — (independent) | TODO |
| **9** | CHAPO context injection for scheduler errors | Phase 2 | TODO |
| **10** | `send_email` tool (Resend API) | — (independent) | TODO |
| **11** | Documentation updates | All phases | TODO |

### Files Created (Phases 1-4)

| File | Purpose |
|------|---------|
| `apps/api/src/db/schedulerQueries.ts` | DB queries for scheduled_jobs + external_sessions |
| `apps/api/src/scheduler/schedulerService.ts` | Singleton scheduler service (croner + error handling) |
| `apps/api/src/tools/scheduler.ts` | DEVO tool implementations |
| `supabase/migrations/20260219_scheduler_and_external_sessions.sql` | DB migration |

### Files Modified (Phases 1-4)

| File | Change |
|------|--------|
| `apps/api/supabase-schema.sql` | Added scheduled_jobs + external_sessions tables |
| `apps/api/src/tools/registry.ts` | Added 6 scheduler tool definitions + ToolName union |
| `apps/api/src/tools/executor.ts` | Added scheduler tool execution cases |
| `apps/api/src/agents/devo.ts` | Granted DEVO access to scheduler tools |
| `apps/api/src/server.ts` | Scheduler startup + shutdown hooks |

Phases 5-7 (Telegram) are next. Phase 8 (TaskForge), Phase 10 (Resend email) are independent.

---

## 7. Verification Checklist

- [ ] Create a scheduled job via web UI chat: "check PM2 every hour"
- [ ] Job fires, CHAPO delegates to DEVO, result stored in `last_result`
- [ ] Force a job failure → notification sent, `consecutive_failures` incremented
- [ ] 3 failures → job auto-disabled, user notified
- [ ] Set up Telegram bot, send a message → response comes back
- [ ] Create a job via Telegram: "remind me in 1 hour to check the deploy"
- [ ] Reminder fires → Telegram notification received
- [ ] Ask via Telegram: "what's in my Devai backlog?" → TaskForge results returned
- [ ] Set Telegram as default notification channel → cron results go there
- [ ] Restart API → all jobs reload from DB and continue running
- [ ] CHAPO mentions scheduler errors proactively in conversation
