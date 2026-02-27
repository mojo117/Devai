# Single-Agent CHAPO — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Merge DEVO, SCOUT, and CAIO into a single CHAPO agent. Remove all delegation, sub-loops, and agent-switching. CHAPO calls all tools directly in one flat loop.

**Design doc:** `docs/plans/2026-02-26-single-agent-design.md`

**Branch:** `feature/single-agent` (off `dev`)

**Test env:** Separate worktree + PM2 on ports 3011/3012

---

### Task 0: Setup — Branch, Worktree, Test Environment

**Goal:** Isolated environment so dev (3008/3009) stays untouched.

**Step 1: Create feature branch**
```bash
cd /opt/Klyde/projects/Devai
git checkout dev
git pull origin dev
git checkout -b feature/single-agent
git push -u origin feature/single-agent
```

**Step 2: Create worktree on Klyde**
```bash
mkdir -p /opt/Klyde/projects/Devai-test
cd /opt/Klyde/projects/Devai
git worktree add /opt/Klyde/projects/Devai-test feature/single-agent
```

**Step 3: Create target directory on Clawd + install deps**
```bash
ssh root@10.0.0.5 "mkdir -p /opt/Devai-test"
```

**Step 4: Create Mutagen sync session**
```bash
mutagen sync create \
  /opt/Klyde/projects/Devai-test \
  root@10.0.0.5:/opt/Devai-test \
  --name devai-test \
  --ignore-vcs \
  --ignore "node_modules" \
  --ignore ".next" \
  --ignore "dist"
```

Wait for initial sync, then install deps on Clawd:
```bash
ssh root@10.0.0.5 "cd /opt/Devai-test && npm install"
```

**Step 5: Add PM2 processes on Clawd**

Create ecosystem file or add to existing. Two new processes:
- `devai-test` — Vite frontend on port 3011
- `devai-api-test` — Fastify API on port 3012

```bash
ssh root@10.0.0.5 "cd /opt/Devai-test && PORT=3011 pm2 start npm --name devai-test -- run dev:web"
ssh root@10.0.0.5 "cd /opt/Devai-test && PORT=3012 pm2 start npm --name devai-api-test -- run dev:api"
ssh root@10.0.0.5 "pm2 save"
```

Note: Check the actual npm scripts in `package.json` — the port override mechanism may use `VITE_PORT`/`API_PORT` env vars instead. Adjust accordingly.

**Step 6: Verify test env**
```bash
ssh root@10.0.0.5 "pm2 status"
ssh root@10.0.0.5 "curl -s http://localhost:3012/api/health"
```

**Acceptance:** Both PM2 processes running, API health check returns 200, dev env (3008/3009) unaffected.

---

### Task 1: Simplify Types — Remove Multi-Agent Types

**Files:**
- Modify: `apps/api/src/agents/types.ts`

**Step 1: Simplify AgentName**

```typescript
// Before (line 9):
type AgentName = 'chapo' | 'devo' | 'scout' | 'caio';

// After:
type AgentName = 'chapo';
```

**Step 2: Remove DelegationDomain type** (line 14)

Delete:
```typescript
type DelegationDomain = 'development' | 'communication' | 'research';
```

**Step 3: Remove delegation capability flags from AgentCapabilities** (lines 66-75)

Remove these fields:
- `canDelegateToDevo`
- `canDelegateToCaio`
- `canDelegateToScout`
- `canEscalate`

Keep all tool-capability flags (`canWriteFiles`, `canEditFiles`, `canExecuteBash`, `canSSH`, `canGitCommit`, `canManagePM2`, `canManageScheduler`, `canSendEmail`, `canManageTaskForge`, etc.) — CHAPO now has all of them.

**Step 4: Remove delegation types** (lines 109-138)

Delete:
- `DelegationTask` interface
- `DelegationResult` interface
- `ExecutedTool` interface
- `LoopDelegationStatus` type (line 434)
- `LoopDelegationResult` interface (lines 453-459)

**Step 5: Remove delegation stream events** (lines 343-384)

Remove from `AgentStreamEvent` union:
- `{ type: 'agent_switch'; from: AgentName; to: AgentName; ... }`
- `{ type: 'delegation'; from: AgentName; to: AgentName; ... }`
- `{ type: 'parallel_start'; agents: AgentName[]; ... }`
- `{ type: 'parallel_complete'; results: DelegationResult[] }`
- `{ type: 'scout_start'; ... }`
- `{ type: 'scout_tool'; ... }`
- `{ type: 'scout_complete'; ... }`
- `{ type: 'scout_error'; ... }`
- `{ type: 'escalation'; ... }`

