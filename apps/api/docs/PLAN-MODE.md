# Plan Mode + Task Tracking

**Last Updated**: 2026-01-24

## Overview

Plan Mode is a multi-perspective planning system that leverages the three-agent architecture (CHAPO, KODA, DEVO) to create comprehensive execution plans for complex tasks. Instead of immediately executing tasks, the system first gathers perspectives from all relevant agents, synthesizes them into a plan with concrete tasks, and waits for user approval before execution.

## When Plan Mode is Triggered

Plan Mode is automatically triggered when a task meets any of these criteria:

| Condition | Description |
|-----------|-------------|
| `taskType === 'mixed'` | Task requires both code changes and DevOps operations |
| `complexity === 'complex'` | Task is classified as complex during qualification |
| `riskLevel === 'high'` | Task is classified as high-risk |

```typescript
function determinePlanModeRequired(qualification: QualificationResult): boolean {
  if (qualification.taskType === 'mixed') return true;
  if (qualification.complexity === 'complex') return true;
  if (qualification.riskLevel === 'high') return true;
  return false;
}
```

## Architecture

### Flow Diagram

```
User Request
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│              CHAPO QUALIFICATION PHASE                      │
│  - Analyzes task type, risk, complexity                     │
│  - Gathers initial context                                  │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
  Plan Mode Required?
    │
    ├── No ──► Direct Execution (existing flow)
    │
    ▼ Yes
┌─────────────────────────────────────────────────────────────┐
│                    PLAN MODE START                          │
│                  (plan_start event)                         │
├─────────────────────────────────────────────────────────────┤
│  1. CHAPO STRATEGIC PERSPECTIVE                             │
│     - Risk assessment                                       │
│     - Impact areas                                          │
│     - Coordination needs                                    │
│     (perspective_start/complete events)                     │
├─────────────────────────────────────────────────────────────┤
│  2. KODA + DEVO PERSPECTIVES (parallel)                     │
│                                                             │
│  KODA (Code):              DEVO (DevOps):                   │
│  - Affected files          - Deployment impact              │
│  - Code patterns           - Rollback strategy              │
│  - Breaking changes        - Services affected              │
│  - Testing needs           - Infrastructure changes         │
│  (read-only tools)         (read-only tools)                │
├─────────────────────────────────────────────────────────────┤
│  3. CHAPO SYNTHESIS                                         │
│     - Combines all perspectives                             │
│     - Creates ExecutionPlan with PlanTasks                  │
│     - Sets dependencies between tasks                       │
│     (plan_ready event)                                      │
├─────────────────────────────────────────────────────────────┤
│  4. WAITING FOR APPROVAL                                    │
│     (plan_approval_request event)                           │
│     (phase: waiting_plan_approval)                          │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
  User Decision
    │
    ├── Reject ──► Plan rejected, return to qualification
    │              (plan_rejected event)
    │
    ▼ Approve
┌─────────────────────────────────────────────────────────────┐
│               PLAN EXECUTION                                │
│  (plan_approved event)                                      │
│                                                             │
│  For each task (respecting dependencies):                   │
│    1. task_started event                                    │
│    2. Delegate to assigned agent (KODA or DEVO)             │
│    3. task_completed/task_failed event                      │
│    4. If failed: skip dependent tasks                       │
│                                                             │
│  When all tasks done:                                       │
│    - Plan marked as completed                               │
│    - Summary returned to user                               │
└─────────────────────────────────────────────────────────────┘
```

## Types

### Agent Perspectives

```typescript
// Base perspective interface
interface AgentPerspective {
  agent: AgentName;
  analysis: string;
  concerns: string[];
  recommendations: string[];
  estimatedEffort: 'trivial' | 'small' | 'medium' | 'large';
  dependencies?: string[];
  timestamp: string;
}

// CHAPO's strategic perspective
interface ChapoPerspective extends AgentPerspective {
  agent: 'chapo';
  strategicAnalysis: string;
  riskAssessment: 'low' | 'medium' | 'high';
  impactAreas: string[];
  coordinationNeeds: string[];
}

// KODA's code-focused perspective
interface KodaPerspective extends AgentPerspective {
  agent: 'koda';
  affectedFiles: string[];
  codePatterns: string[];
  potentialBreakingChanges: string[];
  testingRequirements: string[];
}

// DEVO's ops-focused perspective
interface DevoPerspective extends AgentPerspective {
  agent: 'devo';
  deploymentImpact: string[];
  rollbackStrategy: string;
  servicesAffected: string[];
  infrastructureChanges: string[];
}
```

### Execution Plan

