# CAIO Agent — Communications & Administration Officer

**Date:** 2026-02-19
**Status:** Planned
**Branch:** dev
**Depends on:** Automation Assistant Design (docs/plans/2026-02-19-automation-assistant-design.md)

## Overview

Third agent for Devai alongside DEVO (developer/DevOps) and SCOUT (research). CAIO owns all external service interactions and project management — tickets, email, notifications, reminders, and scheduler management.

**Why a separate agent:**
1. **Clear work domains** — CHAPO can route decisively without ambiguity
2. **Parallelization** — CHAPO can run DEVO + CAIO simultaneously (fix code while updating tickets)
3. **Focused tool sets** — DEVO stays lean (server/code), CAIO stays lean (communications/admin)

---

## Agent Definition

**Name:** CAIO
**Role:** Communications & Administration Officer
**Model:** `claude-sonnet-4-20250514`
**File:** `apps/api/src/agents/caio.ts`

### Tool Set

| Category | Tools |
|----------|-------|
| Scheduler | `scheduler_create`, `scheduler_list`, `scheduler_update`, `scheduler_delete` |
| Reminders | `reminder_create` |
| Notifications | `notify_user` |
| Email | `send_email` |
| TaskForge | `taskforge_list_tasks`, `taskforge_get_task`, `taskforge_create_task`, `taskforge_move_task`, `taskforge_add_comment`, `taskforge_search` |
| Memory | `memory_remember`, `memory_search`, `memory_readToday` |
| Meta | `escalateToChapo`, `delegateToScout` |

### Capabilities

```typescript
capabilities: {
  canManageScheduler: true,
  canSendNotifications: true,
  canSendEmail: true,
  canManageTaskForge: true,
  canDelegateToScout: true,
  canEscalate: true,
}
```

No file access, no bash, no git, no SSH.

---

## CHAPO Delegation Routing

### Clear-cut routing

| Request type | Agent | Example |
|---|---|---|
| Code, files, git, deploy, PM2, SSH | **DEVO** | "Fix the build", "restart PM2", "push to dev" |
| Codebase search, web research | **SCOUT** | "What does the auth middleware do?" |
| Tickets, email, reminders, scheduler, notifications | **CAIO** | "Create a ticket for this bug", "email a status update" |

### Parallel delegation

New CHAPO action type: `DELEGATE_PARALLEL`. Fires multiple agents concurrently when tasks have no data dependency.

```
DELEGATE_PARALLEL:
  - DEVO: "Fix the failing test in auth.test.ts"
  - CAIO: "Create a bug ticket for the auth test failure with high priority"
```

**When parallel:**
- Tasks with no data dependency between agents (fix code + update ticket)
- Fire-and-forget admin tasks alongside code work (DEVO deploys + CAIO notifies)

**When sequential:**
- Output from one agent feeds the next ("check PM2" → "email the results")
- CHAPO needs to evaluate a result before deciding next step

**Implementation:** In `chapo-loop.ts`, when action is `DELEGATE_PARALLEL`, fire agent calls with `Promise.all()`, merge results. If one fails, the other's result is kept — CHAPO gets both results and decides.

### Delegation hierarchy

```
           CHAPO (orchestrator)
          /      |       \
       DEVO    CAIO    SCOUT
         \       |
          └──→ SCOUT (research delegation)
```

Only CHAPO delegates to DEVO and CAIO. No cross-delegation between DEVO and CAIO. Both can delegate to SCOUT for research. All three can escalate back to CHAPO.

---

## CAIO System Prompt

**Key principles:**
- **Clear, concise writing** — emails, ticket descriptions, digests should be well-composed, not jargon dumps
- **Structured ticket outputs** — follows TaskForge workflow states (`initiierung` → `planung` → `umsetzung` → `review` → `done`), includes descriptions + acceptance criteria
- **Notification awareness** — respects channel hierarchy (job-specific → global default → none). Doesn't spam on "all good" results
- **Context from memory** — uses `memory_search`/`memory_readToday` to compose informed messages
- **No server access** — explicitly cannot read files, run commands, access the server. Escalates to CHAPO if server info is needed

**Language:** System prompt in German (matching DEVO/SCOUT). Responds in the user's language.
**Tone:** Professional but casual — competent assistant, not corporate bot.

---

## Tool Migration from DEVO

Tools moving from DEVO to CAIO:

| Tool | Was DEVO | Now CAIO |
|------|----------|----------|
| `scheduler_create` | Yes | Yes |
| `scheduler_list` | Yes | Yes |
| `scheduler_update` | Yes | Yes |
| `scheduler_delete` | Yes | Yes |
| `reminder_create` | Yes | Yes |
| `notify_user` | Yes | Yes |

New tools (CAIO only):

| Tool | Implementation |
|------|---------------|
| `send_email` | `apps/api/src/tools/email.ts` — Resend REST API |
| `taskforge_list_tasks` | `apps/api/src/tools/taskforge.ts` — wraps `api-project-access` |
| `taskforge_get_task` | Same file |
| `taskforge_create_task` | Same file |
| `taskforge_move_task` | Same file |
| `taskforge_add_comment` | Same file |
| `taskforge_search` | Same file |

---

## Implementation

### New Files

| File | Purpose |
|------|---------|
| `apps/api/src/agents/caio.ts` | Agent definition (tools, capabilities, model, meta-tools) |
| `apps/api/src/prompts/caio.ts` | CAIO system prompt |
| `apps/api/src/tools/email.ts` | `send_email` tool (Resend REST API, no SDK) |
| `apps/api/src/tools/taskforge.ts` | 6 TaskForge tools (wrapping `api-project-access` Appwrite function) |

### Modified Files

| File | Change |
|------|--------|
| `apps/api/src/agents/devo.ts` | Remove 7 tools (6 scheduler + notify_user) |
| `apps/api/src/agents/router.ts` | Add CAIO to agent routing |
| `apps/api/src/agents/chapo-loop.ts` | Add `DELEGATE_PARALLEL` action, add CAIO as delegation target |
| `apps/api/src/prompts/chapo.ts` | Update with CAIO role description + routing rules |
| `apps/api/src/tools/registry.ts` | Add `send_email` + 6 TaskForge tool definitions, register CAIO tools |
| `apps/api/src/tools/executor.ts` | Add execution cases for email + TaskForge tools |

### No Database Changes

CAIO uses existing tables (`scheduled_jobs`, `external_sessions`) and external APIs.

### No New Dependencies

- Resend: plain `fetch()` to `POST https://api.resend.com/emails`
- TaskForge: existing Appwrite function endpoint

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `RESEND_API_KEY` | Resend API authentication |
| `RESEND_FROM_ADDRESS` | Sender address (e.g. `devai@klyde.tech`, requires DNS verification) |
| `DEVAI_TASKBOARD_API_KEY` | Already exists in `.env` |

---

## Implementation Order

| Step | What | Depends on |
|------|------|------------|
| **1** | Create `caio.ts` agent definition + `caio.ts` prompt | — |
| **2** | Create `taskforge.ts` tools (6 tools wrapping API) | — |
| **3** | Create `email.ts` tool (Resend) | — |
| **4** | Register CAIO tools in `registry.ts` + `executor.ts` | Steps 1-3 |
| **5** | Remove scheduler/notify tools from DEVO | Step 4 |
| **6** | Update `router.ts` to include CAIO | Step 1 |
| **7** | Update CHAPO prompt with CAIO routing rules | Step 6 |
| **8** | Add `DELEGATE_PARALLEL` to chapo-loop | Step 6 |

Steps 1-3 are independent and can be done in parallel.