Keep: `agent_start`, `agent_thinking`, `agent_response`, `agent_complete`, `tool_call`, `tool_result`, `plan_*`, `task_*`, `user_question`, `approval_request`, `message_queued`, `inbox_*`, `system_error`, `heartbeat`, `partial_response`, `todo_updated`.

**Step 6: Clean up any remaining references**

Search for `DelegationDomain`, `DelegationTask`, `DelegationResult`, `ExecutedTool`, `LoopDelegationResult`, `ScoutResult`, `ScoutFindings`, `ParallelDelegation`, `ParallelDelegationSummary` across the codebase. Remove or replace all usages.

**Acceptance:** TypeScript compiles with no errors referencing removed types.

---

### Task 2: Merge All Tools into CHAPO Agent Definition

**Files:**
- Modify: `apps/api/src/agents/chapo.ts`

**Step 1: Merge tool lists**

Update `CHAPO_AGENT.tools` to include ALL tools from DEVO, SCOUT, and CAIO. Organize by domain with comments:

```typescript
export const CHAPO_AGENT: AgentDefinition = {
  name: 'chapo',
  role: 'AI Assistant',
  model: 'glm-5',
  fallbackModel: 'claude-opus-4-5-20251101',
  capabilities: {
    // All capabilities merged
    canWriteFiles: true,
    canEditFiles: true,
    canDeleteFiles: true,
    canCreateDirectories: true,
    canExecuteBash: true,
    canSSH: true,
    canGitCommit: true,
    canGitPush: true,
    canTriggerWorkflows: true,
    canManagePM2: true,
    canManageScheduler: true,
    canSendNotifications: true,
    canSendEmail: true,
    canManageTaskForge: true,
    canAskUser: true,
    canRequestApproval: true,
  },
  tools: [
    // -- Filesystem --
    'fs_listFiles', 'fs_readFile', 'fs_writeFile', 'fs_edit',
    'fs_mkdir', 'fs_move', 'fs_delete', 'fs_glob', 'fs_grep',

    // -- Git & GitHub --
    'git_status', 'git_diff', 'git_commit', 'git_push', 'git_pull', 'git_add',
    'github_triggerWorkflow', 'github_createPR', 'github_getWorkflowRunStatus',

    // -- DevOps --
    'bash_execute', 'ssh_execute',
    'exec_session_start', 'exec_session_write', 'exec_session_poll',
    'pm2_status', 'pm2_restart', 'pm2_stop', 'pm2_start', 'pm2_logs',
    'pm2_reloadAll', 'pm2_save',
    'npm_install', 'npm_run',

    // -- Web & Research --
    'web_search', 'web_fetch',
    'scout_search_fast', 'scout_search_deep', 'scout_site_map',
    'scout_crawl_focused', 'scout_extract_schema', 'scout_research_bundle',

    // -- Context --
    'context_listDocuments', 'context_readDocument', 'context_searchDocuments',

    // -- Communication & Admin --
    'taskforge_list_tasks', 'taskforge_get_task', 'taskforge_create_task',
    'taskforge_move_task', 'taskforge_add_comment', 'taskforge_search',
    'scheduler_create', 'scheduler_list', 'scheduler_update', 'scheduler_delete',
    'reminder_create', 'notify_user', 'send_email',
    'telegram_send_document', 'deliver_document',

    // -- Memory --
    'memory_remember', 'memory_search', 'memory_readToday',

    // -- Session & Control --
    'askUser', 'respondToUser', 'requestApproval',
    'chapo_plan_set', 'show_in_preview', 'search_files', 'todoWrite',

    // -- Logs --
    'logs_getStagingLogs',
  ],
  systemPrompt: CHAPO_SYSTEM_PROMPT,
};
```

**Step 2: Remove CHAPO_META_TOOLS delegation entries**

Remove `delegateToDevo`, `delegateToCaio`, `delegateToScout`, `delegateParallel` from any meta-tools array or tool list.

**Step 3: Remove `registerMetaTools` / `registerAgentTools` calls**