```typescript
type PlanStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'executing' | 'completed';

interface ExecutionPlan {
  planId: string;
  sessionId: string;
  status: PlanStatus;

  // Multi-perspective analysis
  chapoPerspective: ChapoPerspective;
  kodaPerspective?: KodaPerspective;
  devoPerspective?: DevoPerspective;

  // Synthesized plan
  summary: string;
  tasks: PlanTask[];
  estimatedDuration: string;
  overallRisk: 'low' | 'medium' | 'high';

  // Timestamps
  createdAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
}
```

### Plan Tasks

```typescript
type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
type TaskPriority = 'critical' | 'high' | 'normal' | 'low';

interface PlanTask {
  taskId: string;
  planId: string;

  // Task definition
  subject: string;          // "Update API endpoint"
  description: string;      // Detailed description
  activeForm: string;       // "Updating API endpoint..." (for spinner)

  // Assignment
  assignedAgent: 'chapo' | 'koda' | 'devo';
  priority: TaskPriority;

  // Status tracking
  status: TaskStatus;
  progress?: number;        // 0-100

  // Dependencies
  blockedBy: string[];      // Task IDs that must complete first
  blocks: string[];         // Task IDs waiting on this

  // Execution details
  toolsToExecute?: PlannedToolCall[];
  toolsExecuted?: ExecutedTool[];

  // Timestamps
  createdAt: string;
  startedAt?: string;
  completedAt?: string;

  // Results
  result?: string;
  error?: string;
}
```

## Stream Events

### Plan Mode Events

| Event | Payload | When |
|-------|---------|------|
| `plan_start` | `{ sessionId }` | Plan mode begins |
| `perspective_start` | `{ agent }` | Agent starts analysis |
| `perspective_complete` | `{ agent, perspective }` | Agent completes analysis |
| `plan_ready` | `{ plan }` | Plan finalized |
| `plan_approval_request` | `{ plan }` | Waiting for user approval |
| `plan_approved` | `{ planId }` | User approved plan |
| `plan_rejected` | `{ planId, reason }` | User rejected plan |

### Task Tracking Events

| Event | Payload | When |
|-------|---------|------|
| `task_created` | `{ task }` | Task added to plan |
| `task_update` | `{ taskId, status, progress?, activeForm? }` | Task status changed |
| `task_started` | `{ taskId, agent }` | Task execution begins |
| `task_completed` | `{ taskId, result? }` | Task succeeded |
| `task_failed` | `{ taskId, error }` | Task failed |
| `tasks_list` | `{ tasks }` | Full task list |

## API Endpoints

### Approve/Reject Plan

```
POST /chat/agents/plan/approval
```

**Request:**
```json
{
  "sessionId": "abc123",
  "planId": "plan_xyz",
  "approved": true,
  "reason": "Optional rejection reason"
}
```

**Response:** NDJSON stream with execution events

### Get Current Plan

```
GET /chat/agents/:sessionId/plan
```

**Response:**
```json
{
  "plan": { /* ExecutionPlan */ },
  "progress": {
    "total": 5,
    "pending": 2,
    "inProgress": 1,
    "completed": 2,
    "failed": 0,
    "skipped": 0,
    "percentComplete": 40
  }
}
```

### Get Tasks

```
GET /chat/agents/:sessionId/tasks
```

**Response:**
```json
{
  "tasks": [ /* PlanTask[] */ ],
  "progress": { /* same as above */ }
}
```

## State Manager Functions

### Plan Management

| Function | Description |
|----------|-------------|
| `createPlan(sessionId, chapoPerspective)` | Create new plan with CHAPO's perspective |
| `addKodaPerspective(sessionId, perspective)` | Add KODA's analysis |
| `addDevoPerspective(sessionId, perspective)` | Add DEVO's analysis |
| `finalizePlan(sessionId, summary, tasks)` | Set plan ready for approval |
| `approvePlan(sessionId)` | Mark plan as approved |
| `rejectPlan(sessionId, reason)` | Mark plan as rejected |
| `startPlanExecution(sessionId)` | Mark plan as executing |
| `completePlan(sessionId)` | Mark plan as completed |
| `getCurrentPlan(sessionId)` | Get current plan |
| `getPlanHistory(sessionId)` | Get past plans |

### Task Management

| Function | Description |
|----------|-------------|
| `createTask(sessionId, taskData)` | Create new task |
| `getTask(sessionId, taskId)` | Get task by ID |
| `getTasks(sessionId)` | Get all tasks |
| `getTasksInOrder(sessionId)` | Get tasks in execution order |
| `getNextTask(sessionId)` | Get next unblocked task |
| `updateTaskStatus(sessionId, taskId, status, options?)` | Update task status |
| `addTaskDependency(sessionId, taskId, blockedByTaskId)` | Add dependency |
| `addExecutedTool(sessionId, taskId, tool)` | Record tool execution |
| `getTasksByStatus(sessionId, status)` | Filter by status |
| `getTasksByAgent(sessionId, agent)` | Filter by agent |
| `areAllTasksCompleted(sessionId)` | Check if plan done |
| `getTaskProgress(sessionId)` | Get progress summary |
| `skipBlockedTasks(sessionId, failedTaskId)` | Skip dependent tasks |

