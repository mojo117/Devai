# DevAI Agents Reference

Last updated: 2026-02-22

This document is the canonical reference for the DevAI multi-agent system. It covers agent definitions, the CHAPO decision loop, tools, delegation, and operational commands.

**See also:** [Architecture](./architecture.md) | [CLAUDE.md](../CLAUDE.md)

---

## Overview

DevAI runs a multi-agent system orchestrated by the **CHAPO Decision Loop**:

```
                    +-----------+
                    |   USER    |
                    +-----+-----+
                          |
                          v
              +--------------------------+
              |     CHAPO DECISION LOOP  |
              |                          |
              |  4 Actions:              |
              |  ANSWER | ASK | TOOL |   |
              |       DELEGATE           |
              |         |                |
              |   +-----+------+-----+   |
              |   |      |           |   |
              |   v      v           v   |
              |  DEVO  SCOUT       CAIO  |
              +--------------------------+
```

No separate decision engine — the LLM's `tool_calls` ARE the decisions:
- No tool calls → **ANSWER** (self-validate, respond, exit)
- `askUser` → **ASK** (pause loop, wait for user)
- `delegateToDevo` → **DELEGATE** (run DEVO sub-loop, feed result back)
- `delegateToScout` → **DELEGATE** (run SCOUT exploration, feed result back)
- Any other tool → **TOOL** (execute, feed result back, continue)

Errors at any point feed back into the loop as context — **never crash**.

---

## Agents

### Identity Source of Truth

Agent identity is defined in workspace soul files and must stay consistent with them.

| Agent | Soul File | Usage Rule |
|------|-----------|------------|
| `chapo` | `workspace/SOUL.md` | Embody naturally, never recite verbatim |
| `caio` | `workspace/souls/CAIO.SOUL.md` | Embody naturally, never recite verbatim |
| `devo` | `workspace/souls/DEVO.SOUL.md` | Embody naturally, never recite verbatim |
| `scout` | `workspace/souls/SCOUT.SOUL.md` | Embody naturally, never recite verbatim |

Runtime integration:
- CHAPO identity is loaded via workspace context loader (`apps/api/src/scanner/workspaceMdLoader.ts`).
- CAIO/DEVO/SCOUT identity blocks are loaded via `apps/api/src/prompts/agentSoul.ts` and injected into each agent prompt.

### CHAPO — Task Coordinator

| Property | Value |
|----------|-------|
| **Name** | `chapo` |
| **Role** | Task Coordinator |
| **Model** | `glm-5` (ZAI GLM-5) |
| **Fallback** | `claude-opus-4-5-20251101` (Opus 4.5) |
| **Access** | Read-only + coordination meta-tools |
| **Source** | `apps/api/src/agents/chapo.ts` |
| **Prompt** | `apps/api/src/prompts/chapo.ts` |

**Identity:** Versatile AI agent, orchestrator, and personal assistant. Helps with coding, automation, task management, research, and casual conversation. Responds in the user's language (German/English).

**Capabilities:**
- Direct answers (chat, explanations, brainstorming)
- File reads and codebase search (`fs_listFiles`, `fs_readFile`, `fs_glob`, `fs_grep`)
- Git status checks (`git_status`, `git_diff`)
- Memory management (`memory_remember`, `memory_search`, `memory_readToday`)
- Inbox/obligation control (`chapo_inbox_list_open`, `chapo_inbox_resolve`)
- Lightweight execution planning (`chapo_plan_set`)
- Draft quality gate (`chapo_answer_preflight`, mandatory before final answer when multiple blocking obligations are open)
- Web search via delegation or directly
- Delegation to DEVO for code/devops work
- Delegation to SCOUT for exploration/research
- Ask user for clarification (`askUser`)
- Request approval for risky actions (`requestApproval`)

**Tools:**
```
fs_listFiles, fs_readFile, fs_glob, fs_grep
web_search, web_fetch
git_status, git_diff
github_getWorkflowRunStatus
logs_getStagingLogs
memory_remember, memory_search, memory_readToday
chapo_inbox_list_open, chapo_inbox_resolve, chapo_plan_set, chapo_answer_preflight
delegateToDevo, delegateToCaio, delegateParallel, delegateToScout, askUser, requestApproval, respondToUser
```