The DEVO/SCOUT/CAIO files called these. They'll be deleted in Task 4, but ensure CHAPO's tools are registered properly — likely via a single `registerAgentTools('chapo', CHAPO_AGENT.tools)` call.

**Acceptance:** CHAPO_AGENT has all tools, no delegation tools remain.

---

### Task 3: Simplify ChapoLoop — Remove Delegation Dispatch

**Files:**
- Modify: `apps/api/src/agents/chapo-loop/toolExecutor.ts` (main changes)
- Modify: `apps/api/src/agents/chapo-loop.ts` (minor cleanup)
- Delete: `apps/api/src/agents/chapo-loop/delegationRunner.ts`
- Delete: `apps/api/src/agents/chapo-loop/delegationUtils.ts`
- Delete: `apps/api/src/agents/chapo-loop/caioEvidence.ts`

**Step 1: Simplify toolExecutor.ts**

The `execute()` method (line 76-461) has a big switch statement. Remove these cases:

- `delegateParallel` case (lines 277-336) — delete entirely
- `resolveDelegationTarget()` case (lines 339-380) — delete entirely (this handles `delegateToDevo`, `delegateToCaio`, `delegateToScout`)
- `escalateToChapo` — no longer needed, delete if present

Keep:
- `chapo_plan_set` case
- `show_in_preview` case
- `search_files` case
- `todoWrite` case
- `respondToUser` case
- `askUser` case
- `requestApproval` case
- Default TOOL execution case (line 391-461)

**Step 2: Remove delegation imports from toolExecutor.ts**

Remove imports of:
- `delegateToAgent`, `runParallelDelegations` from `delegationRunner.ts`
- `buildDelegation`, `parseParallelDelegations`, `formatDelegationContext` from `delegationUtils.ts`
- `buildVerificationEnvelope` and related delegation result types

**Step 3: Remove delegation logging from chapo-loop.ts**

- Remove `delegationLog` array (instance field)
- Remove delegation metrics from the logging block (lines 280-296)
- Remove any `agent_switch` event emissions

**Step 4: Delete delegation files**

```bash
rm apps/api/src/agents/chapo-loop/delegationRunner.ts
rm apps/api/src/agents/chapo-loop/delegationUtils.ts
rm apps/api/src/agents/chapo-loop/caioEvidence.ts
```

**Step 5: Clean up barrel exports**

Update `apps/api/src/agents/chapo-loop/index.ts` (if exists) or any barrel file that re-exports delegation modules.

**Acceptance:** ChapoLoop processes all tool calls directly via the default TOOL path. No delegation code remains. TypeScript compiles.

---

### Task 4: Delete Sub-Agent Files

**Files to delete:**
- `apps/api/src/agents/devo.ts`
- `apps/api/src/agents/scout.ts`
- `apps/api/src/agents/caio.ts`
- `apps/api/src/prompts/devo.ts`
- `apps/api/src/prompts/scout.ts`
- `apps/api/src/prompts/caio.ts`
- `apps/api/src/prompts/self-validation.ts`
- `apps/api/src/agents/self-validation.ts` (if exists)
- `apps/api/src/agents/router/scoutRuntime.ts`
- `apps/api/src/agents/router/agentAccess.ts` (simplify or delete — see below)

**Files to modify:**
- `apps/api/src/agents/index.ts` — remove re-exports of DEVO_AGENT, SCOUT_AGENT, CAIO_AGENT
- `apps/api/src/prompts/index.ts` — remove re-exports of DEVO/SCOUT/CAIO/self-validation prompts
- `apps/api/src/agents/router/agentAccess.ts` — if kept, simplify to only CHAPO:
  ```typescript
  const AGENTS: Record<AgentName, AgentDefinition> = {
    chapo: CHAPO_AGENT,
  };
  ```
  Or inline the logic and delete the file.

**Step: Remove all imports of deleted files across the codebase**

Search for:
- `import.*from.*devo`
- `import.*from.*scout`
- `import.*from.*caio`
- `import.*from.*self-validation`
- `import.*from.*scoutRuntime`
- `DEVO_AGENT`, `SCOUT_AGENT`, `CAIO_AGENT`
- `DEVO_SYSTEM_PROMPT`, `SCOUT_SYSTEM_PROMPT`, `CAIO_SYSTEM_PROMPT`
- `spawnScout`

Remove or replace all references.

