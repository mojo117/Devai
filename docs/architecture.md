# DevAI Architecture

This document describes the architecture of DevAI, including the multi-agent system for handling complex tasks.

<div style="position: sticky; top: 0; background: #1a1a2e; padding: 12px 16px; border-radius: 8px; border: 1px solid #333; margin-bottom: 20px; z-index: 100;">

**Navigation:** [Overview](#overview) · [Project Structure](#project-structure) · [Single-Agent](#single-agent-mode) · [Multi-Agent](#multi-agent-mode) · [Agents](#agents) · [Request Flow](#request-flow) · [Approval Flow](#approval-flow) · [State Management](#state-management) · [Streaming](#streaming-protocol) · [Tools](#tool-registry) · [Security](#security) · [API](#api-endpoints) · [Frontend](#frontend-integration)

</div>

---

## Overview

DevAI is an AI-powered development assistant that can execute code changes, manage deployments, and handle DevOps operations. It operates in two modes:

1. **Single-Agent Mode**: Traditional chat with one LLM, per-tool confirmation for risky operations
2. **Multi-Agent Mode**: 3-agent orchestration with task-level approval and autonomous execution

---

## Project Structure

```
apps/
├── api/                      # Fastify API server
│   └── src/
│       ├── agents/           # Multi-agent system
│       │   ├── types.ts      # TypeScript interfaces
│       │   ├── chapo.ts      # CHAPO agent definition
│       │   ├── koda.ts       # KODA agent definition
│       │   ├── devo.ts       # DEVO agent definition
│       │   ├── router.ts     # Orchestration & routing
│       │   └── stateManager.ts
│       ├── tools/            # Tool implementations
│       │   ├── registry.ts   # Tool definitions
│       │   ├── executor.ts   # Execution engine
│       │   ├── fs.ts         # File system
│       │   ├── git.ts        # Git operations
│       │   ├── github.ts     # GitHub API
│       │   ├── bash.ts       # Bash execution
│       │   ├── ssh.ts        # SSH execution
│       │   └── pm2.ts        # PM2 management
│       ├── routes/           # API routes
│       │   └── chat.ts       # Chat endpoints
│       ├── llm/              # LLM integration
│       │   ├── router.ts     # Provider routing
│       │   └── providers/    # Anthropic, OpenAI, etc.
│       ├── actions/          # Action approval system
│       └── audit/            # Audit logging
├── web/                      # React frontend
│   └── src/
│       ├── api.ts            # API client
│       ├── components/
│       │   ├── ChatUI.tsx    # Main chat interface
│       │   ├── AgentStatus.tsx
│       │   └── AgentHistory.tsx
│       └── types.ts
└── shared/                   # Shared types
```

---

## Single-Agent Mode

The traditional mode where a single LLM handles all requests:

```
┌─────────────────────────────────────────────────────────────────┐
│                      SINGLE-AGENT FLOW                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User Message → LLM → Tool Calls → Confirmation* → Execution    │
│                                                                  │
│  * Tools with requiresConfirmation: true need user approval     │
│                                                                  │
│  POST /api/chat                                                  │
│  - Uses askForConfirmation tool for risky operations            │
│  - Creates pending actions for user approval                    │
│  - Each tool requires individual confirmation                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Multi-Agent Mode

The 3-agent system for complex tasks:

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
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ Ask User     │  │ Request      │  │ Delegate to  │  │ Delegate to  │    │
│  │ (clarify)    │  │ Approval     │  │ KODA (code)  │  │ DEVO (ops)   │    │
│  └──────────────┘  └──────────────┘  └──────┬───────┘  └──────┬───────┘    │
└─────────────────────────────────────────────┼──────────────────┼────────────┘
                                              │                  │
                    ┌─────────────────────────┴──────────────────┴─────────┐
                    ▼                                                       ▼
┌─────────────────────────────────────┐   ┌─────────────────────────────────────┐
│        KODA (Senior Developer)       │   │        DEVO (DevOps Engineer)        │
│  Model: Claude Sonnet 4              │   │  Model: Claude Sonnet 4              │
│                                      │   │                                      │
│  Capabilities: CODE OPERATIONS       │   │  Capabilities: DEVOPS OPERATIONS     │
│  • fs.writeFile, fs.edit            │   │  • bash.execute, ssh.execute         │
│  • fs.mkdir, fs.move, fs.delete     │   │  • git.commit, git.push, git.pull    │
│  • fs.readFile, fs.glob (read-only) │   │  • pm2.restart, pm2.logs, pm2.status │
│                                      │   │  • npm.install, npm.run              │
│  Can escalate to: CHAPO              │   │  Can escalate to: CHAPO              │
└─────────────────────────────────────┘   └─────────────────────────────────────┘
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

---

## Request Flow

### Phase 1: Qualification (CHAPO)

```
1. User request received
2. CHAPO gathers context using read-only tools:
   - fs.glob() → find relevant files
   - fs.readFile() → understand code
   - git.status() → check current state

3. Task classification:
   - Type: code_change | devops | mixed | unclear
   - Risk: low | medium | high
   - Target Agent: koda | devo | null (parallel)

4. Decision:
   - Unclear? → askUser() for clarification
   - High risk? → requestApproval() from user
   - Code work? → delegateToKoda()
   - DevOps work? → delegateToDevo()
   - Mixed? → parallel execution
```

### Phase 2: Execution (KODA and/or DEVO)

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

### Phase 3: Review (CHAPO)

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
| Single-Agent | Each risky tool needs individual confirmation via `askForConfirmation` |
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
  activeAgent: 'chapo' | 'koda' | 'devo';

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

### Single-Agent Chat

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

- `AgentStatus`: Shows active agent (CHAPO/KODA/DEVO) and current phase
- `AgentTimeline`: Chronological view of agent actions
- `AgentHistory`: Detailed history with tool calls and results

---

## Example Flows

### Code Change (Single-Agent)

```
User: "Add error handling to login.ts"
LLM: Calls askForConfirmation(fs.edit, {...})
User: Approves
System: Executes fs.edit
LLM: Reports completion
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