---

### DEVO — Developer & DevOps Engineer

| Property | Value |
|----------|-------|
| **Name** | `devo` |
| **Role** | Developer & DevOps Engineer |
| **Model** | `glm-4.7` (ZAI GLM-4.7) |
| **Fallback** | `claude-sonnet-4-20250514` (Sonnet 4) |
| **Access** | Full read/write + bash + SSH + git + PM2 |
| **Source** | `apps/api/src/agents/devo.ts` |
| **Prompt** | `apps/api/src/prompts/devo.ts` |

**Identity:** Expert for code AND infrastructure. Writes/edits code, manages git operations, deployments, server management. Receives tasks from CHAPO with relevant context. Runs as a sub-loop (max 10 turns) when delegated to.

**Capabilities:**
- Full file system operations (read, write, edit, delete, mkdir, move)
- Git operations (status, diff, commit, push, pull, add)
- Bash execution (local commands)
- Persistent exec sessions for long-running commands (`devo_exec_session_start`, `devo_exec_session_write`, `devo_exec_session_poll`)
- SSH execution (remote server commands)
- PM2 management (status, restart, stop/start, reload, save, logs)
- NPM operations (install, run scripts)
- GitHub Actions (trigger workflows, check status)
- Can delegate to SCOUT for research
- Can escalate to CHAPO via `escalateToChapo`

**Tools:**
```
fs_listFiles, fs_readFile, fs_writeFile, fs_edit, fs_mkdir, fs_move, fs_delete, fs_glob, fs_grep
web_search, web_fetch
git_status, git_diff, git_commit, git_push, git_pull, git_add
bash_execute, devo_exec_session_start, devo_exec_session_write, devo_exec_session_poll, ssh_execute
pm2_status, pm2_restart, pm2_stop, pm2_start, pm2_logs, pm2_reloadAll, pm2_save
npm_install, npm_run
github_triggerWorkflow, github_getWorkflowRunStatus
logs_getStagingLogs
memory_remember, memory_search, memory_readToday
skill_create, skill_update, skill_delete, skill_reload, skill_list
delegateToScout, escalateToChapo
```

**Key rules:**
- Always push after commit (`git_push` after `git_commit`)
- New demo websites go into DeviSpace, not apps/web/
- Verify after every operation (check logs, status)

---

### SCOUT — Exploration Specialist

| Property | Value |
|----------|-------|
| **Name** | `scout` |
| **Role** | Exploration Specialist |
| **Model** | `glm-4.7-flash` (ZAI GLM-4.7 Flash — free) |
| **Fallback** | `claude-sonnet-4-20250514` (Sonnet 4) |
| **Access** | Read-only + web tools |
| **Source** | `apps/api/src/agents/scout.ts` |
| **Prompt** | `apps/api/src/prompts/scout.ts` |

**Identity:** Research expert. Explores codebases and searches the web. Never modifies files. Can be spawned by CHAPO or DEVO for research tasks. Max 5 tool calls per invocation.

Web API requirements:
- `web_search` requires `PERPLEXITY_API_KEY`
- `scout_*` Firecrawl tools require `FIRECRAWL_API_KEY`

**Capabilities:**
- Codebase exploration (`fs_readFile`, `fs_glob`, `fs_grep`, `fs_listFiles`)
- Workspace document search (`context_searchDocuments`)
- Git inspection (`git_status`, `git_diff`)
- Web search (`web_search` via Perplexity)
- Firecrawl fast/deep research (`scout_search_fast`, `scout_search_deep`)
- Firecrawl domain exploration (`scout_site_map`, `scout_crawl_focused`)
- Firecrawl structured extraction (`scout_extract_schema`)
- Firecrawl bundled research synthesis (`scout_research_bundle`)
- URL fetching (`web_fetch`)
- Memory operations
- Escalation to CHAPO

**Tools:**
```
fs_listFiles, fs_readFile, fs_glob, fs_grep
git_status, git_diff
github_getWorkflowRunStatus
context_searchDocuments
web_search, web_fetch
scout_search_fast, scout_search_deep, scout_site_map, scout_crawl_focused, scout_extract_schema, scout_research_bundle
memory_remember, memory_search, memory_readToday
escalateToChapo
```