**Acceptance:** No file references DEVO, SCOUT, or CAIO agents. TypeScript compiles.

---

### Task 5: Update CHAPO System Prompt — Merge Domain Behaviors

**Files:**
- Modify: `apps/api/src/prompts/chapo.ts`

**Goal:** CHAPO's prompt needs to absorb the key behavioral rules from DEVO, SCOUT, and CAIO prompts. NOT a copy-paste — distill the essential rules.

**Step 1: Remove "Your Team" section** (lines 59-87)

Delete the entire delegation strategy section that describes DEVO/SCOUT/CAIO.

**Step 2: Remove DELEGATE from "How Your Loop Works"** (lines 30-51)

Simplify the decision paths from 5 to 3:
- ANSWER — respond directly
- ASK — pause and ask user
- TOOL — execute a tool

**Step 3: Add domain-specific behavior blocks**

Add concise sections covering critical rules from each former agent:

```
## Development & DevOps
- Understand before touching — read state, plan, execute, verify after each change
- File system access restricted to: /opt/Devai, /opt/Klyde/projects/Devai, /opt/Klyde/projects/DeviSpace
- Git: always work on dev branch, never push to main/staging
- Destructive operations (rm, git push --force): ask user first
- Server context: Clawd (10.0.0.5) runs the app, Klyde (46.224.197.7) has the source

## Research & Exploration
- Use web_search/web_fetch for current information
- Use scout_* Firecrawl tools for deep web research
- Back claims with evidence — cite sources
- Keep research focused — don't explore endlessly

## Communication & Administration
- TaskForge: always comment when moving tasks, document what was done
- Scheduling: use Europe/Berlin timezone (UTC+1/UTC+2 DST)
- Email: professional tone, include context
- Always execute tools — never claim "done" without actual tool calls as evidence
```

**Step 4: Keep prompt lean**

Target: ~200-250 lines total. No redundancy. YAGNI.

**Acceptance:** CHAPO prompt covers all domains without mentioning DEVO/SCOUT/CAIO. Reads as one coherent agent personality.

---

### Task 6: Clean Up Event System

**Files:**
- Modify: `apps/api/src/agents/events.ts`

**Step 1: Remove delegation event factories**

From `AgentEvents`, remove:
- `switch()` — no more agent switching
- `delegation()` — no more delegation events
- `escalation()` — no more escalation

**Step 2: Remove ScoutEvents entirely**

Delete the entire `ScoutEvents` export object (`scout_start`, `scout_tool`, `scout_complete`, `scout_error`).

**Step 3: Remove ParallelEvents (agent-level)**

Delete `ParallelEvents` export object (`parallel_start`, `parallel_progress`, `parallel_complete`).

Note: If parallel CHAPO loops (the multi-message parallel feature from the parallel-loops design) use different events, keep those. Only remove agent-delegation parallelism events.

**Step 4: Clean up AgentEvents.complete()**

Remove `delegationStatus` optional field if present.

**Acceptance:** Events file only contains CHAPO-relevant events. No delegation/scout/parallel-agent references.

---

### Task 7: Clean Up Tool Registry

**Files:**
- Modify: `apps/api/src/tools/registry.ts`

**Step 1: Remove agent-level access control**

The `UnifiedToolRegistry` has `agentAccess` map and methods `grantAccessAll()`, `canAccess()`, `getAgentTools()`. Since there's only one agent now, simplify:

Option A (minimal change): Keep the structure but only register CHAPO.
Option B (clean): Remove the `agentAccess` map entirely. All tools are available. Replace `canAccess()` with a simple `has()` check.

**Prefer Option A** for now — less risk, easy to extend later if needed.

**Step 2: Remove delegation tool definitions**

Remove tool definitions for:
- `delegateToDevo`
- `delegateToCaio`
- `delegateToScout`
- `delegateParallel`
- `escalateToChapo`

These should be in the registry or inlined in meta-tool arrays.

**Step 3: Update tool executor**

In `apps/api/src/tools/executor.ts`, remove any agent-specific execution paths. All tools should route through the same execution logic regardless of who calls them.

**Acceptance:** Registry contains all tools, no delegation tools, no multi-agent access control.

---

### Task 8: Frontend Cleanup

