# Tier 5: Deferred — Safety & Control Features

> Moved from Tier 3. Lower priority than code quality improvements (#10 Architect/Editor).
> These remain fully designed and ready to implement when needed.

---

## #11. Plan Mode / Pre-Execution Planning

**Effort**: ~3 days | **Impact**: Users approve changes before code is modified
**Engine**: ALL

### Problem

CHAPO's `chapo_plan_set` tool exists but is cosmetic — it sets a plan string shown in the UI but doesn't gate execution. The agent can (and does) start editing files before the user has reviewed the plan. Claude Code's `EnterPlanMode` solves this by making planning a distinct phase with user approval gates.

### Current State

```typescript
// chapoControlTools.ts — setChapoPlan()
// Stores plan in gatheredInfo.chapoPlan:
{
  planId: string;
  version: number;
  title: string;
  steps: ChapoPlanStep[];   // { id, text, owner, status }
  updatedAt: string;
}
```

Frontend renders this as a checklist. But there's no mechanism to:
- Block execution until user approves the plan
- Let user modify steps before execution
- Track which steps have been executed

### Design

#### Phase 1: Plan Gate

Add a `planMode` flag that forces CHAPO to produce a plan first and wait for user approval before executing file-modifying tools.

```
User request
    │
    ▼
CHAPO iteration 0: Read files, analyze
    │
    ▼
CHAPO iteration 1: Call chapo_plan_set with structured plan
    │
    ▼
[PLAN GATE] — askUser with plan summary, wait for approval
    │
    ├── User approves → Continue with execution
    ├── User modifies → Update plan, continue
    └── User rejects → Respond with "OK, plan rejected"
```

#### Phase 2: Plan-Guided Execution

Once approved, the plan becomes a checklist that guides execution:
- CHAPO sets each step to `doing` before starting it
- Sets to `done` after successful execution
- Sets to `blocked` if it encounters issues
- Frontend shows live progress

### Files to Create/Modify

#### 1. `apps/api/src/agents/chapo-loop/planGate.ts` — NEW

```typescript
import * as stateManager from '../stateManager.js';

export interface PlanGateConfig {
  enabled: boolean;
  autoApproveThreshold?: number;
}

export function isPlanModeActive(sessionId: string): boolean {
  const state = stateManager.getState(sessionId);
  const mode = state?.taskContext.gatheredInfo.planMode;
  return mode === true || mode === 'active';
}

export function isPlanApproved(sessionId: string): boolean {
  const state = stateManager.getState(sessionId);
  const plan = state?.taskContext.gatheredInfo.chapoPlan as Record<string, unknown> | undefined;
  return plan?.approved === true;
}

export function approvePlan(sessionId: string): void {
  const state = stateManager.getState(sessionId);
  const plan = state?.taskContext.gatheredInfo.chapoPlan as Record<string, unknown> | undefined;
  if (plan) {
    stateManager.setGatheredInfo(sessionId, 'chapoPlan', { ...plan, approved: true });
  }
}

export function requiresPlanApproval(toolName: string): boolean {
  const FILE_MODIFYING_TOOLS = new Set([
    'fs_writeFile', 'fs_edit', 'fs_mkdir', 'fs_move', 'fs_delete',
    'git_commit', 'git_push', 'bash_execute',
  ]);
  return FILE_MODIFYING_TOOLS.has(toolName);
}
```

#### 2. `toolExecutor.ts` — Plan gate check before file-modifying tools
#### 3. `chapoControlTools.ts` — Enhanced `setChapoPlan` with `approved: false` flag
#### 4. System prompt injection when plan mode active
#### 5. Activation via `/plan` command, engine config, or frontend setting

### Verification

1. Activate plan mode: `/plan`
2. Send "refactor the auth module to use JWT"
3. CHAPO should: read files → create plan → ask user for approval
4. Approve → CHAPO executes step by step with status updates
5. Verify file-modifying tools are blocked before plan approval

---

## #12. Sandboxed Execution Environment

**Effort**: ~5 days | **Impact**: Safety net for bash execution, especially with non-Claude models
**Engine**: ALL (critical for `/engine glm` where tool arguments are sometimes wrong)

### Problem

`bash_execute` runs commands directly on the host with only pattern blocking and path restrictions. Current safety:
- Regex blocklist (7 patterns)
- Path restrictions (`allowedRoots`)
- Timeout (15s default)
- Output limit (100KB)

### Design: OverlayFS + Namespaces (No Docker)

```
┌────────────────────────────────────┐
│  Sandbox (mount + PID namespace)   │
│                                    │
│  OverlayFS:                        │
│    lower = /opt/Klyde/projects/X   │  ← Read-only real filesystem
│    upper = /tmp/devai-sandbox-XXX  │  ← Writes go here
│    merged = /sandbox/workspace     │  ← Agent sees this
│                                    │
│  Network: host (for npm, etc.)     │
│  PID: isolated (kill on timeout)   │
│  User: same uid (for file access)  │
└────────────────────────────────────┘
```

### Files to Create

- `apps/api/src/sandbox/overlay.ts` — OverlaySandbox class (setup/execute/commit/cleanup)
- `apps/api/src/sandbox/sandboxedBash.ts` — Wrapper for bash_execute
- Modify `apps/api/src/tools/bash.ts` — Sandbox mode integration
- Modify `apps/api/src/config.ts` — `sandboxBashEnabled`, `sandboxAutoCommit`
- Modify `apps/api/src/llm/engineProfiles.ts` — `sandboxBash` flag per engine

### Engine Mapping

| Engine | Sandbox Default | Rationale |
|--------|----------------|-----------|
| `/engine glm` | On | GLM-5 occasionally hallucinates tool args |
| `/engine kimi` | On | Kimi can be creative with bash commands |
| `/engine claude` | Off | Claude is reliable with bash |
| `/engine gemini` | On | Less tested, safer with sandbox |

### Prerequisites

- Linux kernel 3.18+ (OverlayFS) — Klyde server has 6.8
- Root access — Klyde runs as root
- `/tmp` space for overlay directories