**Response format:** Always returns structured JSON:
```json
{
  "summary": "...",
  "relevantFiles": ["path/to/file.ts"],
  "codePatterns": { "patternName": "description" },
  "webFindings": [{
    "title": "...",
    "url": "...",
    "claim": "...",
    "relevance": "...",
    "evidence": [{ "url": "...", "snippet": "...", "publishedAt": "optional" }],
    "freshness": "published:YYYY-MM-DD | unknown",
    "confidence": "high | medium | low",
    "gaps": ["..."]
  }],
  "recommendations": ["..."],
  "confidence": "high" | "medium" | "low"
}
```

---

### CAIO — Communications & Administration Officer

| Property | Value |
|----------|-------|
| **Name** | `caio` |
| **Role** | Communications & Administration Officer |
| **Model** | `glm-4.5-air` (ZAI GLM-4.5-Air) |
| **Fallback** | `claude-sonnet-4-20250514` (Sonnet 4) |
| **Access** | Read-only filesystem + TaskForge + Email + Scheduler |
| **Source** | `apps/api/src/agents/caio.ts` |
| **Prompt** | `apps/api/src/prompts/caio.ts` |

**Identity:** Administration and communication expert. Manages TaskForge tickets, sends emails, creates scheduler jobs and reminders, delivers documents. Can read files for context gathering.

**Capabilities:**
- Read-only filesystem access (`fs_readFile`, `fs_listFiles`, `fs_glob`)
- Read-only workspace context docs (`context_listDocuments`, `context_readDocument`, `context_searchDocuments`)
- TaskForge ticket management (list, get, create, move, comment, search)
- Email sending (`send_email`)
- Scheduler/reminder management
- Notifications (`notify_user`)
- Document delivery (Telegram, Web-UI)
- Can delegate to SCOUT for research
- Can escalate to CHAPO via `escalateToChapo`

**Tools:**
```
fs_readFile, fs_listFiles, fs_glob
context_listDocuments, context_readDocument, context_searchDocuments
taskforge_list_tasks, taskforge_get_task, taskforge_create_task, taskforge_move_task, taskforge_add_comment, taskforge_search
scheduler_create, scheduler_list, scheduler_update, scheduler_delete, reminder_create
notify_user, send_email
telegram_send_document, deliver_document
memory_remember, memory_search, memory_readToday
delegateToScout, escalateToChapo
```

---

## Agent → Tool Mapping

| Tool | CHAPO | DEVO | SCOUT | CAIO |
|------|:-----:|:----:|:-----:|:----:|
| `fs_listFiles` | x | x | x | x |
| `fs_readFile` | x | x | x | x |
| `fs_writeFile` | | x | | |
| `fs_edit` | | x | | |
| `fs_mkdir` | | x | | |
| `fs_move` | | x | | |
| `fs_delete` | | x | | |
| `fs_glob` | x | x | x | x |
| `fs_grep` | x | x | x | |
| `git_status` | x | x | x | |
| `git_diff` | x | x | x | |
| `git_commit` | | x | | |
| `git_push` | | x | | |
| `git_pull` | | x | | |
| `git_add` | | x | | |
| `bash_execute` | | x | | |
| `devo_exec_session_start` | | x | | |
| `devo_exec_session_write` | | x | | |
| `devo_exec_session_poll` | | x | | |
| `ssh_execute` | | x | | |
| `pm2_status` | | x | | |
| `pm2_restart` | | x | | |
| `pm2_stop` | | x | | |
| `pm2_start` | | x | | |
| `pm2_logs` | | x | | |
| `pm2_reloadAll` | | x | | |
| `pm2_save` | | x | | |
| `npm_install` | | x | | |
| `npm_run` | | x | | |
| `github_triggerWorkflow` | | x | | |
| `github_getWorkflowRunStatus` | x | x | x | |
| `web_search` | x | x | x | |
| `web_fetch` | x | x | x | |
| `scout_search_fast` | | | x | |
| `scout_search_deep` | | | x | |
| `scout_site_map` | | | x | |
| `scout_crawl_focused` | | | x | |
| `scout_extract_schema` | | | x | |
| `scout_research_bundle` | | | x | |
| `context_listDocuments` | | | | x |
| `context_readDocument` | | | | x |
| `context_searchDocuments` | | | x | x |
| `taskforge_*` | | | | x |
| `scheduler_*` | | | | x |
| `memory_remember` | x | x | x | x |
| `memory_search` | x | x | x | x |
| `memory_readToday` | x | x | x | x |
| `logs_getStagingLogs` | x | x | | |
| `skill_*` | list | full | | |
| `notify_user` | | | | x |
| `send_email` | | | | x |
| `chapo_inbox_list_open` | x | | | |
| `chapo_inbox_resolve` | x | | | |
| `chapo_plan_set` | x | | | |
| `chapo_answer_preflight` | x | | | |

