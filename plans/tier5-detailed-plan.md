# Tier 5: Backlog — All Unfinished Features

> Consolidated 2026-02-27. All features not yet implemented from Tiers 2-4 + deferred items.
> Ready to implement when prioritized.

---

## TaskForge Tickets

| # | Feature | Ticket | Priority |
|---|---------|--------|----------|
| **7** | Sub-Agent Delegation | [TaskFlow:69a13a6](https://taskforge.klyde.tech/task/69a13a630033f7b01816) | Medium |
| **9** | Multi-Model Cost Routing | [TaskFlow:69a13a0](https://taskforge.klyde.tech/task/69a13a070037625d2d5f) | High |
| **10** | Architect/Editor Split | [TaskFlow:69a13a3](https://taskforge.klyde.tech/task/69a13a3c002e700ec953) | High |
| **11** | Plan Mode | [TaskFlow:69a13ac](https://taskforge.klyde.tech/task/69a13ac3002b7fd0a320) | Medium |
| **12** | Sandboxed Execution | [TaskFlow:69a13ac](https://taskforge.klyde.tech/task/69a13ac3002dd36ce60b) | Low |
| **15** | Episodic Memory | [TaskFlow:69a13ac](https://taskforge.klyde.tech/task/69a13ac3002d0982d6dd) | Medium |
| **16** | Real-Time Streaming UI | [TaskFlow:69a13ac](https://taskforge.klyde.tech/task/69a13ac3002e7ba930f9) | Medium |

---

## Priority Ranking (by effort/impact)

| # | Feature | Effort | Impact | Ticket |
|---|---------|--------|--------|--------|
| **9** | Multi-Model Cost Routing | 1 day | High | [TaskFlow:69a13a0](https://taskforge.klyde.tech/task/69a13a070037625d2d5f) |
| **17** | User-in-the-Loop | 2 days | High | Planned |
| **10** | Architect/Editor Split | 5 days | High | [TaskFlow:69a13a3](https://taskforge.klyde.tech/task/69a13a3c002e700ec953) |
| **16a** | Token/Cost Live Display | 2 days | Medium | [TaskFlow:69a13ac](https://taskforge.klyde.tech/task/69a13ac3002e7ba930f9) |
| **7** | Sub-Agent Delegation | 4 days | High | [TaskFlow:69a13a6](https://taskforge.klyde.tech/task/69a13a630033f7b01816) |
| **11** | Plan Mode | 3 days | Medium | [TaskFlow:69a13ac](https://taskforge.klyde.tech/task/69a13ac3002b7fd0a320) |
| **12** | Sandboxed Execution | 5 days | Medium | [TaskFlow:69a13ac](https://taskforge.klyde.tech/task/69a13ac3002dd36ce60b) |
| **15** | Episodic Memory | 7 days | High | [TaskFlow:69a13ac](https://taskforge.klyde.tech/task/69a13ac3002d0982d6dd) |
| **16b-c** | Progressive UI + Cancel | 3 days | Low | [TaskFlow:69a13ac](https://taskforge.klyde.tech/task/69a13ac3002e7ba930f9) |

**Recommended order**: #9 → #17 → #10 → #7 → #11 → #12 → #15 → #16b-c

---

## #9. Multi-Model Cost Routing

**Ticket**: [TaskFlow:69a13a0](https://taskforge.klyde.tech/task/69a13a070037625d2d5f)
**Effort**: ~1 day | **Impact**: Immediate cost reduction on every session
**Engine**: ALL (primary benefit: `/engine glm` with `glm-5` + `glm-4.7-flash`)

### Problem

The CHAPO loop uses the primary model (`glm-5`, `kimi-k2.5`, etc.) for EVERY iteration, including trivial tool-result processing iterations where the LLM just reads a file listing and picks the next tool. This wastes expensive tokens on work that a cheaper model handles equally well.

### Design

Extend the existing `shouldEnableThinking()` heuristic into a model tier selector:

| Tier | When | Model | Rationale |
|------|------|-------|-----------|
| **primary** | Iteration 0 (planning), error recovery, complex keywords | `glm-5` / `kimi-k2.5` | Needs full reasoning |
| **fast** | Iteration > 3, simple tool-result follow-up, no errors | `glm-4.7-flash` | Execution-phase, just picks next tool |

### Files to Modify

| File | Change |
|------|--------|
| `apps/api/src/agents/chapo-loop.ts` | Add `selectModelForIteration()` function |
| `apps/api/src/agents/types.ts` | Add `fastModel` to `ModelSelection` |
| `apps/api/src/llm/modelSelector.ts` | Pass `fastModel` through |

### Verification

1. Start session with `/engine glm`, send a multi-step task
2. Check logs: iterations 0-1 should show `glm-5`, iteration 2+ should show `glm-4.7-flash [fast]`

---

## #17. User-in-the-Loop (Self-Check + Clarifying Questions)

**Plan**: [user-in-the-loop-plan.md](./user-in-the-loop-plan.md)
**Effort**: ~2 days | **Impact**: Reduces wrong answers, improves trust
**Engine**: ALL

### Problem

CHAPO sometimes produces answers that:
1. Address the wrong interpretation of an ambiguous request
2. Make assumptions the user didn't intend
3. Miss critical context that the user could easily provide

### Design

Hybrid self-check + conditional user ask:

1. Model includes self-check block in every answer with confidence score
2. High confidence (≥0.8): Return answer directly
3. Medium confidence (0.5-0.8): Return answer + uncertainty note
4. Low confidence (<0.5): Return clarifying question instead

### Decision Framework

**Ask user when:**
- Multiple valid interpretations exist AND no clear winner
- Missing critical info that can't be obtained with tools
- High risk of wrong action
- Model confidence < 0.5

**Don't ask when:**
- One interpretation is likely (>80%) — use it, note assumption
- Info can be obtained with tools — get it yourself
- Request is simple/unambiguous

### Files to Create/Modify

| File | Change Type |
|------|------------|
| `apps/api/src/agents/selfCheck.ts` | **NEW** — Parser and formatter |
| `apps/api/src/agents/chapo-loop.ts` | Modify — Parse self-check, handle clarification |
| `apps/api/src/agents/types.ts` | Modify — Add selfCheck to result |
| CHAPO system prompt | Modify — Add self-check protocol |

### Verification

1. "Fix the bug" in multi-bug codebase → asks "which bug?"
2. "Fix null pointer in auth.ts:45" → fixes directly, high confidence
3. "Delete all test files" → asks for confirmation
4. "What is 2+2?" → answers directly, no self-check

---

## #10. Architect/Editor Split Pattern

**Ticket**: [TaskFlow:69a13a3](https://taskforge.klyde.tech/task/69a13a3c002e700ec953)
**Effort**: ~5 days | **Impact**: Reduces hallucination in code generation
**Engine**: ALL (primary benefit: `/engine glm` and `/engine kimi`)

### Problem

CHAPO uses a single model for both reasoning ("what needs to change?") and code generation ("write the code"). This leads to hallucination — the model invents file paths, generates wrong function signatures, or writes code that doesn't match the existing codebase.

### Design

Split file-editing tool calls into a 2-pass pipeline:
1. **Architect pass** (primary model): Produces structured edit plan (JSON)
2. **Editor pass** (fast model): Generates actual code from plan
3. **Review pass** (optional): Validates generated code

**Only intercepts**: `fs_writeFile` and `fs_edit`

### Files to Create/Modify

| File | Change Type |
|------|------------|
| `apps/api/src/agents/architectEditor.ts` | **NEW** |
| `apps/api/src/agents/chapo-loop/toolExecutor.ts` | Modify (intercept) |
| `apps/api/src/llm/engineProfiles.ts` | Modify (architectMode flag) |

---

## #7. Specialized Sub-Agent Delegation

**Ticket**: [TaskFlow:69a13a6](https://taskforge.klyde.tech/task/69a13a630033f7b01816)
**Effort**: ~4 days | **Impact**: Enables parallel work, protects parent context from bloat
**Engine**: ALL

### Problem

CHAPO handles everything sequentially in one context window. When a task requires "research X, then implement Y, then verify Z", each phase fills the context with data the next phase doesn't need.

### Design

Add 2 lightweight sub-agent types:

| Sub-Agent | Tools Available | Use Case |
|-----------|----------------|----------|
| **research** | fs_readFile, fs_glob, fs_grep, fs_listFiles, web_search, web_fetch | "Read these files and summarize" |
| **bash** | bash_execute only | "Run test suite and report results" |

Sub-agents have strict limits: max 10 iterations, 60s timeout, 50k token budget.

### Files to Create/Modify

| File | Change Type |
|------|------------|
| `apps/api/src/agents/sub-agent.ts` | **NEW** |
| `apps/api/src/tools/definitions/delegateTools.ts` | **NEW** |
| `apps/api/src/tools/registry.ts` | Modify |
| `apps/api/src/tools/toolFilter.ts` | Modify |

---

## #11. Plan Mode / Pre-Execution Planning

**Ticket**: [TaskFlow:69a13ac](https://taskforge.klyde.tech/task/69a13ac3002b7fd0a320)
**Effort**: ~3 days | **Impact**: Users approve changes before code is modified
**Engine**: ALL

### Problem

CHAPO's `chapo_plan_set` tool exists but is cosmetic — it sets a plan string shown in the UI but doesn't gate execution. The agent can start editing files before the user has reviewed the plan.

### Design

Add a `planMode` flag that forces CHAPO to:
1. Produce a plan first
2. Wait for user approval
3. Only then execute file-modifying tools

### Files to Create/Modify

| File | Change Type |
|------|------------|
| `apps/api/src/agents/chapo-loop/planGate.ts` | **NEW** |
| `apps/api/src/agents/chapo-loop/toolExecutor.ts` | Modify |
| `apps/api/src/tools/definitions/chapoControlTools.ts` | Modify |

---

## #12. Sandboxed Execution Environment

**Ticket**: [TaskFlow:69a13ac](https://taskforge.klyde.tech/task/69a13ac3002dd36ce60b)
**Effort**: ~5 days | **Impact**: Safety net for bash execution
**Engine**: ALL (critical for `/engine glm`)

### Problem

`bash_execute` runs commands directly on the host with only pattern blocking and path restrictions.

### Design: OverlayFS + Namespaces (No Docker)

```
OverlayFS:
  lower = /opt/Klyde/projects/X   ← Read-only real filesystem
  upper = /tmp/devai-sandbox-XXX  ← Writes go here
  merged = /sandbox/workspace     ← Agent sees this
```

### Files to Create

| File | Change Type |
|------|------------|
| `apps/api/src/sandbox/overlay.ts` | **NEW** |
| `apps/api/src/sandbox/sandboxedBash.ts` | **NEW** |
| `apps/api/src/tools/bash.ts` | Modify |

---

## #15. Episodic Memory (Cross-Session Learning)

**Ticket**: [TaskFlow:69a13ac](https://taskforge.klyde.tech/task/69a13ac3002d0982d6dd)
**Effort**: ~7 days | **Impact**: Agent remembers what happened, learns from past sessions
**Engine**: ALL

### Problem

DevAI's memory system is passive — memories are only extracted at session-end or when explicitly requested. No automatic learning from:
- Successful debugging patterns
- User preferences observed over time
- Project-specific knowledge

### Design

3 extraction triggers:
| Trigger | When | What's Extracted |
|---------|------|-----------------|
| **Real-time** | After each tool execution | Patterns, file modifications |
| **Turn-end** | After CHAPO answers | Episodic summary |
| **Session-end** | WebSocket disconnect | Full session learnings |

### Files to Create/Modify

| File | Change Type |
|------|------------|
| `apps/api/src/db/migrations/004_episodic_metadata.sql` | **NEW** |
| `apps/api/src/memory/episodicExtractor.ts` | **NEW** |
| `apps/api/src/memory/turnSummary.ts` | **NEW** |
| `apps/api/src/memory/service.ts` | Modify |

---

## #16. Real-Time Streaming with Progressive UI

**Ticket**: [TaskFlow:69a13ac](https://taskforge.klyde.tech/task/69a13ac3002e7ba930f9)
**Effort**: ~5 days total (3 phases) | **Impact**: Users see what the agent is doing live
**Engine**: ALL

### Problem

User experience gaps:
1. Tool arguments are opaque until execution completes
2. No live diffs for file edits
3. No cancel mechanism for individual tools
4. No token/cost visibility

### Phase 1: Token/Cost Live Display (2 days)

Stream token usage after each LLM call. Frontend shows live counter.

### Phase 2: Progressive Tool Results (2 days)

For long-running tools (bash, web_fetch), stream output chunks as they arrive.

### Phase 3: Cancel Individual Tools (1 day)

Allow canceling individual tool executions from frontend.

### Files to Create/Modify

| File | Change Type |
|------|------------|
| `apps/web/src/components/ChatUI/TokenCounter.tsx` | **NEW** |
| `apps/api/src/tools/bash.ts` | Modify (streaming) |
| `apps/api/src/websocket/routes.ts` | Modify (cancel_tool) |

---

## Summary: All Unfinished Features

| # | Feature | Tier (Original) | Effort | Ticket |
|---|---------|-----------------|--------|--------|
| **9** | Multi-Model Cost Routing | Tier 2 | 1 day | [TaskFlow:69a13a0](https://taskforge.klyde.tech/task/69a13a070037625d2d5f) |
| **10** | Architect/Editor Split | Tier 3 | 5 days | [TaskFlow:69a13a3](https://taskforge.klyde.tech/task/69a13a3c002e700ec953) |
| **7** | Sub-Agent Delegation | Tier 2 | 4 days | [TaskFlow:69a13a6](https://taskforge.klyde.tech/task/69a13a630033f7b01816) |
| **11** | Plan Mode | Tier 3 | 3 days | [TaskFlow:69a13ac](https://taskforge.klyde.tech/task/69a13ac3002b7fd0a320) |
| **12** | Sandboxed Execution | Tier 3 | 5 days | [TaskFlow:69a13ac](https://taskforge.klyde.tech/task/69a13ac3002dd36ce60b) |
| **15** | Episodic Memory | Tier 4 | 7 days | [TaskFlow:69a13ac](https://taskforge.klyde.tech/task/69a13ac3002d0982d6dd) |
| **16** | Real-Time Streaming | Tier 4 | 5 days | [TaskFlow:69a13ac](https://taskforge.klyde.tech/task/69a13ac3002e7ba930f9) |

**Total remaining effort**: ~30 days
