# DevAI Agent Reference

Last updated: 2026-02-27

This document is the canonical reference for the DevAI agent system. DevAI uses a **single-agent architecture** with CHAPO handling all tasks directly.

**See also:** [Architecture](./architecture.md) | [CLAUDE.md](../CLAUDE.md)

---

## Overview

DevAI runs a single-agent system with the **CHAPO Decision Loop**:

```
                    +-----------+
                    |   USER    |
                    +-----+-----+
                          |
                          v
              +--------------------------+
              |     CHAPO DECISION LOOP  |
              |                          |
              |  3 Actions:              |
              |  ANSWER | ASK | TOOL     |
              |                          |
              |  76+ tools available     |
              +--------------------------+
```

No separate decision engine -- the LLM's `tool_calls` ARE the decisions:
- No tool calls -> **ANSWER** (validate, respond, exit)
- `askUser` -> **ASK** (pause loop, wait for user)
- Any other tool -> **TOOL** (execute, feed result back, continue)

Errors at any point feed back into the loop as context -- **never crash**.

---

## CHAPO -- Full-Stack AI Agent

| Property | Value |
|----------|-------|
| **Name** | `chapo` |
| **Role** | Full-stack AI agent (development, research, communication, administration) |
| **Model** | Engine-configurable (default: `glm-5` via ZAI) |
| **Fallback** | Engine-configurable (default: `claude-opus-4-5` via Anthropic) |
| **Access** | All tools (filesystem, git, bash, SSH, web, memory, TaskForge, scheduler, email) |
| **Source** | `apps/api/src/agents/chapo.ts` |
| **Prompt** | `apps/api/src/prompts/chapo.ts` |
| **Identity** | `workspace/SOUL.md` |

### Identity

Chapo is a versatile AI agent, orchestrator, and personal assistant. Helps with coding, automation, task management, research, and casual conversation. Responds in the user's language (German/English).

Identity is defined in `workspace/SOUL.md` and loaded via the workspace context loader.

### Capabilities

- **Development**: Full filesystem ops, git, bash, SSH, PM2, npm, GitHub Actions
- **Research**: Web search (Perplexity), Firecrawl tools, codebase exploration
- **Communication**: Email, Telegram documents, notifications
- **Task Management**: TaskForge tickets (CRUD + search + comments)
- **Scheduling**: Cron jobs, reminders, notifications
- **Memory**: Remember facts, search memory, read daily notes
- **Skills**: Create, update, delete, reload custom skills
- **Coordination**: Todo tracking, execution planning, user questions, approval requests

### Tools (76 native + MCP)

| Category | # | Tools |
|----------|---|-------|
| **Filesystem** | 9 | `fs_listFiles`, `fs_readFile`, `fs_writeFile`, `fs_edit`, `fs_mkdir`, `fs_move`, `fs_delete`, `fs_glob`, `fs_grep` |
| **Git** | 6 | `git_status`, `git_diff`, `git_commit`, `git_push`, `git_pull`, `git_add` |
| **GitHub** | 3 | `github_triggerWorkflow`, `github_createPR`, `github_getWorkflowRunStatus` |
| **DevOps** | 15 | `bash_execute`, `ssh_execute`, `exec_session_start`, `exec_session_write`, `exec_session_poll`, `pm2_status`, `pm2_restart`, `pm2_stop`, `pm2_start`, `pm2_logs`, `pm2_reloadAll`, `pm2_save`, `npm_install`, `npm_run`, `logs_getStagingLogs` |
| **Web** | 8 | `web_search`, `web_fetch`, `scout_search_fast`, `scout_search_deep`, `scout_site_map`, `scout_crawl_focused`, `scout_extract_schema`, `scout_research_bundle` |
| **Context** | 3 | `context_listDocuments`, `context_readDocument`, `context_searchDocuments` |
| **Memory** | 3 | `memory_remember`, `memory_search`, `memory_readToday` |
| **History** | 2 | `history_search`, `history_listSessions` |
| **Scheduler** | 6 | `scheduler_create`, `scheduler_list`, `scheduler_update`, `scheduler_delete`, `reminder_create`, `notify_user` |
| **TaskForge** | 6 | `taskforge_list_tasks`, `taskforge_get_task`, `taskforge_create_task`, `taskforge_move_task`, `taskforge_add_comment`, `taskforge_search` |
| **Communication** | 3 | `send_email`, `telegram_send_document`, `deliver_document` |
| **Skills** | 5 | `skill_create`, `skill_update`, `skill_delete`, `skill_reload`, `skill_list` |

Web tooling notes:
- `web_search` uses Perplexity (`PERPLEXITY_API_KEY`)
- `scout_*` Firecrawl tools use `FIRECRAWL_API_KEY`

### Meta-Tools (Coordination)

| Tool | Purpose |
|------|---------|
| `chapo_plan_set` | Persist execution plan with steps, owners, and statuses |
| `todoWrite` | Personal todo list management (pending/in_progress/completed) |
| `askUser` | Pause loop and ask user a question (supports blocking + non-blocking) |
| `requestApproval` | Request user approval for risky actions (low/medium/high risk) |
| `respondToUser` | Send intermediate user-visible response while loop continues |
| `show_in_preview` | Render HTML/content in the frontend preview panel |
| `search_files` | Search for files by name pattern in the workspace |