## Coordination Meta-Tools

| Tool | Available to | Purpose |
|------|-------------|---------|
| `chapo_inbox_list_open` | CHAPO | List unresolved inbox/obligation items for current task or session |
| `chapo_inbox_resolve` | CHAPO | Resolve one obligation (`done`/`blocked`/`wont_do`/`superseded`) |
| `chapo_plan_set` | CHAPO | Persist a short execution plan with owners and statuses |
| `chapo_answer_preflight` | CHAPO | Preflight-check a draft answer for coverage, contradictions, and unsupported claims |
| `delegateToDevo` | CHAPO | Delegate dev/devops task to DEVO sub-loop |
| `delegateToCaio` | CHAPO | Delegate communication/admin task to CAIO sub-loop |
| `delegateParallel` | CHAPO | Run multiple delegations in parallel |
| `delegateToScout` | CHAPO, DEVO, CAIO | Delegate exploration/research to SCOUT |
| `askUser` | CHAPO | Pause loop and ask user a question |
| `requestApproval` | CHAPO | Request user approval for risky action |
| `respondToUser` | CHAPO | Send an intermediate user-visible response without ending the loop |
| `escalateToChapo` | DEVO, SCOUT, CAIO | Escalate issue back to CHAPO |

---

## CHAPO Decision Loop

**Source:** `apps/api/src/agents/chapo-loop.ts` (~695 lines)

### Configuration

```typescript
interface ChapoLoopConfig {
  selfValidationEnabled: boolean;  // true for non-trivial tasks
  maxIterations: number;           // 8 (trivial) or 20 (standard)
}
```

- **trivial** tasks: 8 iterations, self-validation OFF
- **simple/moderate/complex** tasks: 20 iterations, self-validation ON

### Loop Lifecycle

```
ChapoLoop.run(userMessage, conversationHistory):
  1. Warm system context (devai.md, claude.md, workspace, global context, memory behavior)
  2. Set system prompt on ConversationManager (120k token window)
  3. Load conversation history
  4. Add user message
  5. Enter runLoop()

runLoop() — max N iterations:
  ├── Call LLM with conversation + available tools
  │
  ├── LLM error?
  │   ├── Format error for LLM, add to conversation
  │   └── continue (CHAPO decides on next iteration)
  │
  ├── No tool_calls?
  │   ├── ACTION: ANSWER
  │   ├── Self-validate (if enabled, advisory only)
  │   └── return { status: 'completed', answer }
  │
  └── For each tool_call:
      ├── askUser → ACTION: ASK → return { status: 'waiting_for_user' }
      ├── delegateToDevo → ACTION: DELEGATE → DEVO sub-loop (max 10 turns)
      ├── delegateToScout → ACTION: DELEGATE → SCOUT exploration
      ├── requestApproval → pause and wait for user
      └── any other tool → ACTION: TOOL → execute, feed result back

  Loop exhaustion → ask user if they want to continue
```

### Error Handling

Every async operation wrapped in `AgentErrorHandler.safe()`. Errors classified as: `TIMEOUT`, `RATE_LIMIT`, `NETWORK`, `NOT_FOUND`, `AUTH`, `FORBIDDEN_TOOL`, `TOKEN_LIMIT`, `INTERNAL`, `UNKNOWN`. Max 3 retries per operation category.

### Self-Validation

