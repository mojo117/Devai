# DevAI Architecture
Last updated 2026-02-27

This document describes the architecture of DevAI, including the CHAPO Decision Loop and the single-agent system.

**Navigation:** [Overview](#overview) · [Project Structure](#project-structure) · [CHAPO Loop](#chapo-decision-loop) · [Memory](#memory-architecture) · [Prompts](#prompt-architecture) · [Request Flow](#request-flow) · [Streaming](#streaming-protocol) · [Tools](#tool-registry) · [Security](#security) · [API](#api-endpoints) · [Frontend](#frontend-integration)

---

## Overview

DevAI is an AI-powered assistant platform. The user interacts with **Chapo** -- a versatile AI agent, orchestrator, and personal assistant who helps with coding, automation, task management, research, and casual conversation.

**Architecture: CHAPO Decision Loop (Single Agent)**

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
              |  | System        |  | Gate          | |
              |  | Context       |  | Manager       | |
              |  +---------------+  +---------------+ |
              |                                       |
              |  3 Actions:                           |
              |  +--------+  +--------+  +--------+  |
              |  | ANSWER |  | ASK    |  | TOOL   |  |
              |  +--------+  +--------+  +--------+  |
              |                                       |
              |  76 native tools + MCP tools           |
              +--------------------------------------+
                          ^
                          |
                    Scheduler (cron)
```

**Key design principles:**
- Chapo is a versatile assistant, not just a dev tool
- No separate decision engine -- the LLM's `tool_calls` ARE the decisions
- **Trust the model** -- the LLM agents are capable enough to do their jobs correctly. Don't add coded validators, regex checks, or heuristic guardrails for things the model can handle through its prompt. If an agent should behave a certain way, tell it in the prompt -- don't build code to police its output. Code-level checks should only exist for things that are genuinely outside the model's control (token limits, API errors, network failures).
- Errors feed back into the loop as context (never crash)
- All tools available directly to CHAPO (no delegation needed)
- Memory tools executed directly within the loop
- External input: Telegram webhook and cron scheduler feed into processRequest()
- Approval flow supported; can be bypassed in trusted mode
- Loop exhaustion asks user for next steps

---

## Project Structure

```
apps/
+-- api/                          # Fastify API server
|   +-- src/
|       +-- agents/               # Single-agent system
|       |   +-- chapo-loop.ts     # ChapoLoop -- core decision loop + inbox check
|       |   +-- chapo-loop/       # Loop sub-modules
|       |   |   +-- chapoControlTools.ts  # Meta-tools (plan, todo, respond)
|       |   |   +-- contextManager.ts     # Context assembly for LLM calls
|       |   |   +-- gateManager.ts        # User questions + approval tracking
|       |   |   +-- toolExecutor.ts       # Tool execution with approval bridge
|       |   +-- inbox.ts          # SessionInbox queue + event bus (multi-message)
|       |   +-- router.ts         # processRequest() entry point
|       |   +-- chapo.ts          # CHAPO agent definition (tools + model config)
|       |   +-- error-handler.ts  # AgentErrorHandler (resilient error wrapping)
|       |   +-- answer-validator.ts # Answer validation (completeness check)
|       |   +-- reflexion.ts      # Self-reflection on failures
|       |   +-- conversation-manager.ts # 180k token sliding window + compaction
|       |   +-- conversationHistory.ts  # Conversation history persistence
|       |   +-- stateManager.ts   # Session state (phases, approvals, questions, isLoopRunning)
|       |   +-- systemContext.ts  # System context assembly
|       |   +-- intakeClassifier.ts # Fast intake classification for multi-message
|       |   +-- events.ts         # Typed event factory functions
|       |   +-- types.ts          # All agent/plan/task types
|       |   +-- utils.ts          # Shared utilities
|       |   +-- index.ts          # Re-exports
|       +-- prompts/              # Central prompt directory
|       |   +-- index.ts          # Re-exports all prompts
|       |   +-- chapo.ts          # CHAPO_SYSTEM_PROMPT (personality + identity)
|       |   +-- agentSoul.ts      # Agent soul loading (API compatibility stub)
|       |   +-- context.ts        # MEMORY_BEHAVIOR_BLOCK
|       +-- tools/                # Tool implementations
|       |   +-- registry.ts       # Unified tool registry
|       |   +-- definitions/      # Tool category definitions
|       |   +-- toolHandlers.ts   # Tool execution handlers
|       +-- memory/               # Session Intelligence & Long-Term Memory (pgvector)
|       |   +-- memoryStore.ts    # CRUD operations (search, insert, reinforce, decay)
|       |   +-- embeddings.ts     # OpenAI text-embedding-3-small (512 dims)
|       |   +-- extraction.ts     # LLM-based memory extraction pipeline
|       |   +-- compaction.ts     # Context compaction at 160k tokens
|       |   +-- episodicExtraction.ts # Automatic episodic learning (turn/tool/topic)
|       |   +-- recentFocus.ts    # Short-term topic tracking
|       |   +-- renderMemoryMd.ts # Render memory.md for workspace
|       |   +-- service.ts        # Public API: retrieve, extract, decay
|       |   +-- types.ts          # Memory types
|       +-- llm/                  # LLM integration
|       |   +-- router.ts         # Provider routing + fallback
|       |   +-- modelSelector.ts  # Model selection by engine profile
|       |   +-- types.ts          # LLM type definitions
|       |   +-- providers/        # ZAI, Anthropic, OpenAI, Gemini, Moonshot
|       +-- websocket/            # WebSocket handlers
|       |   +-- routes.ts         # WS /api/ws/chat + /api/ws/actions
|       |   +-- chatGateway.ts    # Chat event broadcast & replay
|       |   +-- actionBroadcaster.ts # Action approval broadcast
|       +-- workflow/             # Event-driven projections
|       |   +-- events/           # Event catalog + envelope
|       |   +-- projections/      # Stream + State + External projections
|       |   +-- dispatcher.ts     # Event dispatcher
|       +-- external/             # External platform integrations
|       |   +-- telegram.ts       # Telegram Bot API client
|       +-- scheduler/            # Cron scheduler service
|       |   +-- schedulerService.ts # In-process croner, Supabase-backed
|       +-- routes/               # API routes
|       +-- config/               # Configuration (trust.ts etc.)
|       +-- actions/              # Action approval system
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

The ChapoLoop is the core of DevAI's intelligence. It's a continuous loop where the LLM decides what to do next via tool calls.

**Key insight:** No separate "decision engine" needed. The LLM's `tool_calls` ARE the decision:
- `askUser` = ASK
- `fs_readFile`, `web_search`, `bash_execute`, etc. = TOOL
- No tool calls = ANSWER

### The 3 Actions

```
User message --> ChapoLoop.run():
    +-- ANSWER --> Send response, exit loop
    +-- ASK    --> Pause loop, wait for user reply
    +-- TOOL   --> Execute tool, feed result back into loop

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
| **AnswerValidator** | `agents/answer-validator.ts` | LLM reviews its own draft answer before delivery (advisory only) |
| **ConversationManager** | `agents/conversation-manager.ts` | 180k token sliding window, auto-trims old messages, compaction at 160k |
| **GateManager** | `agents/chapo-loop/gateManager.ts` | User question/approval flow tracking |
| **ToolExecutor** | `agents/chapo-loop/toolExecutor.ts` | Tool execution with approval bridge |
| **ContextManager** | `agents/chapo-loop/contextManager.ts` | Context assembly for LLM calls |

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

Before every ANSWER action, ChapoLoop runs answer validation:

1. `AnswerValidator.validateAndNormalize(userRequest, proposedAnswer)` calls a lightweight LLM
2. Returns `{ isComplete, confidence, issues, suggestion }`
3. Result is **advisory only** -- the answer is always delivered
4. Logged for observability
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
  +-- Call LLM with conversation + all available tools
  |
  +-- LLM error?
  |   +-- Format error for LLM, add to conversation
  |   +-- continue (CHAPO decides on next iteration)
  |
  +-- No tool_calls in response?
  |   +-- ACTION: ANSWER
  |   +-- return { status: 'completed', answer }
  |
  +-- For each tool_call:
      +-- askUser?
      |   +-- ACTION: ASK
      |   +-- return { status: 'waiting_for_user', question }
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
  1. Execute tools / answer
  2. Feed results back to conversation
  3. --> checkInbox() <-- drains inbox, injects classification prompt
  4. Next LLM call (with inbox context if any)
```

**Classification** (done by CHAPO within its own context):
- **PARALLEL**: Independent task -- handle after current task
- **AMENDMENT**: Changes current task -- abort early (iteration < 5) or finish-then-pivot
- **EXPANSION**: Extends current task -- integrate into running plan

**Lifecycle**: `setLoopRunning(true)` before `runLoop()`, `setLoopRunning(false) + dispose()` in `finally` block.

### Intake Seed

Before the ChapoLoop starts, a fast model call (GLM-4.7-Flash) extracts discrete requests from the user message and creates initial TodoItems. This ensures multi-part messages are tracked structurally, not relying on CHAPO to voluntarily parse them.

**Source:** `apps/api/src/services/intakeSeed.ts`
**Called from:** `processRequest()` in `agents/router/requestFlow.ts`

The intake seed also runs on inbox messages (via `contextManager.checkInbox()`), ensuring follow-up messages during an active loop are also tracked as todos.

### Exit Gate

Before the ChapoLoop can exit with an ANSWER, it checks `ConversationState.todos` for pending items. If any are found, a system message is injected and the loop continues. Max 2 bounces to prevent infinite loops.

**Source:** `apps/api/src/agents/chapo-loop.ts` (ANSWER path)

### Heartbeat Loop

Every 120 minutes during active hours (07:00-21:00 Europe/Berlin), a heartbeat job triggers a CHAPO loop that checks chat history, API logs, and memory for unhandled issues. Results are persisted in the `heartbeat_runs` Supabase table.

**Source:** `apps/api/src/services/heartbeatService.ts`
**Scheduled by:** `schedulerService.registerInternalJob()` in `server.ts`
**DB table:** `heartbeat_runs` (status, findings, actions_taken, duration_ms)

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

## Memory Architecture — Session Intelligence & Memory System

DevAI uses a three-layer memory architecture that provides persistent, intelligent recall across sessions.

### Three-Layer Architecture

```
Layer 1: Working Memory          Layer 2: Session Summary         Layer 3: Long-Term Memory
+------------------------+       +------------------------+       +------------------------+
| Conversation context   |       | Context compaction at  |       | Supabase pgvector      |
| 180k token sliding     | ----> | 160k tokens via LLM    | ----> | devai_memories table   |
| window                 |       | compressed summary +   |       | HNSW index, cosine     |
|                        |       | memory candidates      |       | similarity search      |
+------------------------+       +------------------------+       +------------------------+
```

- **Layer 1 — Working Memory**: Conversation context with 180k token sliding window. Managed by `ConversationManager`.
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
| `episodicExtraction.ts` | Automatic episodic learning: turn-end summaries, tool-result capture, topic promotion |
| `recentFocus.ts` | Short-term topic tracking across sessions |
| `renderMemoryMd.ts` | Renders memory.md file for workspace context injection |
| `service.ts` | Public API: `retrieveRelevantMemories()`, `triggerSessionEndExtraction()` |
| `index.ts` | Barrel exports |

### Episodic Memory (Cross-Session Learning)

Three fire-and-forget extraction triggers that capture session activity:

| Trigger | When | Namespace | Source |
|---------|------|-----------|--------|
| **Turn-end** | After CHAPO answers (non-trivial turns) | `devai/episodic/turn` | `episodic_turn` |
| **Tool-result** | After significant tool execution (writes, commits, bash) | `devai/episodic/tool` | `episodic_tool` |
| **Topic promotion** | At session end, for mature topics (touch >= 5 or sessions >= 2) | `devai/episodic/promoted` | `topic_promotion` |

All episodic memories are template-based (no LLM cost), deduplicated via vector similarity, and subject to the standard decay lifecycle.

### Integration Points

| Location | Integration |
|----------|-------------|
| `agents/chapo-loop.ts` | Compaction check before each LLM call; episodic extraction on turn-end and tool-result |
| `agents/systemContext.ts` | Memory retrieval injected into system prompt (`warmMemoryBlockForSession()`) |
| `websocket/chatGateway.ts` | Session-end extraction trigger + topic promotion on WebSocket disconnect |
| `server.ts` | Daily decay job (Ebbinghaus formula: `strength *= 0.95^days`) |
| `config.ts` | Token limit updated to 180k |

### Namespace Hierarchy

Memories are organized into hierarchical namespaces for scoped retrieval:

```
devai/global/patterns          -> Universal patterns
devai/global/tools             -> Tool usage patterns
devai/project/<name>/arch      -> Project architecture facts
devai/project/<name>/fixes     -> Project-specific fixes
devai/user/preferences         -> User preferences
devai/episodic/turn            -> Turn-end episodic summaries
devai/episodic/tool            -> Tool-result episodic records
devai/episodic/promoted        -> Promoted recurring topics
```

### Memory Lifecycle

1. **Extraction triggers**: Mid-conversation compaction (160k tokens) + post-session extraction (WebSocket disconnect) + real-time episodic capture
2. **Priority levels**: `highest` (user-stated, never decay) -> `high` (error->fix) -> `medium` (patterns) -> `low` (facts, episodic)
3. **Retrieval**: Vector similarity search with namespace scoping, 2k token budget, access reinforcement
4. **Decay**: Daily Ebbinghaus decay (`0.95^days_since_access`), pruning at `strength < 0.05`

### Database

- **Supabase project**: "Infrit" (`zzmvofskibpffcxbukuk.supabase.co`)
- **Table**: `devai_memories` with pgvector HNSW index
- **RPC**: `match_memories()` for scoped similarity search, `get_memories_by_timerange()` for temporal retrieval

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

All system prompts live in `apps/api/src/prompts/` and are written in **English** (identity-first format).

```
prompts/
+-- index.ts               # Re-exports everything
+-- chapo.ts               # Chapo's identity (versatile assistant + coordinator)
+-- agentSoul.ts           # API compatibility stub (returns empty)
+-- context.ts             # MEMORY_BEHAVIOR_BLOCK (workspace memory rules)
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
--> Validate: confidence 0.95
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
--> Deliver: "In Darmstadt sind es aktuell..."
--> 2 iterations
```

**Code Fix (TOOL chain):**
```
User: "Fix the login validation bug"
--> ChapoLoop iteration 1: LLM calls fs_readFile("auth/login.ts")
--> ACTION: TOOL -- read file, feed result back
--> ChapoLoop iteration 2: LLM calls fs_edit({ path: "auth/login.ts", ... })
--> ACTION: TOOL -- edit file, feed result back
--> ChapoLoop iteration 3: LLM responds with summary (no tool_calls)
--> ACTION: ANSWER
--> Deliver: "Bug gefixt: ..."
--> 3 iterations
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
  category: EventCategory; // 'agent' | 'tool' | 'user' | 'inbox' | 'todo' | 'system'
  sessionId?: string;
}
```

### Event Categories

**Agent events:**
```typescript
{ type: 'agent_start',        agent: 'chapo', phase: 'execution' }
{ type: 'agent_phase_change', agent: 'chapo', phase: 'planning' }
{ type: 'agent_thinking',     agent: 'chapo', status: 'Analyzing request...' }
{ type: 'agent_response',     agent: 'chapo', content: '...', isPartial: false }
{ type: 'agent_complete',     agent: 'chapo', result: '...' }
{ type: 'error',              agent: 'chapo', error: '...', recoverable: true }
```

**Tool events:**
```typescript
{ type: 'tool_call',   agent: 'chapo', toolName: 'fs_readFile', args: {...}, toolId: '...' }
{ type: 'tool_result', agent: 'chapo', toolName: 'fs_readFile', result: '...', success: true }
```

**User interaction events:**
```typescript
{ type: 'user_question',     question: {...} }
{ type: 'approval_request',  request: {...} }
```

**Todo events:**
```typescript
{ type: 'todo_updated',  todos: [...] }
```

**Inbox events:**
```typescript
{ type: 'message_queued',    messageId: '...', preview: 'Got it — I\'ll handle that too' }
{ type: 'inbox_processing',  count: 2 }
```

**System events:**
```typescript
{ type: 'session_start' }
{ type: 'heartbeat' }
{ type: 'system_error', error: '...' }
```

---

## Tool Registry

Tools are defined in `apps/api/src/tools/registry.ts` via a unified registry. All tools are available to CHAPO.

### Available Tools

| Category | Tools |
|----------|-------|
| **Filesystem** | `fs_listFiles`, `fs_readFile`, `fs_writeFile`, `fs_glob`, `fs_grep`, `fs_edit`, `fs_mkdir`, `fs_move`, `fs_delete` |
| **Git** | `git_status`, `git_diff`, `git_commit`, `git_push`, `git_pull`, `git_add` |
| **GitHub** | `github_triggerWorkflow`, `github_createPR`, `github_getWorkflowRunStatus` |
| **DevOps** | `bash_execute`, `exec_session_start`, `exec_session_write`, `exec_session_poll`, `ssh_execute`, `pm2_status`, `pm2_restart`, `pm2_stop`, `pm2_start`, `pm2_logs`, `pm2_reloadAll`, `pm2_save`, `npm_install`, `npm_run` |
| **Web** | `web_search`, `web_fetch`, `scout_search_fast`, `scout_search_deep`, `scout_site_map`, `scout_crawl_focused`, `scout_extract_schema`, `scout_research_bundle` |
| **Context** | `context_listDocuments`, `context_readDocument`, `context_searchDocuments` |
| **Memory** | `memory_remember`, `memory_search`, `memory_readToday` |
| **History** | `history_search`, `history_listSessions` |
| **Scheduler** | `scheduler_create`, `scheduler_list`, `scheduler_update`, `scheduler_delete`, `reminder_create`, `notify_user` |
| **TaskForge** | `taskforge_list_tasks`, `taskforge_get_task`, `taskforge_create_task`, `taskforge_move_task`, `taskforge_add_comment`, `taskforge_search` |
| **Email** | `send_email`, `telegram_send_document`, `deliver_document` |
| **Logs** | `logs_getStagingLogs` |
| **Skills** | `skill_create`, `skill_update`, `skill_delete`, `skill_reload`, `skill_list` |

Web tooling notes:
- `web_search` uses Perplexity (`PERPLEXITY_API_KEY`).
- `scout_*` Firecrawl tools use `FIRECRAWL_API_KEY`.

### Meta-Tools (Coordination)

These are special tools used for coordination within the decision loop:

| Tool | Purpose |
|------|---------|
| `chapo_plan_set` | Persist a short execution plan (steps + owner + status) |
| `todoWrite` | Personal todo list management (pending/in_progress/completed) |
| `askUser` | Pause the loop and ask the user a question (supports blocking + non-blocking) |
| `requestApproval` | Request user approval for risky actions (low/medium/high risk) |
| `respondToUser` | Send an intermediate user-visible response while the loop continues |

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

Scheduler tools: `scheduler_create`, `scheduler_list`, `scheduler_update`, `scheduler_delete`, `reminder_create`, `notify_user`.

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

All tools must be in the registry. Unknown tool names are rejected by the executor.

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
    case 'agent_start':        // Show CHAPO starting
    case 'agent_thinking':     // Show thinking indicator
    case 'agent_response':     // Stream answer text
    case 'tool_call':          // Show tool being called
    case 'tool_result':        // Show tool output
    case 'user_question':      // Show question, enable input
    case 'approval_request':   // Show approval dialog
    case 'todo_updated':       // Update task progress
    case 'message_queued':     // Show status chip: "Message received"
    case 'inbox_processing':   // Show status: "Handling your follow-up..."
    case 'error':              // Display error (with recovery context)
    case 'agent_complete':     // Processing finished
  }
}
```

**UI Components:**
- `ChatUI`: Main chat interface with WebSocket streaming. Input stays unlocked during processing (multi-message support).
- `AgentStatus`: Shows CHAPO's current state
- `AgentHistory`: Detailed history with tool calls and results
