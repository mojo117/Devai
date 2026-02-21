# DevAI Architecture
Last updated 2026-02-21

This document describes the architecture of DevAI, including the CHAPO Decision Loop and the multi-agent system.

**Navigation:** [Overview](#overview) · [Project Structure](#project-structure) · [CHAPO Loop](#chapo-decision-loop) · [Agents](#agents) · [Memory](#memory-architecture) · [Prompts](#prompt-architecture) · [Request Flow](#request-flow) · [Streaming](#streaming-protocol) · [Tools](#tool-registry) · [Security](#security) · [API](#api-endpoints) · [Frontend](#frontend-integration)

---

## Overview

DevAI is an AI-powered assistant platform. The user interacts with **Chapo** -- a versatile AI agent, orchestrator, and personal assistant who helps with coding, automation, task management, research, and casual conversation.

**Architecture: CHAPO Decision Loop with DEVO + SCOUT + CAIO**

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
              |  +---------------+  +---------------+ |
              |  | Conversation  |  | Error         | |
              |  | Manager       |  | Handler       | |
              |  +---------------+  +---------------+ |
              |                                       |
              |  +---------------+  +---------------+ |
              |  | Self-         |  | System        | |
              |  | Validator     |  | Context       | |
              |  +---------------+  +---------------+ |
              |                                       |
              |  5 Actions:                           |
              |  +--------+  +--------+  +--------+  |
              |  | ANSWER |  | ASK    |  | TOOL   |  |
              |  +--------+  +--------+  +--------+  |
              |  +----------+  +-------------------+  |
              |  | DELEGATE |  | DELEGATE_PARALLEL |  |
              |  +----+-----+  +--------+----------+  |
              |       |                 |              |
              |  +----v---------+  +----v------+  +--------+
              |  | DEVO         |  | SCOUT     |  | CAIO   |
              |  | (Dev+DevOps) |  | (Explorer)|  | (Comms)|
              |  +--------------+  +-----------+  +--------+
              +--------------------------------------+
                          ^
                          |
                    Scheduler (cron)
```

**Key design principles:**
- Chapo is a versatile assistant, not just a dev tool
- No separate decision engine -- the LLM's `tool_calls` ARE the decisions
- Errors feed back into the loop as context (never crash)
- Self-validation runs before every ANSWER (advisory, never blocks)
- Delegation via `delegateToDevo` / `delegateToScout` / `delegateToCaio` tool calls
- `delegateParallel` fires multiple agents concurrently via Promise.all()
- Memory tools executed directly by CHAPO within the loop
- External input: Telegram webhook and cron scheduler feed into processRequest()
- Approval flow supported; can be bypassed in trusted mode
- Loop exhaustion asks user for next steps

---

## Project Structure

```
apps/
+-- api/                          # Fastify API server
|   +-- src/
|       +-- agents/               # Multi-agent system
|       |   +-- chapo-loop.ts     # ChapoLoop -- core decision loop + inbox check
|       |   +-- inbox.ts          # SessionInbox queue + event bus (multi-message)
|       |   +-- router.ts         # processRequest() entry point + Plan Mode
|       |   +-- chapo.ts          # CHAPO agent definition
|       |   +-- devo.ts           # DEVO agent definition
|       |   +-- scout.ts          # SCOUT agent definition
|       |   +-- caio.ts           # CAIO agent definition (comms & admin)
|       |   +-- error-handler.ts  # AgentErrorHandler (resilient error wrapping)
|       |   +-- self-validation.ts# SelfValidator (LLM reviews its own answers)
|       |   +-- conversation-manager.ts # 180k token sliding window + compaction
|       |   +-- stateManager.ts   # Session state (phases, approvals, questions, isLoopRunning)
|       |   +-- systemContext.ts  # System context assembly
|       |   +-- events.ts         # Typed event factory functions
|       |   +-- types.ts          # All agent/plan/task/scout/inbox types
|       |   +-- index.ts          # Re-exports
|       +-- prompts/              # Central prompt directory (all German)
|       |   +-- index.ts          # Re-exports all prompts
|       |   +-- chapo.ts          # CHAPO_SYSTEM_PROMPT (personality + identity)
|       |   +-- devo.ts           # DEVO_SYSTEM_PROMPT
|       |   +-- scout.ts          # SCOUT_SYSTEM_PROMPT
|       |   +-- caio.ts           # CAIO_SYSTEM_PROMPT (comms & admin)
|       |   +-- self-validation.ts# VALIDATION_SYSTEM_PROMPT
|       |   +-- context.ts        # MEMORY_BEHAVIOR_BLOCK
|       +-- tools/                # Tool implementations
|       |   +-- registry.ts       # Tool definitions & whitelist
|       |   +-- executor.ts       # Execution engine (switch/case)
|       |   +-- fs.ts             # File system tools
|       |   +-- git.ts            # Git operations
|       |   +-- github.ts         # GitHub API
|       |   +-- bash.ts           # Bash execution
|       |   +-- ssh.ts            # SSH execution
|       |   +-- web.ts            # Web search/fetch
|       |   +-- memory.ts         # Memory tools
|       |   +-- pm2.ts            # PM2 management
|       |   +-- scheduler.ts      # Scheduler & reminder tools
|       |   +-- taskforge.ts      # TaskForge ticket management tools
|       |   +-- email.ts          # Email via Resend REST API
|       +-- external/             # External platform integrations
|       |   +-- telegram.ts       # Telegram Bot API client
|       +-- scheduler/            # Cron scheduler service
|       |   +-- schedulerService.ts # In-process croner, Supabase-backed
|       +-- routes/               # API routes
|       |   +-- actions.ts        # Action endpoints
|       |   +-- auth.ts           # Authentication
|       |   +-- sessions.ts       # Session management
|       |   +-- memory.ts         # Memory queries
|       |   +-- project.ts        # Project management
|       |   +-- settings.ts       # Settings
|       |   +-- skills.ts         # Skills registry
|       |   +-- health.ts         # Health check
|       |   +-- external.ts       # Telegram webhook + external platforms
|       +-- websocket/            # WebSocket handlers
|       |   +-- routes.ts         # WS /api/ws/chat + /api/ws/actions
|       |   +-- chatGateway.ts    # Chat event broadcast & replay
|       |   +-- actionBroadcaster.ts # Action approval broadcast
|       +-- llm/                  # LLM integration
|       |   +-- router.ts         # Provider routing + fallback
|       |   +-- modelSelector.ts  # Smart model selection by task complexity
|       |   +-- types.ts          # LLM type definitions
|       |   +-- providers/        # Anthropic, OpenAI, Gemini
|       +-- memory/               # Session Intelligence & Long-Term Memory (pgvector)
|       +-- config/               # Configuration (trust.ts etc.)
|       +-- actions/              # Action approval system + approval bridge
|       +-- db/                   # Database persistence
|       +-- mcp/                  # Model Context Protocol
|       +-- audit/                # Audit logging
+-- web/                          # React frontend
|   +-- src/
|       +-- api.ts                # API client (WebSocket)
|       +-- components/
|       |   +-- ChatUI.tsx        # Main chat interface
|       |   +-- AgentStatus.tsx
|       |   +-- AgentHistory.tsx
|       +-- types.ts
+-- shared/                       # Shared types (@devai/shared)
```

---

## CHAPO Decision Loop

The ChapoLoop is the core of DevAI's intelligence. It replaces the former Looper system with a simpler, more resilient design: a continuous loop where the LLM decides what to do next via tool calls.

**Key insight:** No separate "decision engine" needed. The LLM's `tool_calls` ARE the decision:
- `delegateToDevo` = DELEGATE
- `delegateToScout` = DELEGATE
- `askUser` = ASK
- `fs_readFile`, `web_search`, etc. = TOOL
- No tool calls = ANSWER

### The 4 Actions

```
User message --> ChapoLoop.run():
    +-- ANSWER --> Self-validate, send response, exit loop
    +-- ASK    --> Pause loop, wait for user reply
    +-- TOOL   --> Execute tool, feed result back into loop
    +-- DELEGATE --> Run DEVO/SCOUT sub-loop, feed result back

    Error at any point --> Feed error as context into loop
                          --> CHAPO decides next step
```

### Configuration

```typescript
interface ChapoLoopConfig {
  selfValidationEnabled: boolean;  // true for non-trivial tasks
  maxIterations: number;           // 8 (trivial) or 20 (standard)
}
```

Iteration limits are set by task complexity:
- **trivial** tasks: 8 iterations, self-validation OFF
- **simple/moderate/complex** tasks: 20 iterations, self-validation ON

### Components

| Component | File | Purpose |
|-----------|------|---------|
| **ChapoLoop** | `agents/chapo-loop.ts` | Core decision loop -- calls LLM, dispatches actions |
| **AgentErrorHandler** | `agents/error-handler.ts` | Wraps every `await` with `safe()`, classifies errors, manages retries (max 3) |
| **SelfValidator** | `agents/self-validation.ts` | LLM reviews its own draft answer before delivery (advisory only) |
| **ConversationManager** | `agents/conversation-manager.ts` | 180k token sliding window, auto-trims old messages, compaction at 160k |

### Error Handling: Errors Feed Back

The critical difference from the old architecture: **errors never crash the conversation**. Every async operation is wrapped in `AgentErrorHandler.safe()`:

```typescript
const [result, err] = await this.errorHandler.safe('llm_call', () =>
  llmRouter.generateWithFallback(...)
);

if (err) {
  // Error becomes part of the conversation context
  this.conversation.addMessage({
    role: 'assistant',
    content: this.errorHandler.formatForLLM(err)
  });
  continue; // CHAPO sees the error and decides what to do next
}
```

Error classifications: `TIMEOUT`, `RATE_LIMIT`, `NETWORK`, `NOT_FOUND`, `AUTH`, `FORBIDDEN_TOOL`, `TOKEN_LIMIT`, `INTERNAL`, `UNKNOWN`.

### Self-Validation

Before every ANSWER action, ChapoLoop runs self-validation:

1. `SelfValidator.validate(userRequest, proposedAnswer)` calls a lightweight LLM
2. Returns `{ isComplete, confidence, issues, suggestion }`
3. Result is **advisory only** -- the answer is always delivered
4. Logged via `SessionLogger` for observability
5. Skipped for trivial tasks (`selfValidationEnabled: false`)

### Loop Lifecycle

```
ChapoLoop.run(userMessage, conversationHistory):
  1. Warm system context (devai.md, claude.md, workspace, memory)
  2. Set system prompt on ConversationManager
  3. Load conversation history
  4. Add user message
  5. Enter runLoop()

runLoop() -- max N iterations:
  +-- Call LLM with conversation + available tools
  |
  +-- LLM error?
  |   +-- Format error for LLM, add to conversation
  |   +-- continue (CHAPO decides on next iteration)
  |
  +-- No tool_calls in response?
  |   +-- ACTION: ANSWER
  |   +-- Self-validate (if enabled)
  |   +-- return { status: 'completed', answer }
  |
  +-- For each tool_call:
      +-- askUser?
      |   +-- ACTION: ASK
      |   +-- return { status: 'waiting_for_user', question }
      |
      +-- delegateToDevo?
      |   +-- ACTION: DELEGATE
      |   +-- Run DEVO sub-loop (max 10 turns)
      |   +-- Feed result back into conversation
      |   +-- continue
      |
      +-- delegateToScout?
      |   +-- ACTION: DELEGATE
      |   +-- Spawn SCOUT exploration
      |   +-- Feed result back into conversation
      |   +-- continue
      |
      +-- Any other tool?
          +-- ACTION: TOOL
          +-- Execute via executeToolWithApprovalBridge()
          +-- Tool error? Feed error back as context
          +-- Tool success? Feed result back
          +-- continue

  Loop exhaustion (max iterations reached):
  +-- return { status: 'waiting_for_user', question: 'Loop exhausted...' }
```

### Multi-Message Inbox System

Users can send follow-up messages while CHAPO is working. These are queued in a per-session inbox and processed between loop iterations.

```
WebSocket/Telegram message arrives
      |
      v
CommandDispatcher / Telegram webhook
      |
      v
  isLoopRunning for this session?
      |--- NO  --> Start new ChapoLoop normally
      |--- YES --> Push into SessionInbox
                --> Fire inbox event handlers (immediate acknowledgment)
                --> Return { type: 'queued' }
```

**SessionInbox** (`agents/inbox.ts`): Per-session in-memory queue with event bus.

```typescript
pushToInbox(sessionId, message)   // Queue + fire handlers
drainInbox(sessionId)             // Return all + clear
peekInbox(sessionId)              // Return all (non-destructive)
clearInbox(sessionId)             // Delete queue + handlers
onInboxMessage(sessionId, handler)  // Subscribe to new messages
offInboxMessage(sessionId, handler) // Unsubscribe
```

**ChapoLoop integration**: The loop subscribes to inbox events on construction. Between each iteration (after tool results, before next LLM call), `checkInbox()` drains the queue and injects messages as a system prompt with classification instructions:

```
runLoop() iteration:
  1. Execute tools / delegation / answer
  2. Feed results back to conversation
  3. --> checkInbox() <-- drains inbox, injects classification prompt
  4. Next LLM call (with inbox context if any)
```

**Classification** (done by CHAPO within its own context):
- **PARALLEL**: Independent task -- delegate or handle after current task
- **AMENDMENT**: Changes current task -- abort early (iteration < 5) or finish-then-pivot
- **EXPANSION**: Extends current task -- integrate into running plan

**Lifecycle**: `setLoopRunning(true)` before `runLoop()`, `setLoopRunning(false) + dispose()` in `finally` block.

### ChapoLoopResult

```typescript
interface ChapoLoopResult {
  answer: string;
  status: 'completed' | 'waiting_for_user' | 'error';
  totalIterations: number;
  question?: string; // if status === 'waiting_for_user'
}
```

---

## Agents

Four agents with distinct roles:

| Agent | Role | Model (Primary / Fallback) | Tools | System Prompt |
|-------|------|----------------------------|-------|---------------|
| **CHAPO** | Coordinator | GLM-5 / Opus 4.5 | `fs_read*`, `web_*`, `git_read`, `memory_*`, `skill_list`, meta-tools | `CHAPO_SYSTEM_PROMPT` |
| **DEVO** | Developer + DevOps | GLM-4.7 / Sonnet 4 | `fs_*`, `git_*`, `bash_execute`, `ssh_execute`, `pm2_*`, `npm_*`, `github_*`, `web_*`, `skill_*` | `DEVO_SYSTEM_PROMPT` |
| **SCOUT** | Exploration Specialist | GLM-4.7-Flash (free) / Sonnet 4 | `fs_read*`, `git_read`, `github_getWorkflowRunStatus`, `web_*`, `memory_*` | `SCOUT_SYSTEM_PROMPT` |
| **CAIO** | Communications & Admin | GLM-4.5-Air / Sonnet 4 | `fs_readFile`, `fs_listFiles`, `fs_glob`, `taskforge_*`, `scheduler_*`, `send_email`, `notify_user`, `memory_*` | `CAIO_SYSTEM_PROMPT` |

### CHAPO (Coordinator)

CHAPO is the main agent the user interacts with. It runs the decision loop and can:
- Answer directly (chat, explanations, brainstorming)
- Use tools itself (memory, file reads, web search, git status)
- Delegate complex work to DEVO, SCOUT, or CAIO
- Fire multiple agents in parallel via `delegateParallel`
- Ask the user for clarification
- Process follow-up messages via the inbox system (classify as parallel/amendment/expansion)

### DEVO (Developer + DevOps)

DEVO handles development and operations tasks. When CHAPO delegates via `delegateToDevo`, a sub-loop runs with DEVO's prompt and tool set (max 10 turns). Result feeds back to CHAPO's conversation. Within its sub-loop, DEVO can also delegate to SCOUT for research and use `escalateToChapo` to hand issues back to CHAPO.

### SCOUT (Explorer)

SCOUT specializes in codebase exploration and web research. Runs as a focused sub-agent spawned by CHAPO via `delegateToScout`. Returns structured results: relevant files, code patterns, web findings, recommendations.

### CAIO (Communications & Administration Officer)

CAIO handles non-code tasks: TaskForge ticket management, email sending, scheduler jobs, reminders, and notifications. Has read-only filesystem access for context gathering (e.g. reading files for ticket context or attachments). No access to bash, SSH, git, or PM2. Can delegate research to SCOUT and escalate issues back to CHAPO.

### Agent Definitions

```typescript
type AgentName = 'chapo' | 'devo' | 'scout' | 'caio';

interface AgentDefinition {
  name: AgentName;
  role: AgentRole;
  model: string;
  fallbackModel?: string;
  tools: string[];
  systemPrompt: string;
  capabilities: AgentCapabilities;
}
```

---

## Memory Architecture — Session Intelligence & Memory System

DevAI uses a three-layer memory architecture that provides persistent, intelligent recall across sessions.

### Three-Layer Architecture

```
Layer 1: Working Memory          Layer 2: Session Summary         Layer 3: Long-Term Memory
+------------------------+       +------------------------+       +------------------------+
| Conversation context   |       | Context compaction at  |       | Supabase pgvector      |
| 180k token sliding     | ----> | 160k tokens via LLM    | ----> | devai_memories table    |
| window                 |       | compressed summary +   |       | HNSW index, cosine     |
|                        |       | memory candidates      |       | similarity search      |
+------------------------+       +------------------------+       +------------------------+
```

- **Layer 1 — Working Memory**: Conversation context with 180k token sliding window (up from 120k). Managed by `ConversationManager`.
- **Layer 2 — Session Summary**: Context compaction fires at 160k tokens via LLM call, producing a compressed summary + memory candidates for long-term storage.
- **Layer 3 — Long-Term Memory**: Supabase pgvector table (`devai_memories`) with hierarchical namespaces, HNSW index, and cosine similarity search.

### Key Components

All memory code lives in `apps/api/src/memory/`:

| File | Purpose |
|------|---------|
| `types.ts` | Shared types: `MemoryType` (semantic/episodic/procedural), `MemoryPriority`, `MemorySource`, `MemoryCandidate`, `StoredMemory` |
| `embeddings.ts` | OpenAI `text-embedding-3-small` wrapper (512 dimensions) |
| `memoryStore.ts` | CRUD operations: search, insert, reinforce, supersede, invalidate, decay |
| `compaction.ts` | Context compaction: summarizes old messages + extracts memory candidates |
| `extraction.ts` | Two-phase pipeline: LLM extraction -> vector deduplication (ADD/UPDATE/DELETE/NOOP) |
| `service.ts` | Public API: `retrieveRelevantMemories()`, `triggerSessionEndExtraction()` |
| `index.ts` | Barrel exports |

### Integration Points

| Location | Integration |
|----------|-------------|
| `agents/chapo-loop.ts` | Compaction check before each LLM call (`checkAndCompact()` at 160k token threshold) |
| `agents/systemContext.ts` | Memory retrieval injected into system prompt (`warmMemoryBlockForSession()`) |
| `websocket/chatGateway.ts` | Session-end extraction trigger on WebSocket disconnect |
| `server.ts` | Daily decay job (Ebbinghaus formula: `strength *= 0.95^days`) |
| `config.ts` | Token limit updated to 180k |

### Namespace Hierarchy

Memories are organized into hierarchical namespaces for scoped retrieval:

```
devai/global/patterns       -> Universal patterns
devai/global/tools          -> Tool usage patterns
devai/project/<name>/arch   -> Project architecture facts
devai/project/<name>/fixes  -> Project-specific fixes
devai/user/preferences      -> User preferences
```

### Memory Lifecycle

1. **Extraction triggers**: Mid-conversation compaction (160k tokens) + post-session extraction (WebSocket disconnect)
2. **Priority levels**: `highest` (user-stated, never decay) -> `high` (error->fix) -> `medium` (patterns) -> `low` (facts)
3. **Retrieval**: Vector similarity search with namespace scoping, 2k token budget, access reinforcement
4. **Decay**: Daily Ebbinghaus decay (`0.95^days_since_access`), pruning at `strength < 0.05`

### Database

- **Supabase project**: "Infrit" (`zzmvofskibpffcxbukuk.supabase.co`)
- **Table**: `devai_memories` with pgvector HNSW index
- **RPC**: `match_memories()` for scoped similarity search

### Loading (System Prompt)

When the loop starts, `warmSystemContextForSession()` loads:

1. **CHAPO System Prompt** -- Chapo's identity and capabilities
2. **devai.md Context** -- scanned from project root
3. **Workspace Context** -- workspace-level configuration
4. **Long-Term Memory** -- retrieved via `warmMemoryBlockForSession()` (vector similarity, 2k token budget)
5. **MEMORY_BEHAVIOR_BLOCK** -- rules for memory tool usage

### Execution

Memory tools (`memory_remember`, `memory_search`, `memory_readToday`) are regular tools in the registry. CHAPO calls them like any other tool within the decision loop -- no special routing needed.

---

## Prompt Architecture

All system prompts live in `apps/api/src/prompts/` and are written in **German**. JSON schema field names remain in English (parsed programmatically).

```
prompts/
+-- index.ts               # Re-exports everything
|
+-- Agent Prompts:
|   +-- chapo.ts           # Chapo's identity (versatile assistant + coordinator)
|   +-- devo.ts            # Developer + DevOps agent behavior
|   +-- scout.ts           # Explorer agent behavior
|   +-- caio.ts            # Communications & admin agent behavior
|   +-- agentSoul.ts       # Loads CAIO/DEVO/SCOUT soul blocks from workspace
|
+-- Validation:
|   +-- self-validation.ts # Self-review criteria (completeness, tone, etc.)
|
+-- Shared:
    +-- context.ts         # MEMORY_BEHAVIOR_BLOCK (workspace memory rules)
```

---

## Request Flow

### Primary Flow (WebSocket)

```
WebSocket /api/ws/chat

1. User message received via WebSocket
2. processRequest(sessionId, userMessage, conversationHistory, projectRoot, sendEvent):

   Quick exits (before the loop):
   +-- Parse yes/no --> handle pending approvals/questions
   +-- Small-talk detection
   +-- Extract "remember" notes
   +-- Task complexity classification + model selection

   Plan Mode gate (complex tasks):
   +-- determinePlanModeRequired() for complex tasks
   +-- If needed: multi-perspective plan (CHAPO + DEVO perspectives)
   +-- User approves/rejects plan before execution

   ChapoLoop:
   +-- new ChapoLoop(sessionId, sendEvent, projectRoot, modelSelection, config)
   +-- loop.run(userMessage, conversationHistory)

3. Result handling:
   +-- status: 'completed' --> answer streamed to user
   +-- status: 'waiting_for_user' --> question stored, user prompted
   +-- status: 'error' --> error message to user

4. User responds to waiting_for_user:
   +-- handleUserResponse() or handleUserApproval()
   +-- New processRequest() with updated conversation
```

### Concrete Examples

**Smalltalk (ANSWER):**
```
User: "Hallo, wie geht's?"
--> ChapoLoop: LLM responds with no tool_calls
--> ACTION: ANSWER
--> Self-validate: confidence 0.95
--> Deliver: "Hey! Mir geht's gut..."
--> 1 iteration
```

**Weather Query (TOOL + ANSWER):**
```
User: "Wie ist das Wetter in Darmstadt?"
--> ChapoLoop iteration 1: LLM calls web_search({ query: "Wetter Darmstadt" })
--> ACTION: TOOL -- execute web_search, feed result back
--> ChapoLoop iteration 2: LLM responds with answer (no tool_calls)
--> ACTION: ANSWER
--> Self-validate: confidence 0.9
--> Deliver: "In Darmstadt sind es aktuell..."
--> 2 iterations
```

**Code Fix (DELEGATE):**
```
User: "Fix the login validation bug"
--> ChapoLoop iteration 1: LLM calls delegateToDevo({ task: "Fix login bug", context: "..." })
--> ACTION: DELEGATE
--> DEVO sub-loop:
    Turn 1: fs_readFile("auth/login.ts")
    Turn 2: fs_edit({ path: "auth/login.ts", ... })
    Turn 3: responds with summary
--> Feed DEVO result back to CHAPO conversation
--> ChapoLoop iteration 2: LLM responds with answer (no tool_calls)
--> ACTION: ANSWER
--> Self-validate: confidence 0.85
--> Deliver: "Bug gefixt: ..."
--> 2 iterations (+ 3 DEVO sub-turns)
```

**Clarification (ASK):**
```
User: "Mach das mal besser"
--> ChapoLoop iteration 1: LLM calls askUser({ question: "Was genau soll verbessert werden?" })
--> ACTION: ASK
--> return { status: 'waiting_for_user', question: "Was genau soll verbessert werden?" }
--> 1 iteration, paused
```

**Memory (TOOL):**
```
User: "Merk dir: API Key ist abc123"
--> ChapoLoop iteration 1: LLM calls memory_remember({ content: "API Key ist abc123" })
--> ACTION: TOOL -- execute memory_remember, feed result back
--> ChapoLoop iteration 2: LLM responds with answer (no tool_calls)
--> ACTION: ANSWER
--> Deliver: "Hab ich mir gemerkt!"
--> 2 iterations
```

### Plan Mode (Complex Tasks)

For complex tasks, CHAPO enters Plan Mode before the decision loop:

```
1. determinePlanModeRequired() --> true for complex tasks
2. Multi-perspective analysis:
   +-- getChapoPerspective() -- strategic analysis, risk, coordination
   +-- getDevoPerspective()  -- deployment impact, rollback strategy
3. synthesizePlan() -- merge into ExecutionPlan with tasks
4. User approves/rejects:
   +-- Approved --> executePlan() runs tasks sequentially
   +-- Rejected --> user provides feedback, re-plan
```

---

## Approval System

Approval is still part of the architecture. Runtime behavior depends on trust mode:
- `trusted`: approvals may be auto-bypassed for faster execution
- `default`: risky actions can require explicit user approval

```typescript
// config/trust.ts
export const DEFAULT_TRUST_MODE: TrustMode = 'trusted';
```

---

## Streaming Protocol

Events are streamed via **WebSocket** as JSON. Each event has a standardized base:

```typescript
interface BaseStreamEvent {
  id: string;
  timestamp: string;
  category: EventCategory; // 'agent' | 'tool' | 'plan' | 'task' | 'scout' | 'user' | 'inbox' | 'system'
  sessionId?: string;
}
```

### Event Categories

**Agent events:**
```typescript
{ type: 'agent_start',     agent: 'chapo', phase: 'execution' }
{ type: 'agent_thinking',  agent: 'chapo', status: 'Analyzing request...' }
{ type: 'agent_response',  agent: 'chapo', content: '...', isPartial: false }
{ type: 'agent_complete',  agent: 'chapo', result: '...' }
{ type: 'delegation',      from: 'chapo', to: 'devo', task: '...' }
{ type: 'error',           agent: 'chapo', error: '...', recoverable: true }
```

**Tool events:**
```typescript
{ type: 'tool_call',   agent: 'devo', toolName: 'fs_readFile', args: {...}, toolId: '...' }
{ type: 'tool_result', agent: 'devo', toolName: 'fs_readFile', result: '...', success: true }
```

**Plan events:**
```typescript
{ type: 'plan_start',            sessionId: '...' }
{ type: 'perspective_start',     agent: 'chapo' }
{ type: 'perspective_complete',  agent: 'chapo', perspective: {...} }
{ type: 'plan_ready',            plan: {...} }
{ type: 'plan_approval_request', plan: {...} }
{ type: 'plan_approved',         planId: '...' }
```

**Task tracking events:**
```typescript
{ type: 'task_created',   task: {...} }
{ type: 'task_update',    taskId: '...', status: 'in_progress', activeForm: 'Reading file...' }
{ type: 'task_completed', taskId: '...', result: '...' }
```

**SCOUT events:**
```typescript
{ type: 'scout_start',    query: '...', scope: 'codebase' }
{ type: 'scout_tool',     tool: 'fs_grep' }
{ type: 'scout_complete', summary: { relevantFiles: [...], recommendations: [...] } }
```

**User interaction events:**
```typescript
{ type: 'user_question',     question: {...} }
{ type: 'approval_request',  request: {...} }
```

**Inbox events:**
```typescript
{ type: 'message_queued',    messageId: '...', preview: 'Got it — I\'ll handle that too' }
{ type: 'inbox_processing',  count: 2 }
{ type: 'inbox_classified',  messageId: '...', classification: 'parallel', summary: '...' }
```

**System events:**
```typescript
{ type: 'session_start' }
{ type: 'heartbeat' }
{ type: 'system_error', error: '...' }
```

---

## Tool Registry

Tools are defined in `apps/api/src/tools/registry.ts`. Each tool is whitelisted and mapped to agent capabilities.

### Available Tools

| Category | Tools |
|----------|-------|
| **Filesystem** | `fs_listFiles`, `fs_readFile`, `fs_writeFile`, `fs_glob`, `fs_grep`, `fs_edit`, `fs_mkdir`, `fs_move`, `fs_delete` |
| **Git** | `git_status`, `git_diff`, `git_commit`, `git_push`, `git_pull`, `git_add` |
| **GitHub** | `github_triggerWorkflow`, `github_getWorkflowRunStatus` |
| **DevOps** | `bash_execute`, `ssh_execute`, `pm2_status`, `pm2_restart`, `pm2_stop`, `pm2_start`, `pm2_logs`, `npm_install`, `npm_run` |
| **Web** | `web_search`, `web_fetch` |
| **Context** | `context_listDocuments`, `context_readDocument`, `context_searchDocuments` |
| **Memory** | `memory_remember`, `memory_search`, `memory_readToday` |
| **Scheduler** | `scheduler_create`, `scheduler_list`, `scheduler_update`, `scheduler_delete`, `reminder_create`, `notify_user` |
| **TaskForge** | `taskforge_list_tasks`, `taskforge_get_task`, `taskforge_create_task`, `taskforge_move_task`, `taskforge_add_comment`, `taskforge_search` |
| **Email** | `send_email` |
| **Logs** | `logs_getStagingLogs` |

### Agent --> Tool Mapping

| Agent | Allowed Tools |
|-------|---------------|
| **CHAPO** | `fs_read*`, `fs_glob`, `fs_grep`, `web_search`, `web_fetch`, `git_status`, `git_diff`, `github_getWorkflowRunStatus`, `logs_getStagingLogs`, `memory_*`, `skill_list`, `skill_reload` + meta-tools |
| **DEVO** | `fs_*`, `git_*`, `bash_execute`, `ssh_execute`, `github_*`, `pm2_*`, `npm_*`, `web_search`, `web_fetch`, `logs_getStagingLogs`, `memory_*`, `skill_*` |
| **SCOUT** | `fs_readFile`, `fs_listFiles`, `fs_glob`, `fs_grep`, `git_status`, `git_diff`, `github_getWorkflowRunStatus`, `web_search`, `web_fetch`, `memory_*` |
| **CAIO** | `fs_readFile`, `fs_listFiles`, `fs_glob`, `taskforge_*`, `scheduler_*`, `reminder_create`, `notify_user`, `send_email`, `telegram_send_document`, `deliver_document`, `memory_*` |

### Special Tools (Coordination)

These are meta-tools used for coordination within the decision loop:

| Tool | Available to | Purpose |
|------|-------------|---------|
| `delegateToDevo` | CHAPO | Delegate a dev/devops task to DEVO sub-loop |
| `delegateToCaio` | CHAPO | Delegate comms/admin task to CAIO sub-loop |
| `delegateToScout` | CHAPO, DEVO, CAIO | Delegate exploration/research to SCOUT |
| `delegateParallel` | CHAPO | Fire multiple agents concurrently (e.g. DEVO + CAIO) |
| `askUser` | CHAPO | Pause the loop and ask the user a question |
| `requestApproval` | CHAPO | Request user approval (pause loop) |
| `escalateToChapo` | DEVO, SCOUT, CAIO | Escalate an issue back to CHAPO from sub-loop |

---

## Scheduler Service

DevAI includes an in-process cron scheduler backed by Supabase, enabling automated recurring tasks and one-time reminders.

### Architecture

```
Supabase (scheduled_jobs table)
      |
      v
SchedulerService (in-process croner)
      |
      +-- Job fires --> processRequest(instruction) --> ChapoLoop
      |
      +-- Notification --> sendTelegramMessage() / console.log
      |
      +-- Error --> ring buffer (last 20) --> injected into CHAPO system context
```

### Features

- **Cron jobs**: Standard cron expressions, stored in Supabase, registered with croner
- **Reminders**: One-time fire-and-forget, auto-deleted after execution
- **Error tracking**: Ring buffer of last 20 errors, injected into CHAPO's system context so it can react to failing jobs
- **Notification channels**: Per-job channel override or global default (from `external_sessions` table)

### Tools

Scheduler tools are owned by CAIO: `scheduler_create`, `scheduler_list`, `scheduler_update`, `scheduler_delete`, `reminder_create`, `notify_user`.

---

## External Messaging (Telegram)

DevAI can be accessed from Telegram via a webhook. This enables mobile access and scheduled job notifications.

### Flow

```
Telegram Bot API
      |
      v
POST /api/telegram/webhook (no JWT auth — single-user chat ID check)
      |
      v
getOrCreateExternalSession('telegram', userId, chatId)
      |
      v
processRequest(sessionId, text, [], null, noop)
      |
      v
ExternalOutputProjection listens for WF_COMPLETED/GATE_QUESTION_QUEUED
      |
      v
sendTelegramMessage(chatId, response)
```

### Security

- **Single-user**: Only the configured `TELEGRAM_ALLOWED_CHAT_ID` can interact
- **No auth middleware**: The `/api/telegram/*` path is excluded from JWT verification
- **Fire-and-forget**: Webhook responds 200 immediately, processing happens in background

### Projection

`ExternalOutputProjection` implements the `Projection` interface and listens for:
- `WF_COMPLETED` — sends final answer to Telegram
- `GATE_QUESTION_QUEUED` — sends question to Telegram
- `GATE_APPROVAL_QUEUED` — sends approval request to Telegram

---

## Security

### Tool Whitelist

All tools must be in the registry whitelist. Unknown tool names are rejected by the executor:

```typescript
// In executor.ts
if (!isToolWhitelisted(toolName)) {
  return { success: false, error: 'Tool not whitelisted' };
}
```

### Sandbox Mode

Default trust mode is `trusted`, but environments can switch modes via settings. In `default` mode, approval gates are enforced.

### Filesystem Restrictions

Allowed root paths:
- `/opt/Klyde/projects/DeviSpace`
- `/opt/Klyde/projects/Devai`

### SSH Host Aliases

```typescript
const HOST_ALIASES: Record<string, string> = {
  baso: '77.42.90.193',
  klyde: '46.224.197.7',
  infrit: '77.42.88.224',
};
```

---

## API Endpoints

### WebSocket Chat (Primary)

```
WebSocket /api/ws/chat

Client sends:
{
  "type": "message",
  "message": "Wie ist das Wetter in Darmstadt?",
  "provider": "anthropic",
  "sessionId": "optional",
  "projectRoot": "/path/to/project",
  "skillIds": ["skill1"]
}

Server streams AgentStreamEvent objects as JSON over WebSocket.
```

### WebSocket Actions

```
WebSocket /api/ws/actions

Broadcasts action approval requests and receives user decisions.
```

### REST Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Health check |
| POST | `/api/auth/*` | Authentication |
| GET/POST | `/api/sessions/*` | Session management |
| GET/POST | `/api/memory/*` | Memory queries |
| GET/POST | `/api/project/*` | Project management |
| GET/POST | `/api/settings/*` | Settings |
| GET | `/api/skills/*` | Skills registry |
| POST | `/api/actions/*` | Action management |

### Continue After Pause

When the loop pauses (ASK / loop exhaustion), the user sends another message to the same session via WebSocket. The system calls `handleUserResponse()` which feeds the answer back and triggers a new `processRequest()` cycle.

---

## Frontend Integration

The `ChatUI.tsx` component connects via **WebSocket** and processes `AgentStreamEvent` messages:

```typescript
// Process streaming events
handleEvent(event: AgentStreamEvent) {
  switch (event.type) {
    case 'agent_start':        // Show agent starting
    case 'agent_thinking':     // Show thinking indicator
    case 'agent_response':     // Stream answer text
    case 'delegation':         // Show delegation to DEVO/SCOUT/CAIO
    case 'tool_call':          // Show tool being called
    case 'tool_result':        // Show tool output
    case 'user_question':      // Show question, enable input
    case 'approval_request':   // Show approval dialog
    case 'scout_start':        // Show SCOUT exploring
    case 'scout_complete':     // Show exploration results
    case 'task_update':        // Update task progress
    case 'message_queued':     // Show status chip: "Message received"
    case 'inbox_processing':   // Show status: "Handling your follow-up..."
    case 'inbox_classified':   // Show classification result
    case 'error':              // Display error (with recovery context)
    case 'agent_complete':     // Processing finished
  }
}
```

**UI Components:**
- `ChatUI`: Main chat interface with WebSocket streaming. Input stays unlocked during processing (multi-message support).
- `AgentStatus`: Shows which agent is active (CHAPO / DEVO / SCOUT / CAIO)
- `AgentHistory`: Detailed history with tool calls, delegations, and results