Before every ANSWER:
1. `SelfValidator.validate(userRequest, proposedAnswer)` calls a lightweight LLM
2. Returns `{ isComplete, confidence, issues, suggestion }`
3. Advisory only — answer is always delivered
4. Skipped for trivial tasks

### Ambiguity Detection

When user sends vague requests (e.g., "Mach das besser"), CHAPO detects this and converts inline clarification responses into proper `askUser` calls, ensuring the UI shows a question prompt.

---

## System Context Loading

**Source:** `apps/api/src/agents/systemContext.ts`

On every new request, `warmSystemContextForSession()` loads (in order):

1. **devai.md** — global DevAI rules (`scanner/devaiMdLoader.ts`)
2. **CLAUDE.md chain** — project-level instructions (`scanner/claudeMdLoader.ts`)
3. **Workspace context** — AGENTS.md, SOUL.md, USER.md, TOOLS.md, daily memory, MEMORY.md (`scanner/workspaceMdLoader.ts`)
4. **Agent Soul blocks** — `workspace/souls/CAIO.SOUL.md`, `workspace/souls/DEVO.SOUL.md`, `workspace/souls/SCOUT.SOUL.md` via `prompts/agentSoul.ts`
5. **Global context** — user-configurable via settings
6. **MEMORY_BEHAVIOR_BLOCK** — rules for memory tool usage (`prompts/context.ts`)

Workspace mode:
- `main`: includes MEMORY.md (default)
- `shared`: excludes MEMORY.md

---

## Memory Architecture

Memory tools are regular tools in the registry, called by CHAPO within the decision loop:

| Tool | Purpose |
|------|---------|
| `memory_remember` | Save note to daily memory, optionally promote to long-term |
| `memory_search` | Search daily + long-term memory |
| `memory_readToday` | Read today's daily memory file |

Storage: Markdown files in workspace directory on Clawd (`/opt/Devai/workspace/`):
- `memory/YYYY-MM-DD.md` — daily memory logs
- `MEMORY.md` — long-term curated memory

---

## Plan Mode

For complex tasks, CHAPO enters Plan Mode before the decision loop:

1. `determinePlanModeRequired()` → true for complex tasks
2. Multi-perspective analysis:
   - `getChapoPerspective()` — strategic analysis, risk, coordination
   - `getDevoPerspective()` — deployment impact, rollback strategy
3. `synthesizePlan()` — merge into ExecutionPlan with tasks
4. User approves/rejects:
   - Approved → `executePlan()` runs tasks sequentially via `executePlanTaskWithLoop()`
   - Rejected → user provides feedback, re-plan

---

## Approval System

Trust mode configured in `config/trust.ts`:
- `trusted`: approvals auto-bypassed for faster execution
- `default`: risky actions require explicit user approval

Tools with `requiresConfirmation: true` go through the approval bridge.

---

## Streaming Protocol

Events streamed via **WebSocket** (`/api/ws/chat`) as JSON. Primary event types:

| Category | Events |
|----------|--------|
| **Agent** | `agent_start`, `agent_thinking`, `agent_switch`, `delegation`, `agent_complete`, `error` |
| **Tool** | `tool_call`, `tool_result`, `action_pending` |
| **Plan** | `plan_start`, `perspective_start`, `perspective_complete`, `plan_ready`, `plan_approval_request`, `plan_approved` |
| **Task** | `task_created`, `task_update`, `task_started`, `task_completed`, `task_failed` |
| **SCOUT** | `scout_start`, `scout_tool`, `scout_complete`, `scout_error` |
| **User** | `user_question`, `approval_request` |
| **System** | `agent_history` |

---

## Operational Commands

### Check Agent Status

```bash
# PM2 process status on Clawd
ssh root@10.0.0.5 "pm2 status"

# API health check
curl -s https://devai.klyde.tech/api/health | jq

# API server logs (last 50 lines)
ssh root@10.0.0.5 "pm2 logs devai-api-dev --lines 50 --nostream"

# Frontend dev server logs
ssh root@10.0.0.5 "pm2 logs devai-dev --lines 50 --nostream"
```

### Check Mutagen Sync

```bash
# Sync status
mutagen sync list | grep devai-dev

# Monitor sync in real-time
mutagen sync monitor devai-dev
```

### Test Agent via WebSocket