**Files:**
- Modify: `apps/web/src/components/AgentStatus.tsx`
- Delete or simplify: `apps/web/src/components/ChatUI/DelegationCard.tsx`
- Modify: `apps/web/src/components/ChatUI.tsx` (or wherever events are handled)
- Modify: `apps/web/src/types.ts` (if frontend types mirror backend AgentName)

**Step 1: Simplify AgentStatus.tsx**

Remove the `agentInfo` mapping for devo/scout/caio. Only show CHAPO:
```typescript
// Before: Record<AgentName, { name, role, color, icon }>
// After: single CHAPO display, or remove the component entirely if unnecessary
```

**Step 2: Delete DelegationCard.tsx**

Remove the entire component. No more delegation events to render.

**Step 3: Update ChatUI event handling**

Remove handlers for:
- `delegation` event
- `agent_switch` event
- `scout_start`, `scout_tool`, `scout_complete`, `scout_error` events
- `parallel_start`, `parallel_complete` events
- `escalation` event

Keep:
- `agent_start`, `agent_thinking`, `agent_response`, `agent_complete` (always agent='chapo')
- `tool_call`, `tool_result`
- All plan, task, inbox, user, system events

**Step 4: Update frontend types**

If `apps/web/src/types.ts` or `apps/shared/` defines `AgentName`, update to just `'chapo'`. Remove `DelegationData`, `DelegationDomain`, etc.

**Acceptance:** Frontend compiles, no references to devo/scout/caio, DelegationCard gone.

---

### Task 9: Clean Up Router

**Files:**
- Modify: `apps/api/src/agents/router/requestFlow.ts`
- Modify or delete: `apps/api/src/agents/router/agentAccess.ts`
- Delete: `apps/api/src/agents/router/scoutRuntime.ts`

**Step 1: Simplify requestFlow.ts**

Remove any agent routing logic. `processRequest()` should go straight into ChapoLoop without delegation decisions.

If Plan Mode currently uses `getDevoPerspective()` — remove that. Plan Mode only uses CHAPO's perspective now.

**Step 2: Simplify agentAccess.ts**

Either inline into chapo.ts or keep as thin wrapper with only CHAPO.

**Step 3: Delete scoutRuntime.ts**

No more SCOUT spawning.

**Acceptance:** Router dispatches directly to ChapoLoop. No agent selection logic.

---

### Task 10: Integration Test & Verification

**Test on the test environment (ports 3011/3012), NOT dev.**

**Step 1: API health check**
```bash
ssh root@10.0.0.5 "curl -s http://localhost:3012/api/health | jq"
```

**Step 2: Basic chat test**

Send a simple message via WebSocket or curl and verify CHAPO responds without errors.

**Step 3: Tool domain tests**

Test one tool from each domain:
- Filesystem: "Read the file apps/api/src/server.ts"
- Git: "Show me the git status"
- Web: "Search for the weather in Darmstadt"
- TaskForge: "List my tasks"
- Memory: "Remember that the test env works"

**Step 4: Check PM2 logs for errors**
```bash
ssh root@10.0.0.5 "pm2 logs devai-api-test --lines 100 --nostream"
```

**Step 5: Verify dev env unaffected**
```bash
ssh root@10.0.0.5 "curl -s http://localhost:3009/api/health | jq"
```

**Acceptance:** All domain tools work, no delegation errors, dev env untouched.

---

## Task Dependency Order

```
Task 0 (Setup)
  |
  v
Task 1 (Types) ──> Task 2 (CHAPO tools) ──> Task 3 (Simplify loop)
                                                |
                                                v
                                          Task 4 (Delete agents) ──> Task 5 (Prompt)
                                                |
                                                v
                              Task 6 (Events) + Task 7 (Registry) + Task 8 (Frontend)
                                                |
                                                v
                                          Task 9 (Router)
                                                |
                                                v
                                          Task 10 (Test)
```

Tasks 6, 7, 8 can run in parallel after Task 4.

---

## Rollback

If things go wrong, the feature branch is isolated:
- Dev env (3008/3009) is completely untouched
- Delete test env: `ssh root@10.0.0.5 "pm2 delete devai-test devai-api-test && rm -rf /opt/Devai-test"`
- Remove worktree: `cd /opt/Klyde/projects/Devai && git worktree remove /opt/Klyde/projects/Devai-test`
- Delete branch: `git branch -D feature/single-agent && git push origin --delete feature/single-agent`