---

## CHAPO Decision Loop

**Source:** `apps/api/src/agents/chapo-loop.ts`

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
  1. Warm system context (devai.md, claude.md, workspace, memory)
  2. Set system prompt on ConversationManager (180k token window)
  3. Load conversation history
  4. Add user message
  5. Enter runLoop()

runLoop() -- max N iterations:
  +-- Call LLM with conversation + all available tools
  |
  +-- LLM error? -> Feed error as context, continue
  |
  +-- No tool_calls? -> ACTION: ANSWER -> validate -> return
  |
  +-- For each tool_call:
      +-- askUser? -> ACTION: ASK -> return { status: 'waiting_for_user' }
      +-- Any other tool? -> Execute, feed result back, continue

  Loop exhaustion -> ask user if they want to continue
```

### Error Handling

Every async operation wrapped in `AgentErrorHandler.safe()`. Errors classified as: `TIMEOUT`, `RATE_LIMIT`, `NETWORK`, `NOT_FOUND`, `AUTH`, `FORBIDDEN_TOOL`, `TOKEN_LIMIT`, `INTERNAL`, `UNKNOWN`. Max 3 retries per operation category.

### Answer Validation

Before every ANSWER:
1. `AnswerValidator.validateAndNormalize(userRequest, proposedAnswer)` calls a lightweight LLM
2. Returns `{ isComplete, confidence, issues, suggestion }`
3. Advisory only -- answer is always delivered
4. Skipped for trivial tasks

---

## System Context Loading

**Source:** `apps/api/src/agents/systemContext.ts`

On every new request, `warmSystemContextForSession()` loads (in order):

1. **devai.md** -- global DevAI rules
2. **CLAUDE.md chain** -- project-level instructions
3. **Workspace context** -- SOUL.md, daily memory, MEMORY.md
4. **Global context** -- user-configurable via settings
5. **MEMORY_BEHAVIOR_BLOCK** -- rules for memory tool usage

---

## Streaming Protocol

Events streamed via **WebSocket** (`/api/ws/chat`) as JSON:

| Category | Events |
|----------|--------|
| **Agent** | `agent_start`, `agent_phase_change`, `agent_thinking`, `agent_response`, `agent_complete`, `error` |
| **Tool** | `tool_call`, `tool_result`, `tool_approval_required`, `tool_approved`, `tool_rejected` |
| **User** | `user_question`, `user_input_required`, `approval_request` |
| **Todo** | `todo_updated` |
| **Inbox** | `message_queued`, `inbox_processing` |
| **System** | `session_start`, `session_end`, `heartbeat`, `system_error` |

---

## Operational Commands

### Check Status

```bash
# PM2 process status on Clawd
ssh root@10.0.0.5 "pm2 status"

# API health check
curl -s https://devai.klyde.tech/api/health | jq

# API server logs (last 50 lines)
ssh root@10.0.0.5 "pm2 logs devai-api-dev --lines 50 --nostream"
```

### Restart Services

```bash
# Restart API server
ssh root@10.0.0.5 "pm2 restart devai-api-dev"

# Check after restart
ssh root@10.0.0.5 "pm2 logs devai-api-dev --lines 20 --nostream"
```

### Git Operations

```bash
cd /opt/Klyde/projects/Devai && git status
cd /opt/Klyde/projects/Devai && git log --oneline -10
cd /opt/Klyde/projects/Devai && git push origin dev
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

---

## File Structure

```
apps/api/src/agents/
+-- chapo.ts              # CHAPO agent definition (tools + model config)
+-- chapo-loop.ts          # ChapoLoop -- core decision loop
+-- chapo-loop/
|   +-- chapoControlTools.ts  # Meta-tools (plan, todo, respond)
|   +-- contextManager.ts     # Context assembly for LLM calls
|   +-- gateManager.ts        # User questions + approval tracking
|   +-- toolExecutor.ts       # Tool execution with approval bridge
+-- inbox.ts               # SessionInbox queue + event bus (multi-message)
+-- router.ts              # processRequest() entry point
+-- error-handler.ts       # AgentErrorHandler (resilient error wrapping)
+-- answer-validator.ts    # Answer validation (completeness check)
+-- reflexion.ts           # Self-reflection on failures
+-- conversation-manager.ts # 180k token sliding window + compaction
+-- conversationHistory.ts  # Conversation history persistence
+-- stateManager.ts        # Session state (phases, approvals, isLoopRunning)
+-- systemContext.ts       # System context assembly
+-- intakeClassifier.ts    # Fast intake classification for multi-message
+-- events.ts              # Typed event factory functions
+-- types.ts               # All agent/plan/task types
+-- utils.ts               # Shared utilities
+-- index.ts               # Re-exports

apps/api/src/prompts/
+-- chapo.ts               # CHAPO_SYSTEM_PROMPT
+-- agentSoul.ts           # API compatibility stub (returns empty)
+-- context.ts             # MEMORY_BEHAVIOR_BLOCK
+-- index.ts               # Re-exports
```