The primary interface is WebSocket at `wss://devai.klyde.tech/api/ws/chat`. Send a message:

```json
{
  "type": "message",
  "message": "Hallo, wie geht's?",
  "provider": "anthropic",
  "sessionId": "optional-session-id",
  "projectRoot": "/opt/Klyde/projects/Devai"
}
```

### Test via curl (Health)

```bash
# Health endpoint
curl -s https://devai.klyde.tech/api/health | jq

# Preview URL
curl -I https://devai.klyde.tech
```

### Session Logs

```bash
# List recent session logs on Clawd
ssh root@10.0.0.5 "ls -la /opt/Devai/var/logs/ | tail -10"

# Read a specific session log
ssh root@10.0.0.5 "cat /opt/Devai/var/logs/<session-id>.md"
```

### Git Operations

```bash
# Check current state
cd /opt/Klyde/projects/Devai && git status

# View recent commits
cd /opt/Klyde/projects/Devai && git log --oneline -10

# Push to dev
cd /opt/Klyde/projects/Devai && git push origin dev
```

### Restart Services

```bash
# Restart API server
ssh root@10.0.0.5 "pm2 restart devai-api-dev"

# Restart frontend dev server
ssh root@10.0.0.5 "pm2 restart devai-dev"

# Check after restart
ssh root@10.0.0.5 "pm2 logs devai-api-dev --lines 20 --nostream"
```

---

## File Structure

```
apps/api/src/agents/
├── chapo.ts              # CHAPO agent definition + meta-tools
├── devo.ts               # DEVO agent definition + meta-tools
├── scout.ts              # SCOUT agent definition + meta-tools
├── caio.ts               # CAIO agent definition + meta-tools
├── chapo-loop.ts         # ChapoLoop — core decision loop + inbox check
├── inbox.ts              # SessionInbox queue + event bus (multi-message)
├── router.ts             # processRequest() entry point + Plan Mode
├── error-handler.ts      # AgentErrorHandler (resilient error wrapping)
├── self-validation.ts    # SelfValidator (LLM reviews own answers)
├── conversation-manager.ts  # 120k token sliding window
├── stateManager.ts       # Session state (phases, approvals, questions, isLoopRunning)
├── systemContext.ts       # System context assembly + warming
├── events.ts             # Typed event factory functions
├── types.ts              # All agent/plan/task/scout/inbox types
└── index.ts              # Re-exports

apps/api/src/prompts/
├── chapo.ts              # CHAPO_SYSTEM_PROMPT (German)
├── caio.ts               # CAIO_SYSTEM_PROMPT (German)
├── devo.ts               # DEVO_SYSTEM_PROMPT (German)
├── scout.ts              # SCOUT_SYSTEM_PROMPT (German)
├── agentSoul.ts          # Loads CAIO/DEVO/SCOUT soul blocks from workspace
├── self-validation.ts    # VALIDATION_SYSTEM_PROMPT
├── context.ts            # MEMORY_BEHAVIOR_BLOCK
└── index.ts              # Re-exports

apps/api/src/tools/
├── registry.ts           # UnifiedToolRegistry + all tool definitions
├── executor.ts           # Tool execution engine
├── fs.ts                 # File system tools
├── git.ts                # Git operations
├── github.ts             # GitHub API
├── bash.ts               # Bash execution
├── ssh.ts                # SSH execution
├── web.ts                # Web search/fetch
├── memory.ts             # Memory tools
└── pm2.ts                # PM2 management
```

---

## Server Topology

```
Klyde (46.224.197.7)          Clawd (46.225.162.103 / 10.0.0.5)
  Source code                   Runtime (PM2, Vite)
  /opt/Klyde/projects/Devai     /opt/Devai/
       |                              |
       +--- Mutagen sync (~500ms) --->+
                                      |
                                devai-api-dev (port 3009)
                                devai-dev     (port 3008)
                                      |
                                https://devai.klyde.tech
```

Filesystem restrictions for all agents:
- `/opt/Klyde/projects/DeviSpace`
- `/opt/Klyde/projects/Devai`

SSH host aliases: `baso` → 77.42.90.193 | `klyde` → 46.224.197.7 | `infrit` → 77.42.88.224
