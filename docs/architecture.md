# DevAI Architecture

This document describes the architecture of DevAI, including the Looper orchestrator and the multi-agent system.

<div style="position: sticky; top: 0; background: #1a1a2e; padding: 12px 16px; border-radius: 8px; border: 1px solid #333; margin-bottom: 20px; z-index: 100;">

**Navigation:** [Overview](#overview) · [Project Structure](#project-structure) · [Looper](#looper-ai-orchestrator) · [Multi-Agent](#multi-agent-system) · [Prompts](#prompt-architecture) · [Request Flow](#request-flow) · [Approval Flow](#approval-flow) · [State Management](#state-management) · [Streaming](#streaming-protocol) · [Tools](#tool-registry) · [Security](#security) · [API](#api-endpoints) · [Frontend](#frontend-integration)

</div>

---

## Overview

DevAI is an AI-powered development assistant that can execute code changes, manage deployments, and handle DevOps operations. It uses a two-tier architecture:

1. **Looper-AI** (User-facing orchestrator): Iterative loop engine that talks directly to the user, classifies intents, and delegates work to specialized agents
2. **Multi-Agent System** (Sub-agents): 4 specialized agents (CHAPO, KODA, DEVO, SCOUT) that execute delegated tasks with tool isolation

```
                    ┌──────────────────────────┐
                    │         USER             │
                    └────────────┬─────────────┘
                                 ▼
              ┌──────────────────────────────────────┐
              │          LOOPER-AI ENGINE             │
              │  Decision Engine → Agent Routing      │
              │  Self-Validation → Conversation Mgmt  │
              │                                       │
              │  Sub-Agents:                          │
              │  ┌───────────┐ ┌───────────────────┐ │
              │  │ Developer │ │ Document Manager  │ │
              │  ├───────────┤ ├───────────────────┤ │
              │  │ Searcher  │ │ Commander         │ │
              │  └───────────┘ └───────────────────┘ │
              └──────────────────┬───────────────────┘
                                 │ delegates complex tasks
                                 ▼
              ┌──────────────────────────────────────┐
              │        MULTI-AGENT SYSTEM            │
              │  ┌───────┐ ┌──────┐ ┌──────┐ ┌─────┐│
              │  │ CHAPO │ │ KODA │ │ DEVO │ │SCOUT││
              │  └───────┘ └──────┘ └──────┘ └─────┘│
              └──────────────────────────────────────┘
```

---

## Project Structure

```
apps/
├── api/                          # Fastify API server
│   └── src/
│       ├── prompts/              # Central prompt directory (all German)
│       │   ├── index.ts          # Re-exports all prompts
│       │   ├── looper-core.ts    # LOOPER_CORE_SYSTEM_PROMPT
│       │   ├── decision-engine.ts# DECISION_SYSTEM_PROMPT
│       │   ├── self-validation.ts# VALIDATION_SYSTEM_PROMPT
│       │   ├── agent-developer.ts# DEV_SYSTEM_PROMPT
│       │   ├── agent-searcher.ts # SEARCH_SYSTEM_PROMPT
│       │   ├── agent-docmanager.ts# DOC_SYSTEM_PROMPT
│       │   ├── agent-commander.ts# CMD_SYSTEM_PROMPT
│       │   ├── chapo.ts          # CHAPO_SYSTEM_PROMPT
│       │   ├── koda.ts           # KODA_SYSTEM_PROMPT
│       │   ├── devo.ts           # DEVO_SYSTEM_PROMPT
│       │   ├── scout.ts          # SCOUT_SYSTEM_PROMPT
│       │   └── context.ts        # MEMORY_BEHAVIOR_BLOCK
│       ├── looper/               # Looper-AI engine
│       │   ├── engine.ts         # LooperEngine (main loop)
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
│       ├── agents/               # Multi-agent system
│       │   ├── chapo.ts          # CHAPO agent definition
│       │   ├── koda.ts           # KODA agent definition
│       │   ├── devo.ts           # DEVO agent definition
│       │   ├── scout.ts          # SCOUT agent definition
│       │   ├── router.ts         # Orchestration & routing
│       │   ├── stateManager.ts   # Session state
│       │   ├── events.ts         # Event emitters
│       │   ├── systemContext.ts  # Context builder
│       │   └── types.ts          # TypeScript interfaces
│       ├── tools/                # Tool implementations
│       │   ├── registry.ts       # Tool definitions
│       │   ├── executor.ts       # Execution engine
│       │   ├── fs.ts             # File system
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
│       ├── actions/              # Action approval system
│       ├── memory/               # Workspace memory
│       ├── skills/               # Skill loader & registry
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

### Architecture

```
User message
  → Decision Engine classifies intent
    → TOOL_CALL: Route to agent → execute tool → feed result as event
    → CLARIFY:   Return question → pause loop
    → ANSWER:    (optionally) self-validate → return to user
```

### Engine Configuration

```typescript
interface LooperConfig {
  maxIterations: 25;           // Max loop iterations per request
  maxConversationTokens: 120_000; // Token budget
  maxToolRetries: 3;           // Retries per tool failure
  minValidationConfidence: 0.7;// Self-validation threshold
  selfValidationEnabled: true; // Enable/disable self-check
}
```

### Components

| Component | File | Purpose |
|-----------|------|---------|
| **LooperEngine** | `looper/engine.ts` | Main loop: iterate until answer or max iterations |
| **DecisionEngine** | `looper/decision-engine.ts` | Classify intent: `tool_call`, `clarify`, `answer`, `self_validate`, `continue` |
| **ConversationManager** | `looper/conversation-manager.ts` | Manage dialog context within token budget |
| **SelfValidator** | `looper/self-validation.ts` | LLM reviews its own draft answer before delivery |
| **ErrorHandler** | `looper/error-handler.ts` | Track errors, manage retries |

### Looper Sub-Agents

These are lightweight agents used by the Looper to execute specific tool categories:

| Agent | Type | Purpose |
|-------|------|---------|
| **Developer** | `developer` | Code generation, editing, building |
| **Searcher** | `searcher` | Research, web search, documentation lookup |
| **Document Manager** | `document_manager` | Read, write, move, delete files |
| **Commander** | `commander` | Shell commands, git, GitHub operations |

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

---

## Multi-Agent System

The 4-agent system for complex tasks. CHAPO coordinates, KODA/DEVO execute, SCOUT explores.

```
                            ┌─────────────────────────────────────┐
                            │           USER REQUEST              │
                            └─────────────────┬───────────────────┘
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CHAPO (Task Coordinator)                              │
│  Model: Claude Opus 4.5                                                      │
│  Role: Task qualification, context gathering, delegation, review             │
│                                                                              │
│  Capabilities: READ-ONLY tools + delegation + user interaction              │
│                                                                              │
│  Actions:                                                                    │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│  │ Ask User     │ │ Request      │ │ Delegate to  │ │ Delegate to  │       │
│  │ (clarify)    │ │ Approval     │ │ KODA (code)  │ │ DEVO (ops)   │       │
│  └──────────────┘ └──────────────┘ └──────┬───────┘ └──────┬───────┘       │
└─────────────────────────────────────────────┼──────────────────┼────────────┘
                                              │                  │
                    ┌─────────────────────────┼──────────────────┼────────────┐
                    ▼                         │                  ▼            │
┌─────────────────────────────────────┐  │  ┌─────────────────────────────────────┐
│        KODA (Senior Developer)       │  │  │        DEVO (DevOps Engineer)        │
│  Model: Claude Sonnet 4              │  │  │  Model: Claude Sonnet 4              │
│                                      │  │  │                                      │
│  Capabilities: CODE OPERATIONS       │  │  │  Capabilities: DEVOPS OPERATIONS     │
│  - fs.writeFile, fs.edit            │  │  │  - bash.execute, ssh.execute         │
│  - fs.mkdir, fs.move, fs.delete     │  │  │  - git.commit, git.push, git.pull    │
│  - fs.readFile, fs.glob (read-only) │  │  │  - pm2.restart, pm2.logs, pm2.status │
│                                      │  │  │  - npm.install, npm.run              │
│  Can escalate to: CHAPO              │  │  │  Can escalate to: CHAPO              │
└─────────────────────────────────────┘  │  └─────────────────────────────────────┘
                                         │
                                         ▼
                    ┌─────────────────────────────────────┐
                    │      SCOUT (Exploration Specialist)  │
                    │  Model: Claude Sonnet 4              │
                    │  Fallback: Claude 3.5 Haiku          │
                    │                                      │
                    │  Capabilities: READ-ONLY             │
                    │  - fs.listFiles, fs.readFile         │
                    │  - fs.glob, fs.grep                  │
                    │  - git.status, git.diff              │
                    │  - web.search, web.fetch             │
                    │  - memory.remember, memory.search    │
                    │                                      │
                    │  Can escalate to: CHAPO              │
                    └─────────────────────────────────────┘
```

---

## Agents

### CHAPO - Task Coordinator

**Role:** Orchestrates the multi-agent workflow. Analyzes requests, gathers context, and delegates to specialized agents.

**Model:** `claude-opus-4-20250514`

**Tools:**
```
fs.listFiles, fs.readFile, fs.glob, fs.grep     (read-only)
git.status, git.diff                             (read-only)
github.getWorkflowRunStatus                      (read-only)
logs.getStagingLogs                              (read-only)
delegateToKoda, delegateToDevo                   (delegation)
askUser, requestApproval                         (user interaction)
```

**File:** `apps/api/src/agents/chapo.ts`
**Prompt:** `apps/api/src/prompts/chapo.ts`

---

### KODA - Senior Developer

**Role:** Handles all code-related tasks including writing, editing, and deleting files.

**Model:** `claude-sonnet-4-20250514`

**Tools:**
```
fs.writeFile, fs.edit, fs.mkdir, fs.move, fs.delete   (write)
fs.listFiles, fs.readFile, fs.glob, fs.grep           (read-only)
escalateToChapo                                        (escalation)
```

**File:** `apps/api/src/agents/koda.ts`
**Prompt:** `apps/api/src/prompts/koda.ts`

---

### DEVO - DevOps Engineer

**Role:** Handles DevOps operations including deployments, server management, and CI/CD.

**Model:** `claude-sonnet-4-20250514`

**Tools:**
```
bash.execute, ssh.execute                              (execution)
git.commit, git.push, git.pull, git.add               (git)
git.status, git.diff                                   (read-only)
github.triggerWorkflow, github.getWorkflowRunStatus   (CI/CD)
pm2.status, pm2.restart, pm2.stop, pm2.start          (PM2)
pm2.logs, pm2.reloadAll, pm2.save
npm.install, npm.run                                   (npm)
fs.listFiles, fs.readFile                              (read-only)
escalateToChapo                                        (escalation)
```

**File:** `apps/api/src/agents/devo.ts`
**Prompt:** `apps/api/src/prompts/devo.ts`

---

### SCOUT - Exploration Specialist

**Role:** Read-only codebase and web exploration. Gathers information without making any changes.

**Model:** `claude-sonnet-4-20250514` (fallback: `claude-3-5-haiku-20241022`)

**Tools:**
```
fs.listFiles, fs.readFile, fs.glob, fs.grep            (read-only)
git.status, git.diff                                    (read-only)
web.search, web.fetch                                   (web)
memory.remember, memory.search, memory.readToday       (memory)
escalateToChapo                                         (escalation)
```

**File:** `apps/api/src/agents/scout.ts`
**Prompt:** `apps/api/src/prompts/scout.ts`

---

## Prompt Architecture

All system prompts live in `apps/api/src/prompts/` and are written in German. JSON schema field names remain in English (they're parsed programmatically).

```
prompts/
├── index.ts               # Re-exports everything
│
├── Looper Prompts (German):
│   ├── looper-core.ts     # Main loop behavior
│   ├── decision-engine.ts # Intent classification rules + JSON schema
│   ├── self-validation.ts # Self-review criteria
│   ├── agent-developer.ts # Developer agent behavior
│   ├── agent-searcher.ts  # Searcher agent behavior
│   ├── agent-docmanager.ts# Document manager behavior
│   └── agent-commander.ts # Commander agent behavior
│
├── Multi-Agent Prompts (German):
│   ├── chapo.ts           # Coordinator: delegation, planning, review
│   ├── koda.ts            # Developer: code operations
│   ├── devo.ts            # DevOps: deployment, git, PM2
│   └── scout.ts           # Explorer: read-only research
│
└── Shared:
    └── context.ts         # MEMORY_BEHAVIOR_BLOCK (workspace memory rules)
```

Agent files import their prompt from this central directory:
```typescript
import { CHAPO_SYSTEM_PROMPT } from '../prompts/chapo.js';
```

---

## Request Flow

### Looper Flow (Primary)

```
POST /api/looper

1. User message received
2. LooperEngine starts iteration loop:

   Iteration N:
   ├── Decision Engine classifies the latest event
   ├── Intent: tool_call
   │   ├── Route to appropriate agent (developer/searcher/docmanager/commander)
   │   ├── Agent executes the tool
   │   └── Result fed back as event → next iteration
   ├── Intent: clarify
   │   ├── Stream question to user
   │   └── Pause loop (resume on user response)
   ├── Intent: answer
   │   ├── Self-validation (if enabled)
   │   │   ├── Confidence >= 0.7 → deliver answer
   │   │   └── Confidence < 0.7 → iterate with suggestions
   │   └── Stream final response
   └── Intent: continue
       └── Next iteration (agent needs more steps)

3. Loop ends when: answer delivered, max iterations, or token budget exhausted
```

### Multi-Agent Flow

#### Phase 1: Qualification (CHAPO)

```
1. User request received
2. CHAPO gathers context using read-only tools:
   - fs.glob() → find relevant files
   - fs.readFile() → understand code
   - git.status() → check current state

3. Task classification:
   - Type: code_change | devops | mixed | unclear
   - Risk: low | medium | high
   - Target Agent: koda | devo | scout | null (parallel)

4. Decision:
   - Unclear? → askUser() for clarification
   - High risk? → requestApproval() from user
   - Code work? → delegateToKoda()
   - DevOps work? → delegateToDevo()
   - Exploration? → SCOUT handles directly
   - Mixed? → parallel execution
```

#### Phase 2: Execution (KODA / DEVO / SCOUT)

```
Agent receives:
- Original request
- Context gathered by CHAPO
- Specific instructions

Agent executes:
- Uses specialized tools
- Tools execute directly (no per-tool confirmation)
- On error: escalateToChapo() for help

Parallel Execution (mixed tasks):
- KODA and DEVO work simultaneously
- Results are combined at the end
```

#### Phase 3: Review (CHAPO)

```
CHAPO reviews execution results:
1. Verifies changes were made correctly
2. Checks for errors
3. Creates user-friendly summary
4. Suggests next steps if needed
```

---

## Approval Flow

The multi-agent system uses a **one-time approval** model:

| Mode | Approval Model |
|------|----------------|
| Looper | Approval bridge for risky tools via `onActionPending` callback |
| Multi-Agent | One approval at CHAPO level, then KODA/DEVO execute autonomously |

```
Multi-Agent Approval Flow:

1. CHAPO qualifies the task
2. If risky (high risk level):
   → CHAPO requests user approval
   → User sees: task description, risk level, target agent
   → User approves or rejects
3. Once approved:
   → approvalGranted = true (stored in session state)
   → KODA/DEVO execute ALL tools directly
   → No per-tool confirmation popups
```

---

## State Management

Session state is managed in-memory with a 24-hour TTL.

**File:** `apps/api/src/agents/stateManager.ts`

```typescript
interface ConversationState {
  sessionId: string;
  currentPhase: 'qualification' | 'execution' | 'review' | 'error' | 'waiting_user';
  activeAgent: 'chapo' | 'koda' | 'devo' | 'scout';

  taskContext: {
    originalRequest: string;
    qualificationResult?: QualificationResult;
    gatheredFiles: string[];
    gatheredInfo: Record<string, unknown>;
    approvalGranted: boolean;
    approvalTimestamp?: string;
  };

  agentHistory: AgentHistoryEntry[];
  pendingApprovals: ApprovalRequest[];
  pendingQuestions: UserQuestion[];
  parallelExecutions: ParallelExecution[];
}
```

### Key Functions

| Function | Description |
|----------|-------------|
| `getOrCreateState(sessionId)` | Get or initialize session state |
| `setPhase(sessionId, phase)` | Update current phase |
| `setActiveAgent(sessionId, agent)` | Switch active agent |
| `grantApproval(sessionId)` | Mark session as approved |
| `isApprovalGranted(sessionId)` | Check if approval was granted |
| `addHistoryEntry(...)` | Log agent action to history |
| `startParallelExecution(...)` | Begin parallel KODA+DEVO execution |

---

## Streaming Protocol

Events are streamed via NDJSON (`application/x-ndjson`):

```typescript
// Looper events
{ type: 'looper_step', step: { intent, agent, toolName, ... } }
{ type: 'looper_thinking', status: 'Iteration 3...' }
{ type: 'looper_clarify', question: '...' }

// Agent lifecycle
{ type: 'agent_start', agent: 'chapo', phase: 'qualification' }
{ type: 'agent_switch', from: 'chapo', to: 'koda', reason: '...' }
{ type: 'agent_thinking', agent: 'koda', status: 'Turn 1...' }
{ type: 'agent_complete', agent: 'koda', result: '...' }

// Tool execution
{ type: 'tool_call', agent: 'koda', toolName: 'fs.edit', args: {...} }
{ type: 'tool_result', agent: 'koda', toolName: 'fs.edit', result: {...}, success: true }

// Delegation & escalation
{ type: 'delegation', from: 'chapo', to: 'koda', task: '...' }
{ type: 'escalation', from: 'koda', issue: {...} }

// User interaction
{ type: 'user_question', question: {...} }
{ type: 'approval_request', request: {...} }

// Parallel execution
{ type: 'parallel_start', agents: ['koda', 'devo'], tasks: [...] }
{ type: 'parallel_complete', results: [...] }

// History & errors
{ type: 'agent_history', entries: [...] }
{ type: 'error', agent: 'devo', error: '...' }

// Final response
{ type: 'response', response: {...} }
```

---

## Tool Registry

Tools are defined in `apps/api/src/tools/registry.ts`:

| Tool | Description | Requires Confirmation |
|------|-------------|----------------------|
| `fs.listFiles` | List directory contents | No |
| `fs.readFile` | Read file contents | No |
| `fs.writeFile` | Write file | Yes* |
| `fs.edit` | Edit file (find/replace) | Yes* |
| `fs.mkdir` | Create directory | Yes* |
| `fs.move` | Move/rename file | Yes* |
| `fs.delete` | Delete file/directory | Yes* |
| `fs.glob` | Find files by pattern | No |
| `fs.grep` | Search file contents | No |
| `git.status` | Git status | No |
| `git.diff` | Git diff | No |
| `git.commit` | Create commit | Yes* |
| `git.push` | Push to remote | Yes* |
| `git.pull` | Pull from remote | Yes* |
| `git.add` | Stage files | No |
| `github.triggerWorkflow` | Trigger GitHub Action | Yes* |
| `github.getWorkflowRunStatus` | Get workflow status | No |
| `bash.execute` | Execute bash command | Yes* |
| `ssh.execute` | Execute via SSH | Yes* |
| `pm2.status` | PM2 status | No |
| `pm2.restart` | Restart PM2 process | Yes* |
| `pm2.stop` | Stop PM2 process | Yes* |
| `pm2.start` | Start PM2 process | Yes* |
| `pm2.logs` | Get PM2 logs | No |
| `pm2.reloadAll` | Reload all processes | Yes* |
| `pm2.save` | Save PM2 config | Yes* |
| `npm.install` | npm install | Yes* |
| `npm.run` | npm run script | Yes* |
| `web.search` | Web search | No |
| `web.fetch` | Fetch URL content | No |
| `memory.remember` | Store memory | No |
| `memory.search` | Search memory | No |
| `memory.readToday` | Read today's memory | No |

*In multi-agent mode, `requiresConfirmation` is bypassed after CHAPO approval.

---

## Security

### Agent Tool Isolation

Each agent can only execute tools in its allowed list:

```typescript
// In router.ts
if (!canAgentUseTool(targetAgent, toolCall.name)) {
  return error; // Tool blocked
}
```

### Whitelist Enforcement

All tools must be in the registry whitelist:

```typescript
// In executor.ts
if (!isToolWhitelisted(toolName)) {
  return { success: false, error: 'Tool not whitelisted' };
}
```

### SSH Host Aliases

SSH connections use predefined host aliases:

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
  "message": "Fix the login bug",
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

### Multi-Agent Chat

```
POST /api/chat/agents
Content-Type: application/json

{
  "message": "Deploy the latest changes",
  "projectRoot": "/path/to/project",
  "sessionId": "optional"
}
```

### Single-Agent Chat (Legacy)

```
POST /api/chat
Content-Type: application/json

{
  "messages": [...],
  "provider": "anthropic",
  "projectRoot": "/path/to/project",
  "skillIds": ["skill1"],
  "pinnedFiles": ["file1.ts"],
  "sessionId": "optional"
}
```

### Get Agent State

```
GET /api/chat/agents/:sessionId/state

Response:
{
  "sessionId": "...",
  "currentPhase": "execution",
  "activeAgent": "koda",
  "agentHistory": [...],
  "pendingApprovals": [],
  "pendingQuestions": []
}
```

---

## Frontend Integration

The `ChatUI.tsx` component supports both modes:

```typescript
// Multi-agent mode state
const [multiAgentMode, setMultiAgentMode] = useState(false);
const [activeAgent, setActiveAgent] = useState<AgentName | null>(null);
const [agentPhase, setAgentPhase] = useState<AgentPhase>('idle');
const [agentHistory, setAgentHistory] = useState<AgentHistoryEntry[]>([]);

// Mode selection
if (multiAgentMode) {
  await sendMultiAgentMessage(content, projectRoot, sessionId, handleEvent);
} else {
  await sendMessage(messages, provider, ...);
}
```

**UI Components:**

- `AgentStatus`: Shows active agent (CHAPO/KODA/DEVO/SCOUT) and current phase
- `AgentTimeline`: Chronological view of agent actions
- `AgentHistory`: Detailed history with tool calls and results

---

## Example Flows

### Code Fix (Looper)

```
User: "Fix the login validation bug"
Looper Decision: tool_call → developer agent
Developer: fs.readFile("auth/login.ts")
Looper Decision: tool_call → developer agent
Developer: fs.edit("auth/login.ts", ...)
Looper Decision: answer
Self-Validation: confidence 0.85 → deliver
Looper: Streams response to user
```

### Code Change (Multi-Agent)

```
User: "Add error handling to login.ts"
CHAPO: Qualifies as code_change, low risk
CHAPO: Delegates to KODA
KODA: Executes fs.edit directly (no confirmation)
CHAPO: Reviews and reports
```

### Deployment (Multi-Agent)

```
User: "Deploy to staging"
CHAPO: Qualifies as devops, medium risk
CHAPO: Requests approval
User: Approves
CHAPO: Delegates to DEVO
DEVO: git add → git commit → git push
DEVO: Triggers workflow
CHAPO: Reviews and reports status
```

### Exploration (Multi-Agent)

```
User: "What does the auth module do?"
CHAPO: Qualifies as exploration, read-only
SCOUT: fs.glob("**/auth/**")
SCOUT: fs.readFile(relevant files)
SCOUT: Summarizes findings
CHAPO: Reviews and delivers to user
```

### Mixed Task (Multi-Agent)

```
User: "Fix the bug and deploy"
CHAPO: Qualifies as mixed, requests approval
User: Approves
CHAPO: Starts parallel execution
KODA: Fixes bug (fs.edit)       ─┐
DEVO: Waits, then deploys        ├─ Parallel
CHAPO: Combines results and reports
```