## Router Functions

### Main Functions

| Function | Description |
|----------|-------------|
| `determinePlanModeRequired(qualification)` | Check if plan mode needed |
| `runPlanMode(sessionId, userMessage, qualification, sendEvent)` | Orchestrate planning |
| `executePlan(sessionId, sendEvent)` | Execute approved plan |
| `handlePlanApproval(sessionId, planId, approved, reason?, sendEvent?)` | Handle user decision |
| `getCurrentPlan(sessionId)` | Get plan (exported) |
| `getTasks(sessionId)` | Get tasks (exported) |

### Perspective Functions (internal)

| Function | Description |
|----------|-------------|
| `getChapoPerspective(...)` | Get CHAPO's strategic analysis |
| `getKodaPerspective(...)` | Get KODA's code analysis (read-only) |
| `getDevoPerspective(...)` | Get DEVO's ops analysis (read-only) |
| `synthesizePlan(...)` | CHAPO combines perspectives into tasks |

## Dependency-Aware Execution

Tasks are executed respecting their `blockedBy` dependencies:

1. `getNextTask()` returns only tasks where all `blockedBy` tasks are completed
2. When a task fails, `skipBlockedTasks()` marks all dependent tasks as `skipped`
3. Prevents deadlocks by checking for blocked tasks with no progress

```typescript
// Example task dependencies
[
  { taskId: "1", subject: "Create types", blockedBy: [], blocks: ["2", "3"] },
  { taskId: "2", subject: "Implement service", blockedBy: ["1"], blocks: ["4"] },
  { taskId: "3", subject: "Add tests", blockedBy: ["1"], blocks: ["4"] },
  { taskId: "4", subject: "Update docs", blockedBy: ["2", "3"], blocks: [] }
]

// Execution order: 1 → (2 || 3) → 4
```

## Example Session

```
User: "Refactor the auth system and deploy to staging"

1. CHAPO qualifies task:
   - taskType: "mixed"
   - complexity: "complex"
   - riskLevel: "medium"
   → Plan Mode Required

2. Plan Mode starts:
   → plan_start event

3. CHAPO Strategic Perspective:
   → perspective_start { agent: "chapo" }
   - riskAssessment: "medium"
   - impactAreas: ["auth module", "user sessions", "staging env"]
   - coordinationNeeds: ["code changes before deployment"]
   → perspective_complete

4. KODA + DEVO Perspectives (parallel):
   → perspective_start { agent: "koda" }
   → perspective_start { agent: "devo" }

   KODA (read-only exploration):
   - affectedFiles: ["src/auth/...", "src/middleware/..."]
   - potentialBreakingChanges: ["Session format change"]
   - testingRequirements: ["Auth flow tests", "Session migration test"]
   → perspective_complete { agent: "koda" }

   DEVO (read-only exploration):
   - deploymentImpact: ["PM2 restart required", "Clear session cache"]
   - rollbackStrategy: "git revert + PM2 reload"
   - servicesAffected: ["api", "worker"]
   → perspective_complete { agent: "devo" }

5. CHAPO Synthesis:
   Creates ExecutionPlan with tasks:
   - Task 1: "Update auth types" (KODA)
   - Task 2: "Refactor auth service" (KODA, blocked by 1)
   - Task 3: "Update auth middleware" (KODA, blocked by 2)
   - Task 4: "Add migration script" (KODA, blocked by 2)
   - Task 5: "Deploy to staging" (DEVO, blocked by 3, 4)
   → plan_ready event
   → plan_approval_request event

6. User approves:
   → plan_approved event

7. Execution:
   → task_started { taskId: "1", agent: "koda" }
   ... KODA executes ...
   → task_completed { taskId: "1" }

   → task_started { taskId: "2", agent: "koda" }
   ... and so on ...

8. Final result:
   "Plan ausgeführt (5/5 Tasks erfolgreich)"
```

## Related Files

| File | Purpose |
|------|---------|
| `agents/types.ts` | Type definitions |
| `agents/stateManager.ts` | State management |
| `agents/router.ts` | Plan mode orchestration |
| `routes/chat.ts` | API endpoints |

## Related Features

- [Permission Patterns](./PERMISSION-PATTERNS.md) - Tool permission system
- [CLAUDE.md Loading](./CLAUDE-MD.md) - Project instruction loading
- [Edit Enhancement](./EDIT-ENHANCEMENT.md) - replace_all for fs_edit
