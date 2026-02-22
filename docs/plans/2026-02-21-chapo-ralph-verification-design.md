# CHAPO as Ralph Wiggum — Delegation Verification & Unified Agent Protocol

> Design document for making CHAPO the verification layer for all sub-agent delegations, inspired by the Ralph Wiggum Loop pattern.

## Motivation

Currently, when CHAPO delegates to DEVO/CAIO/SCOUT, it blindly trusts the result. If DEVO silently fails (tests don't pass, file not edited, commit not created), CHAPO doesn't know — it just passes the result to the user. Each agent also returns results in a different format, making it harder for CHAPO to reason about outcomes.

The Ralph Wiggum Loop insight: **assume agents will fail, verify externally, feed failure signals back, let the orchestrator decide what to do.**

## Design: Two Changes

### 1. Unified Delegation Protocol

#### Current State (asymmetric)

- **CHAPO → agents**: `ParallelDelegation` struct (objective, constraints, expectedOutcome)
- **DEVO → CHAPO**: free-form string
- **CAIO → CHAPO**: free-form string + appended evidence block
- **SCOUT → CHAPO**: `ScoutResult` object (JSON.stringify'd)

#### New State (unified)

All agents return `DelegationResult`:

```typescript
interface DelegationResult {
  status: 'success' | 'partial' | 'failed' | 'escalated';
  summary: string;
  toolEvidence: ToolEvidence[];
  escalation?: string;
  findings?: ScoutFindings;  // scout-specific
}

interface ToolEvidence {
  tool: string;
  success: boolean;
  summary: string;
  // Optional CAIO-specific fields
  pendingApproval?: boolean;
  externalId?: string;
  nextStep?: string;
}
```

#### Status Derivation (no LLM call — pure signal)

| Condition | Status |
|-----------|--------|
| All tool calls succeeded, no escalation | `success` |
| Mix of successes and failures | `partial` |
| Critical failure, no tools called, or agent returned empty | `failed` |
| Agent called `escalateToChapo` | `escalated` |

### 2. Verification Envelope

When a delegation returns, CHAPO receives a structured envelope instead of raw text:

```
[DELEGATION RESULT — DEVO]
Objective: Fix login validation bug in auth/login.ts
Expected Outcome: Login form validates all RFC 5322 email formats

Status: PARTIAL
Evidence:
  - [OK] fs_readFile: read auth/login.ts
  - [OK] fs_edit: modified validation regex
  - [ERROR] bash_execute: npm test (exit code 1, 2 tests failing)
  - [MISSING] git_commit: no commit created

Agent Response:
<DEVO's summary text>
```

CHAPO's natural decision loop handles the rest — it sees explicit failure signals and decides whether to re-delegate, try differently, or escalate to the user. No hardcoded retry logic.

### 3. Spec Pinning After Compaction

When context compaction fires at 160k tokens, the original user request is re-injected after the summary as a pinned system message:

```
[ORIGINAL REQUEST — pinned]
<exact original user message, unmodified>
```

This prevents context rot — CHAPO never loses sight of the original goal, even in very long sessions. Cost: ~100-500 tokens per compaction event.

## Implementation: What Changes

### Types (in `agents/types.ts`)

```typescript
export interface DelegationResult {
  status: 'success' | 'partial' | 'failed' | 'escalated';
  summary: string;
  toolEvidence: ToolEvidence[];
  escalation?: string;
  findings?: ScoutFindings;
}

export interface ToolEvidence {
  tool: string;
  success: boolean;
  summary: string;
  pendingApproval?: boolean;
  externalId?: string;
  nextStep?: string;
}

export interface ScoutFindings {
  relevantFiles?: string[];
  codePatterns?: string[];
  webFindings?: string[];
  recommendations?: string[];
  confidence?: number;
}
```

### ChapoLoop (`agents/chapo-loop.ts`)

**Store original request:**
- Add `private originalUserMessage: string = '';` to class
- Set in `run()`: `this.originalUserMessage = userMessage;`

**Spec pinning in `checkAndCompact()`:**
- After adding the compaction summary message, add:
  ```typescript
  this.conversation.addMessage({
    role: 'system',
    content: `[ORIGINAL REQUEST — pinned]\n${this.originalUserMessage}`,
  });
  ```

**DEVO sub-loop (`delegateToDevo()`):**
- Accumulate `ToolEvidence[]` as each tool executes
- Detect escalation
- Return `DelegationResult` instead of `finalContent`

**CAIO sub-loop (`delegateToCaio()`):**
- Map existing `CaioEvidence[]` to `ToolEvidence[]`
- Return `DelegationResult` instead of `finalContent`

**SCOUT result handling:**
- Map `ScoutResult` to `DelegationResult` with `findings` field
- Derive status from confidence

**Delegation handling in `runLoop()`:**
- All three delegation paths converge to same handling code
- Build verification envelope from `DelegationResult`
- Push envelope into conversation as tool result
- CHAPO's loop continues naturally

### Verification Envelope Builder

```typescript
private buildVerificationEnvelope(
  delegation: ParallelDelegation,
  result: DelegationResult,
): string {
  const lines: string[] = [
    `[DELEGATION RESULT — ${delegation.target.toUpperCase()}]`,
    `Objective: ${delegation.objective}`,
  ];

  if (delegation.expectedOutcome) {
    lines.push(`Expected Outcome: ${delegation.expectedOutcome}`);
  }

  lines.push('');
  lines.push(`Status: ${result.status.toUpperCase()}`);

  if (result.toolEvidence.length > 0) {
    lines.push('Evidence:');
    for (const ev of result.toolEvidence.slice(-10)) {
      const icon = ev.success ? 'OK' : (ev.pendingApproval ? 'PENDING' : 'ERROR');
      lines.push(`  - [${icon}] ${ev.tool}: ${ev.summary}`);
    }
  }

  if (result.escalation) {
    lines.push(`\nEscalation: ${result.escalation}`);
  }

  lines.push(`\nAgent Response:\n${result.summary}`);
  return lines.join('\n');
}
```

### Status Derivation

```typescript
private deriveDelegationStatus(
  evidence: ToolEvidence[],
  escalated: boolean,
  hasContent: boolean,
): DelegationResult['status'] {
  if (escalated) return 'escalated';
  if (evidence.length === 0 && !hasContent) return 'failed';

  const failures = evidence.filter(e => !e.success && !e.pendingApproval);
  const successes = evidence.filter(e => e.success);

  if (failures.length === 0 && successes.length > 0) return 'success';
  if (successes.length > 0 && failures.length > 0) return 'partial';
  return 'failed';
}
```

## What Does NOT Change

- Agent internal logic (DEVO/CAIO/SCOUT still work the same way internally)
- Tool registry and execution
- Error handling and retry logic within sub-loops
- Self-validation on final CHAPO answers
- Approval workflows
- Memory system (extraction, compaction, retrieval)
- Frontend/WebSocket protocol

## File Summary

| File | Change |
|------|--------|
| `apps/api/src/agents/types.ts` | Add `DelegationResult`, `ToolEvidence`, `ScoutFindings` types |
| `apps/api/src/agents/chapo-loop.ts` | Store originalUserMessage, pin spec after compaction, accumulate tool evidence in sub-loops, return DelegationResult from delegation methods, build verification envelope, unify delegation handling in runLoop |

## References

- [Ralph Loop Agent (Vercel Labs)](https://github.com/vercel-labs/ralph-loop-agent)
- [From ReAct to Ralph Loop (Alibaba Cloud)](https://www.alibabacloud.com/blog/from-react-to-ralph-loop-a-continuous-iteration-paradigm-for-ai-agents_602799)
- [Ralph Wiggum Technique (Geoffrey Huntley)](https://github.com/ghuntley/how-to-ralph-wiggum)
