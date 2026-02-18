# DevAI Architecture
Last updated 18.02

This document describes the architecture of DevAI, including the Looper orchestrator and the multi-agent system.

<div style="position: sticky; top: 0; background: #1a1a2e; padding: 12px 16px; border-radius: 8px; border: 1px solid #333; margin-bottom: 20px; z-index: 100;">

**Navigation:** [Overview](#overview) · [Project Structure](#project-structure) · [Looper](#looper-ai-orchestrator) · [Decision Routing](#decision-routing) · [Agents](#looper-sub-agents) · [Memory](#memory-architecture) · [Prompts](#prompt-architecture) · [Request Flow](#request-flow) · [Streaming](#streaming-protocol) · [Tools](#tool-registry) · [Security](#security) · [API](#api-endpoints) · [Frontend](#frontend-integration)

</div>

---

## Overview

DevAI is an AI-powered assistant platform. The user interacts with **Chapo** – a versatile AI agent, orchestrator, and personal assistant who helps with coding, automation, task management, research, and casual conversation.

**Architecture: Looper-AI with 4 Sub-Agents**

```
                    ┌──────────────────────────┐
                    │         USER             │
                    └────────────┬─────────────┘
                                 │
                                 ▼
              ┌──────────────────────────────────────┐
              │     CHAPO – LOOPER-AI ENGINE          │
              │                                       │
              │  ┌─────────────┐  ┌───────────────┐  │
              │  │  Decision   │  │ Conversation  │  │
              │  │  Engine     │  │ Manager       │  │
              │  └──────┬──────┘  └───────────────┘  │
              │         │                             │
              │  ┌──────▼──────┐  ┌───────────────┐  │
              │  │  Agent      │  │ Self-         │  │
              │  │  Router     │  │ Validator     │  │
              │  └──────┬──────┘  └───────────────┘  │
              │         │                             │
              │  ┌──────▼──────────────────────────┐  │
              │  │  Memory (direkt vom Looper)     │  │
              │  │  memory_remember/search/readToday│  │
              │  └────────────────────────────────┘  │
              │                                       │
              │  Sub-Agents (via agent-Feld):         │
              │  ┌───────────┐ ┌───────────────────┐ │
              │  │ Developer │ │ Document Manager  │ │
              │  │ (Koda)    │ │ (Devo)            │ │
              │  ├───────────┤ ├───────────────────┤ │
              │  │ Searcher  │ │ Commander         │ │
              │  │ (Scout)   │ │ (Chapo-Ops)       │ │
              │  └───────────┘ └───────────────────┘ │
              └──────────────────────────────────────┘
```

**Key design principles:**
- Chapo is a versatile assistant, not just a dev tool
- Agent routing via `agent` field in Decision Engine JSON – no delegation meta-tools
- Memory tools executed directly by Looper (not delegated to agents)
- Approval system deactivated (trusted/sandboxed mode)
- Loop exhaustion generates LLM summary and asks user for next steps

---

## Project Structure

```
apps/
├── api/                          # Fastify API server
│   └── src/
│       ├── prompts/              # Central prompt directory (all German)
│       │   ├── index.ts          # Re-exports all prompts
│       │   ├── looper-core.ts    # LOOPER_CORE_SYSTEM_PROMPT (Chapo identity)
│       │   ├── decision-engine.ts# DECISION_SYSTEM_PROMPT (intent + routing)
│       │   ├── self-validation.ts# VALIDATION_SYSTEM_PROMPT
│       │   ├── agent-developer.ts# DEV_SYSTEM_PROMPT
│       │   ├── agent-searcher.ts # SEARCH_SYSTEM_PROMPT
│       │   ├── agent-docmanager.ts# DOC_SYSTEM_PROMPT
│       │   ├── agent-commander.ts# CMD_SYSTEM_PROMPT
│       │   ├── chapo.ts          # CHAPO_SYSTEM_PROMPT (personality)
│       │   ├── koda.ts           # KODA_SYSTEM_PROMPT
│       │   ├── devo.ts           # DEVO_SYSTEM_PROMPT
│       │   ├── scout.ts          # SCOUT_SYSTEM_PROMPT
│       │   └── context.ts        # MEMORY_BEHAVIOR_BLOCK
│       ├── looper/               # Looper-AI engine
│       │   ├── engine.ts         # LooperEngine (main loop, memory, exhaustion)
│       │   ├── decision-engine.ts# Intent classification
│       │   ├── conversation-manager.ts # Context management
│       │   ├── self-validation.ts# Self-validation
│       │   ├── error-handler.ts  # Error tracking & retry
│       │   └── agents/           # Looper sub-agents
│       │       ├── base-agent.ts # LooperAgent interface
│       │       ├── developer.ts  # Code generation agent
│       │       ├── searcher.ts   # Research agent
│       │       ├── document-manager.ts # File operations agent
│       │       ├── commander.ts  # Shell commands agent
│       │       └── index.ts      # Agent factory
│       ├── tools/                # Tool implementations
│       │   ├── registry.ts       # Tool definitions & whitelist
│       │   ├── executor.ts       # Execution engine (switch/case)
│       │   ├── fs.ts             # File system tools
│       │   ├── git.ts            # Git operations
│       │   ├── github.ts         # GitHub API
│       │   ├── bash.ts           # Bash execution
│       │   ├── ssh.ts            # SSH execution
│       │   ├── web.ts            # Web search/fetch
│       │   ├── memory.ts         # Memory tools
│       │   └── pm2.ts            # PM2 management
│       ├── routes/               # API routes
│       │   ├── looper.ts         # POST /api/looper (NDJSON streaming)
│       │   ├── actions.ts        # Action endpoints
│       │   ├── auth.ts           # Authentication
│       │   ├── sessions.ts       # Session management
│       │   ├── memory.ts         # Memory queries
│       │   ├── project.ts        # Project management
│       │   ├── settings.ts       # Settings
│       │   ├── skills.ts         # Skills registry
│       │   └── health.ts         # Health check
│       ├── llm/                  # LLM integration
│       │   ├── router.ts         # Provider routing
│       │   ├── modelSelector.ts  # Model selection
│       │   ├── perplexity.ts     # Perplexity integration
│       │   ├── types.ts          # Type definitions
│       │   └── providers/        # Anthropic, OpenAI, Gemini
│       ├── memory/               # Workspace memory
│       ├── config/               # Configuration (trust.ts etc.)
│       ├── actions/              # Action approval system (deactivated)
│       ├── db/                   # Database persistence
│       ├── mcp/                  # Model Context Protocol
│       ├── audit/                # Audit logging
│       └── websocket/            # WebSocket handlers
├── web/                          # React frontend
│   └── src/
│       ├── api.ts                # API client
│       ├── components/
│       │   ├── ChatUI.tsx        # Main chat interface
│       │   ├── AgentStatus.tsx
│       │   └── AgentHistory.tsx
│       └── types.ts
└── shared/                       # Shared types (@devai/shared)
```

---

## Looper-AI Orchestrator

The Looper is the primary user-facing system. It runs an iterative loop that processes user messages, classifies intents, delegates to agents, and validates results before responding.

### Engine Configuration

```typescript
interface LooperConfig {
  maxIterations: 25;              // Max loop iterations per request
  maxConversationTokens: 120_000; // Token budget
  maxToolRetries: 3;              // Retries per tool failure
  minValidationConfidence: 0.7;   // Self-validation threshold
  selfValidationEnabled: true;    // Enable/disable self-check
}
```

### Components

| Component | File | Purpose |
|-----------|------|---------|
| **LooperEngine** | `looper/engine.ts` | Main loop, agent dispatch, memory handling, exhaustion summary |
| **DecisionEngine** | `looper/decision-engine.ts` | Classify intent: `tool_call`, `clarify`, `answer`, `self_validate`, `continue` |
| **ConversationManager** | `looper/conversation-manager.ts` | Manage dialog context within 120k token budget |
| **SelfValidator** | `looper/self-validation.ts` | LLM reviews its own draft answer before delivery |
| **ErrorHandler** | `looper/error-handler.ts` | Track errors, manage retries (max 3 per tool) |

---

## Decision Routing

The Decision Engine is the core routing logic. It receives the conversation history + latest event, and outputs a JSON decision that determines what happens next.

### Decision Flow

```
┌──────────────────────────────────────────────────────────────┐
│                    USER MESSAGE                               │
│  z.B. "Wie ist das Wetter?" / "Fix den Bug" / "Hallo!"      │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                   LOOPER ENGINE                               │
│  1. System Prompt bauen (Chapo-Core + Memory + Projekt)      │
│  2. User-Message zur Conversation hinzufügen                 │
│  3. Initiales Event: { type: 'user_message' }               │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
          ┌────────── ITERATION LOOP (max 25) ──────────┐
          │                                              │
          │    ┌─────────────────────────────────┐       │
          │    │     DECISION ENGINE (LLM)       │       │
          │    │                                 │       │
          │    │ Input:                          │       │
          │    │ - Full conversation history     │       │
          │    │ - Latest event (described)      │       │
          │    │ - Token budget status           │       │
          │    │                                 │       │
          │    │ Output JSON:                    │       │
          │    │ {                               │       │
          │    │   intent: "tool_call"|          │       │
          │    │          "answer"|"clarify",    │       │
          │    │   agent: "developer"|           │       │
          │    │         "searcher"|             │       │
          │    │         "document_manager"|     │       │
          │    │         "commander"|null,       │       │
          │    │   toolName: "web_search"|...,   │       │
          │    │   toolArgs: {...},              │       │
          │    │   answerText: "...",            │       │
          │    │   clarificationQuestion: "..."  │       │
          │    │ }                               │       │
          │    └───────────┬─────────────────────┘       │
          │                │                             │
          │    ┌───────────▼─────────────────┐           │
          │    │      INTENT SWITCH          │           │
          │    └──┬────┬────┬────┬────┬──────┘           │
          │       │    │    │    │    │                   │
          └───────┼────┼────┼────┼────┼──────────────────┘
                  │    │    │    │    │
   ┌──────────────┘    │    │    │    └───────────────┐
   ▼                   │    │    │                    ▼
 ANSWER                │    │    │              CONTINUE /
 ┌──────────────┐      │    │    │              SELF_VALIDATE
 │ answerText   │      │    │    │              ┌─────────────┐
 │              │      │    │    │              │ Loop again   │
 │ Self-Validate│      │    │    │              │ same event   │
 │ conf ≥ 0.7 →│      │    │    │              └─────────────┘
 │   deliver    │      │    │    │
 │ conf < 0.7 →│      │    │    └──────────────┐
 │   iterate   │      │    │                   ▼
 └──────────────┘      │    │            CLARIFY
                       │    │            ┌──────────────┐
                       │    │            │ Question →   │
                       │    │            │ User         │
                       │    │            │ Loop PAUSE   │
                       │    │            │ status:      │
                       │    │            │ waiting_for_ │
                       │    │            │ user         │
                       │    │            └──────────────┘
                       │    │
           ┌───────────┘    └──────────────────┐
           ▼                                   ▼
     TOOL_CALL                          TOOL_CALL
     (Memory Tool)                      (Agent Tool)
     ┌──────────────────┐              ┌──────────────────┐
     │ toolName starts  │              │ agent field      │
     │ with "memory_"   │              │ determines which │
     │                  │              │ agent executes   │
     │ Executed directly│              │                  │
     │ by Looper via    │              │ No delegation    │
     │ executeTool()    │              │ meta-tools!      │
     │                  │              │                  │
     │ memory_remember  │              │ Route via:       │
     │ memory_search    │              │ agents.get(      │
     │ memory_readToday │              │   decision.agent │
     │                  │              │ )                │
     │ Result → Event   │              │                  │
     │ → next iteration │              │ Result → Event   │
     └──────────────────┘              │ → next iteration │
                                       └────────┬─────────┘
                                                │
                                   ┌────────────▼────────────┐
                                   │     AGENT DISPATCH      │
                                   │                         │
                                   │  "developer" → Koda     │
                                   │    fs_*, git_*          │
                                   │                         │
                                   │  "searcher" → Scout     │
                                   │    web_search, web_fetch│
                                   │    context_*            │
                                   │                         │
                                   │  "document_manager"     │
                                   │    → Devo               │
                                   │    fs_*                 │
                                   │                         │
                                   │  "commander" → Ops      │
                                   │    bash_execute,        │
                                   │    ssh_execute, git_*,  │
                                   │    pm2_*, npm_*         │
                                   └─────────────────────────┘
```

### Decision Engine Prompt Rules

The Decision Engine LLM uses `DECISION_SYSTEM_PROMPT` with these rules:

1. **intent "answer"** (preferred for chat): Conversations, questions, explanations, brainstorming
2. **intent "tool_call"**: Concrete action needed. Agent + real tool name required
3. **intent "clarify"**: Only when truly unclear what the user wants

**Critical constraint:** `toolName` must ALWAYS be a real tool from the registry. Never `delegateToScout`, `delegateToKoda`, etc. Agent routing happens via the `agent` field.

### Routing Examples

| User says | intent | agent | toolName | toolArgs |
|-----------|--------|-------|----------|----------|
| "Hallo!" | `answer` | null | null | null |
| "Wie ist das Wetter?" | `tool_call` | `searcher` | `web_search` | `{ query: "Wetter..." }` |
| "Zeig mir die Datei" | `tool_call` | `document_manager` | `fs_readFile` | `{ path: "..." }` |
| "Fix den Bug in login.ts" | `tool_call` | `developer` | `fs_readFile` | `{ path: "login.ts" }` |
| "Merk dir: X ist wichtig" | `tool_call` | null | `memory_remember` | `{ content: "X..." }` |
| "Deploy to staging" | `tool_call` | `commander` | `bash_execute` | `{ command: "..." }` |
| "Git Status" | `tool_call` | `commander` | `git_status` | `{}` |

### Loop Exhaustion

When the 25-iteration limit is reached:

```
1. buildExhaustionSummary() calls LLM to generate summary (German):
   - Was wurde erledigt?
   - Was ist noch offen?
   - Welche nächsten Schritte?
   - Frage an den User: weitermachen / Priorität ändern / abbrechen

2. status = 'waiting_for_user'
3. emit({ type: 'clarify', data: { question: summary } })
4. User responds → continueWithClarification() → fresh 25-iteration loop
```

---

## Looper Sub-Agents

These are lightweight agents used by the Looper to execute specific tool categories. They are routed via the `agent` field in the Decision Engine's JSON output.

| Agent | Type Key | Name | Tools |
|-------|----------|------|-------|
| **Developer** | `developer` | Koda | `fs_*`, `git_*` (code operations) |
| **Searcher** | `searcher` | Scout | `web_search`, `web_fetch`, `context_*` |
| **Document Manager** | `document_manager` | Devo | `fs_*` (file organization) |
| **Commander** | `commander` | Chapo-Ops | `bash_execute`, `ssh_execute`, `git_*`, `pm2_*`, `npm_*`, `github_*` |

Each implements the `LooperAgent` interface:

```typescript
interface LooperAgent {
  readonly type: AgentType;
  readonly description: string;
  execute(ctx: AgentContext): Promise<AgentResult>;
}

interface AgentContext {
  userMessage: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  previousResults?: string[];
  onActionPending?: (action: Action) => void | Promise<void>;
}
```

**Important:** Agents do NOT handle memory tools. Memory is executed directly by the Looper engine.

---

## Memory Architecture

Memory is managed at the Looper level, not delegated to agents.

### Loading (System Prompt)

When the Looper starts, `buildSystemPrompt()` loads:

1. **Looper Core Prompt** – Chapo's identity and capabilities
2. **Project Context** – scanned from project root
3. **Today's Daily Memory** – via `readDailyMemory()` (max 3000 chars)
4. **Long-Term Memory** – from `MEMORY.md` in workspace root (max 3000 chars)

### Execution

Memory tool calls (`memory_remember`, `memory_search`, `memory_readToday`) are intercepted by the Looper before agent dispatch:

```typescript
// In engine.ts
if (decisionResult.toolName && this.isMemoryTool(decisionResult.toolName)) {
  // Execute directly, bypass agent routing
  const result = await this.executeMemoryTool(toolName, toolArgs);
  // Result fed back as event → next iteration
}
```

---

## Prompt Architecture

All system prompts live in `apps/api/src/prompts/` and are written in German. JSON schema field names remain in English (they're parsed programmatically).

```
prompts/
├── index.ts               # Re-exports everything
│
├── Looper Prompts:
│   ├── looper-core.ts     # Chapo's identity (versatile assistant)
│   ├── decision-engine.ts # Intent classification + agent routing rules
│   ├── self-validation.ts # Self-review criteria (completeness, tone, etc.)
│   ├── agent-developer.ts # Developer agent behavior
│   ├── agent-searcher.ts  # Searcher agent behavior
│   ├── agent-docmanager.ts# Document manager behavior
│   └── agent-commander.ts # Commander agent behavior
│
├── Legacy Multi-Agent Prompts (still present but secondary):
│   ├── chapo.ts           # Chapo personality & capabilities overview
│   ├── koda.ts            # Developer agent identity
│   ├── devo.ts            # DevOps agent identity
│   └── scout.ts           # Explorer agent identity
│
└── Shared:
    └── context.ts         # MEMORY_BEHAVIOR_BLOCK (workspace memory rules)
```

---

## Request Flow

### Looper Flow (Primary)

```
POST /api/looper

1. User message received
2. LooperEngine.run(message):
   a. Build system prompt (Chapo core + memory + project context)
   b. Add user message to conversation
   c. Start iteration loop

   Iteration N:
   ├── Decision Engine classifies the latest event → JSON
   │
   ├── Intent: tool_call + memory tool
   │   ├── Looper executes memory tool directly
   │   └── Result fed back as event → next iteration
   │
   ├── Intent: tool_call + agent tool
   │   ├── Route to agent via agent field (developer/searcher/docmanager/commander)
   │   ├── Agent executes the tool
   │   └── Result fed back as event → next iteration
   │
   ├── Intent: clarify
   │   ├── Stream question to user
   │   └── Pause loop (status: waiting_for_user)
   │
   ├── Intent: answer
   │   ├── Self-validation (if enabled)
   │   │   ├── Confidence >= 0.7 → deliver answer
   │   │   └── Confidence < 0.7 → iterate with suggestions
   │   └── Stream final response (status: completed)
   │
   └── Intent: continue / self_validate
       └── Next iteration (same event context)

3. Loop ends when:
   - answer delivered (status: completed)
   - clarification needed (status: waiting_for_user)
   - max 25 iterations reached → LLM summary + ask user (status: waiting_for_user)

4. User responds to waiting_for_user:
   - continueWithClarification() → fresh iteration counter, same conversation
```

### Concrete Examples

**Weather Query (Searcher):**
```
User: "Wie ist das Wetter in Darmstadt?"
→ Decision: { intent: "tool_call", agent: "searcher", toolName: "web_search", toolArgs: { query: "Wetter Darmstadt" } }
→ isMemoryTool("web_search") = false
→ Agent: searcher executes web_search
→ Result: Weather data as event
→ Decision: { intent: "answer", answerText: "In Darmstadt sind es aktuell..." }
→ Self-Validation: confidence 0.9 → deliver
```

**Smalltalk (Direct Answer):**
```
User: "Hallo, wie geht's?"
→ Decision: { intent: "answer", answerText: "Hey! Mir geht's gut..." }
→ Self-Validation: confidence 0.95 → deliver
→ No agent, no tool, direct response
```

**Code Fix (Developer):**
```
User: "Fix the login validation bug"
→ Decision: { intent: "tool_call", agent: "developer", toolName: "fs_readFile", toolArgs: { path: "auth/login.ts" } }
→ Developer agent reads file
→ Decision: { intent: "tool_call", agent: "developer", toolName: "fs_edit", toolArgs: { ... } }
→ Developer agent edits file
→ Decision: { intent: "answer", answerText: "Bug gefixt: ..." }
→ Self-Validation: confidence 0.85 → deliver
```

**Memory (Looper Direct):**
```
User: "Merk dir: API Key ist abc123"
→ Decision: { intent: "tool_call", agent: null, toolName: "memory_remember", toolArgs: { content: "API Key ist abc123" } }
→ isMemoryTool("memory_remember") = true
→ Looper executes directly via executeTool()
→ Result: "[Looper/Memory] memory_remember: Gespeichert"
→ Decision: { intent: "answer", answerText: "Hab ich mir gemerkt!" }
```

---

## Approval System (Deactivated)

The approval system is currently **deactivated**. All tools execute in sandbox/trusted mode without user confirmation.

```typescript
// config/trust.ts
export const DEFAULT_TRUST_MODE: TrustMode = 'trusted';
```

In trusted mode, all tools bypass the confirmation flow. The `onActionPending` callback in agents still exists but is not triggered.

---

## Streaming Protocol

Events are streamed via NDJSON (`application/x-ndjson`):

```typescript
// Looper lifecycle
{ type: 'status',     data: { status: 'running' } }
{ type: 'thinking',   data: { iteration: 3, event: 'tool_result', tokenUsage: {...} } }
{ type: 'step',       data: { iteration: 3, decision: { intent, agent, toolName, ... } } }

// Tool execution
{ type: 'tool_call',  data: { agent: 'searcher', tool: 'web_search', args: {...} } }
{ type: 'tool_result',data: { agent: 'searcher', success: true, output: '...' } }

// Memory (agent: 'looper')
{ type: 'tool_call',  data: { agent: 'looper', tool: 'memory_remember', args: {...} } }
{ type: 'tool_result',data: { agent: 'looper', success: true, output: '...' } }

// Validation
{ type: 'validation', data: { isComplete: true, confidence: 0.85, issues: [] } }

// Final outcomes
{ type: 'answer',     data: { answer: '...' } }
{ type: 'clarify',    data: { question: '...' } }

// Errors
{ type: 'error',      data: { agent: 'developer', error: '...' } }
```

---

## Tool Registry

Tools are defined in `apps/api/src/tools/registry.ts`. No delegation meta-tools exist – agent routing is handled by the Decision Engine's `agent` field.

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
| **Logs** | `logs_getStagingLogs` |

### Agent → Tool Mapping

| Agent | Allowed Tools |
|-------|---------------|
| `developer` | `fs_*`, `git_*` |
| `searcher` | `web_search`, `web_fetch`, `context_*` |
| `document_manager` | `fs_*` |
| `commander` | `bash_execute`, `ssh_execute`, `git_*`, `github_*`, `pm2_*`, `npm_*` |
| Looper (direct) | `memory_*` |

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

Currently operating in trusted/sandbox mode (`DEFAULT_TRUST_MODE: 'trusted'`). All tools execute without per-tool user confirmation.

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

### Looper Chat (Primary)

```
POST /api/looper
Content-Type: application/json
Response: application/x-ndjson (streaming)

{
  "message": "Wie ist das Wetter in Darmstadt?",
  "provider": "anthropic" | "openai" | "gemini",
  "sessionId": "optional",
  "projectRoot": "/path/to/project",
  "skillIds": ["skill1"],
  "config": {
    "maxIterations": 25,
    "maxConversationTokens": 120000,
    "maxToolRetries": 3,
    "minValidationConfidence": 0.7,
    "selfValidationEnabled": true
  }
}
```

### Looper Prompts (Debug)

```
GET /api/looper/prompts

Response:
{
  "looper.core": "...",
  "looper.decision": "...",
  "looper.validation": "...",
  "looper.agent.developer": "...",
  "looper.agent.searcher": "...",
  "looper.agent.document_manager": "...",
  "looper.agent.commander": "..."
}
```

### Continue After Pause

When the loop pauses (clarify / exhaustion), the user sends another message to the same session. The engine calls `continueWithClarification()` which resets the iteration counter and resumes the conversation.

---

## Frontend Integration

The `ChatUI.tsx` component connects to the Looper via NDJSON streaming:

```typescript
// Process streaming events
handleEvent(event: LooperStreamEvent) {
  switch (event.type) {
    case 'thinking':  // Show iteration indicator
    case 'step':      // Show decision details
    case 'tool_call': // Show tool being called
    case 'tool_result': // Show tool output
    case 'answer':    // Display final answer
    case 'clarify':   // Show question, enable user input
    case 'validation': // Show confidence score
    case 'error':     // Display error
  }
}
```

**UI Components:**
- `ChatUI`: Main chat interface with streaming support
- `AgentStatus`: Shows which agent is active
- `AgentHistory`: Detailed history with tool calls and results
