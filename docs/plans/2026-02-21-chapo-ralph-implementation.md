# CHAPO-as-Ralph Verification — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make CHAPO verify delegation results using evidence-based signals, return unified result structures from all agents, and pin the original request after compaction.

**Architecture:** Evidence-only verification (no extra LLM call). All agents return `LoopDelegationResult`. CHAPO formats a verification envelope and feeds it into its natural decision loop.

**Tech Stack:** TypeScript, existing ChapoLoop class

---

### Task 1: Add Unified Types to types.ts

**Files:**
- Modify: `apps/api/src/agents/types.ts`

**Step 1: Add new types after the existing ScoutResult (line 480)**

Add these types at the end of the SCOUT section, before the CHAPO LOOP TYPES section:

```typescript
// ============================================
// UNIFIED DELEGATION PROTOCOL (Ralph Verification)
// ============================================

export type LoopDelegationStatus = 'success' | 'partial' | 'failed' | 'escalated';

export interface ToolEvidence {
  tool: string;
  success: boolean;
  summary: string;
  pendingApproval?: boolean;
  externalId?: string;
  nextStep?: string;
}

export interface ScoutFindings {
  relevantFiles: string[];
  codePatterns: Record<string, string>;
  webFindings: WebFinding[];
  recommendations: string[];
  confidence: ScoutConfidence;
}

export interface LoopDelegationResult {
  status: LoopDelegationStatus;
  summary: string;
  toolEvidence: ToolEvidence[];
  escalation?: string;
  findings?: ScoutFindings;
}
```

Note: We use `LoopDelegationResult` to avoid conflicting with the existing `DelegationResult` type (line 128) which is used elsewhere in the codebase.

**Step 2: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/agents/types.ts
git commit -m "feat: add unified delegation protocol types (Ralph verification)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Add Verification Infrastructure to ChapoLoop

**Files:**
- Modify: `apps/api/src/agents/chapo-loop.ts`

**Step 1: Add imports**

At the top of chapo-loop.ts, add `LoopDelegationResult`, `LoopDelegationStatus`, `ToolEvidence`, and `ScoutFindings` to the type imports from `./types.js`:

```typescript
import type {
  AgentStreamEvent,
  ModelSelection,
  ChapoLoopResult,
  DelegationDomain,
  ScoutScope,
  UserQuestion,
  ApprovalRequest,
  RiskLevel,
  ValidationResult,
  LoopDelegationResult,
  LoopDelegationStatus,
  ToolEvidence,
  ScoutFindings,
} from './types.js';
```

**Step 2: Add originalUserMessage field**

Add to the ChapoLoop class fields (after `private toolDirectiveRegex`):

```typescript
  private originalUserMessage = '';
```

**Step 3: Store originalUserMessage in run()**

In the `run()` method, right at the start (after line 151 `async run(userMessage...)`), add:

```typescript
    this.originalUserMessage = userMessage;
```

**Step 4: Add spec pinning to checkAndCompact()**

In `checkAndCompact()`, after the compaction summary message is added (after line 139 `});`), and before the `for (const msg of toKeep)` loop, add:

```typescript
    // Pin original user request so CHAPO never loses the goal
    if (this.originalUserMessage) {
      this.conversation.addMessage({
        role: 'system',
        content: `[ORIGINAL REQUEST — pinned]\n${this.originalUserMessage}`,
      });
    }
```

**Step 5: Add deriveDelegationStatus method**

Add this private method to the ChapoLoop class (after `checkAndCompact`):

```typescript
  private deriveDelegationStatus(
    evidence: ToolEvidence[],
    escalated: boolean,
    hasContent: boolean,
  ): LoopDelegationStatus {
    if (escalated) return 'escalated';
    if (evidence.length === 0 && !hasContent) return 'failed';

    const failures = evidence.filter((e) => !e.success && !e.pendingApproval);
    const successes = evidence.filter((e) => e.success);

    if (failures.length === 0 && successes.length > 0) return 'success';
    if (successes.length > 0 && failures.length > 0) return 'partial';
    if (failures.length > 0 && successes.length === 0) return 'failed';
    return 'success'; // no evidence but has content = success
  }
```

**Step 6: Add buildVerificationEnvelope method**

Add this private method after `deriveDelegationStatus`:

```typescript
  private buildVerificationEnvelope(
    delegation: ParallelDelegation,
    result: LoopDelegationResult,
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
      for (const ev of result.toolEvidence.slice(-12)) {
        const icon = ev.success ? 'OK' : (ev.pendingApproval ? 'PENDING' : 'ERROR');
        const extra = ev.externalId ? ` id=${ev.externalId}` : '';
        lines.push(`  - [${icon}] ${ev.tool}${extra}: ${ev.summary}`);
      }
    }

    if (result.escalation) {
      lines.push(`\nEscalation: ${result.escalation}`);
    }

    if (result.findings) {
      if (result.findings.recommendations.length > 0) {
        lines.push(`\nRecommendations: ${result.findings.recommendations.join('; ')}`);
      }
    }

    lines.push(`\nAgent Response:\n${result.summary}`);
    return lines.join('\n');
  }
```

**Step 7: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/agents/chapo-loop.ts
git commit -m "feat: add verification infrastructure to ChapoLoop

- Store originalUserMessage for spec pinning
- Pin original request after compaction
- Add deriveDelegationStatus (evidence-based, no LLM call)
- Add buildVerificationEnvelope for structured delegation feedback

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Wire DEVO Delegation with Evidence + Verification

**Files:**
- Modify: `apps/api/src/agents/chapo-loop.ts`

**Step 1: Modify delegateToDevo() to collect evidence and return LoopDelegationResult**

The `delegateToDevo` method (starting around line 802) currently returns `Promise<string>`. Change it to return `Promise<LoopDelegationResult>`.

Change the method signature:
```typescript
  private async delegateToDevo(delegation: ParallelDelegation): Promise<LoopDelegationResult> {
```

Add a `toolEvidence` array and `escalated` flag at the start of the method (after `const delegationContext`):
```typescript
    const toolEvidence: ToolEvidence[] = [];
    let escalated = false;
    let escalationReason = '';
```

In the tool execution loop, where tool results are collected, add evidence tracking.

For the escalation case (where `toolCall.name === 'escalateToChapo'`), set:
```typescript
          escalated = true;
          escalationReason = desc;
```
And change the return to:
```typescript
          return {
            status: 'escalated',
            summary: `DEVO eskaliert: ${desc}\n\nBisheriges Ergebnis:\n${finalContent}`,
            toolEvidence,
            escalation: desc,
          };
```

For the SCOUT delegation from within DEVO, add evidence:
```typescript
            toolEvidence.push({
              tool: 'delegateToScout',
              success: true,
              summary: `SCOUT: ${(query || '').slice(0, 80)}`,
            });
```
And for SCOUT errors from within DEVO:
```typescript
            toolEvidence.push({
              tool: 'delegateToScout',
              success: false,
              summary: errMsg,
            });
```

For regular tool calls, after the tool executes, add evidence. On success:
```typescript
          toolEvidence.push({
            tool: toolCall.name,
            success: result.success,
            summary: result.success
              ? `${toolCall.name} OK (${duration}ms)`
              : (result.error || `${toolCall.name} failed`),
          });
```

On error:
```typescript
          toolEvidence.push({
            tool: toolCall.name,
            success: false,
            summary: toolErr.message,
          });
```

At the end of the method (the final return, currently `return finalContent;`), change to:
```typescript
    const status = this.deriveDelegationStatus(toolEvidence, escalated, finalContent.length > 0);
    return {
      status,
      summary: finalContent,
      toolEvidence,
    };
```

**Step 2: Update DEVO delegation handling in runLoop()**

In `runLoop()`, the DEVO delegation block (around lines 282-317), update to use the new `LoopDelegationResult`:

Replace the success branch (the `else` block after `if (devoErr)`):
```typescript
          } else {
            const envelope = this.buildVerificationEnvelope(delegation, devoResult);
            this.sendEvent({
              type: 'tool_result',
              agent: 'chapo',
              toolName: toolCall.name,
              result: { delegated: true, agent: 'devo', status: devoResult.status },
              success: devoResult.status === 'success',
            });
            toolResults.push({
              toolUseId: toolCall.id,
              result: envelope,
              isError: devoResult.status === 'failed',
            });
          }
```

Note: `devoResult` is now `LoopDelegationResult` (returned by `delegateToDevo`), not a string. The error case (`devoErr`) stays the same — it handles exceptions, not agent failures.

**Step 3: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/agents/chapo-loop.ts
git commit -m "feat: wire DEVO delegation with evidence collection + verification envelope

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Wire CAIO Delegation with Evidence + Verification

**Files:**
- Modify: `apps/api/src/agents/chapo-loop.ts`

**Step 1: Modify delegateToCaio() to return LoopDelegationResult**

Change signature to `Promise<LoopDelegationResult>`.

Add `escalated` flag and `escalationReason` at start.

For escalation return:
```typescript
          return {
            status: 'escalated',
            summary: `CAIO eskaliert: ${desc}\n\nBisheriges Ergebnis:\n${finalContent}`,
            toolEvidence: evidenceLog.map((e) => ({
              tool: e.tool,
              success: e.success,
              summary: e.summary,
              pendingApproval: e.pendingApproval,
              externalId: e.externalId,
              nextStep: e.nextStep,
            })),
            escalation: desc,
          };
```

At the final return (currently `return finalContent;` after `applyCaioEvidenceSummary`):
```typescript
    const mappedEvidence: ToolEvidence[] = evidenceLog.map((e) => ({
      tool: e.tool,
      success: e.success,
      summary: e.summary,
      pendingApproval: e.pendingApproval,
      externalId: e.externalId,
      nextStep: e.nextStep,
    }));
    const status = this.deriveDelegationStatus(mappedEvidence, false, finalContent.length > 0);
    return {
      status,
      summary: finalContent,
      toolEvidence: mappedEvidence,
    };
```

Remove the `applyCaioEvidenceSummary` call since the verification envelope now handles this.

**Step 2: Update CAIO delegation handling in runLoop()**

Same pattern as DEVO — replace the success branch:
```typescript
          } else {
            const envelope = this.buildVerificationEnvelope(delegation, caioResult);
            this.sendEvent({
              type: 'tool_result',
              agent: 'chapo',
              toolName: toolCall.name,
              result: { delegated: true, agent: 'caio', status: caioResult.status },
              success: caioResult.status === 'success',
            });
            toolResults.push({
              toolUseId: toolCall.id,
              result: envelope,
              isError: caioResult.status === 'failed',
            });
          }
```

**Step 3: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/agents/chapo-loop.ts
git commit -m "feat: wire CAIO delegation with evidence mapping + verification envelope

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Wire SCOUT + Parallel Delegation with Verification

**Files:**
- Modify: `apps/api/src/agents/chapo-loop.ts`

**Step 1: Update SCOUT handling in runLoop()**

In the SCOUT delegation block in `runLoop()` (around line 404), update the success branch:

```typescript
          } else {
            const scoutFindings: ScoutFindings = {
              relevantFiles: scoutResult.relevantFiles || [],
              codePatterns: scoutResult.codePatterns || {},
              webFindings: scoutResult.webFindings || [],
              recommendations: scoutResult.recommendations || [],
              confidence: scoutResult.confidence || 'low',
            };
            const loopResult: LoopDelegationResult = {
              status: scoutFindings.confidence === 'low' ? 'partial' : 'success',
              summary: scoutResult.summary || JSON.stringify(scoutResult, null, 2),
              toolEvidence: [{
                tool: 'scout_research',
                success: true,
                summary: `SCOUT found ${scoutFindings.relevantFiles.length} files, ${scoutFindings.recommendations.length} recommendations (confidence: ${scoutFindings.confidence})`,
              }],
              findings: scoutFindings,
            };
            const envelope = this.buildVerificationEnvelope(delegation, loopResult);
            this.sendEvent({
              type: 'tool_result',
              agent: 'chapo',
              toolName: toolCall.name,
              result: scoutResult,
              success: true,
            });
            toolResults.push({
              toolUseId: toolCall.id,
              result: envelope,
              isError: false,
            });
          }
```

**Step 2: Update delegateParallel()**

The `delegateParallel` method calls `delegateToDevo` and `delegateToCaio` which now return `LoopDelegationResult`. Update the result handling:

In the `jobs` map function, the DEVO and CAIO branches now return `LoopDelegationResult` objects. Update the result processing to use the `.summary` field:

For DEVO/CAIO branches in the parallel jobs:
```typescript
        if (delegation.target === 'devo') {
          const result = await this.delegateToDevo(delegation);
          return { ...delegation, success: result.status === 'success' || result.status === 'partial', result: result.summary, loopResult: result };
        }
        if (delegation.target === 'caio') {
          const result = await this.delegateToCaio(delegation);
          return { ...delegation, success: result.status === 'success' || result.status === 'partial', result: result.summary, loopResult: result };
        }
```

In the summary building, for successful results, use the verification envelope if a `loopResult` is available:
```typescript
      for (const result of results.filter((r) => r.success)) {
        const content = result.loopResult
          ? this.buildVerificationEnvelope(result, result.loopResult)
          : ((result.result || '').toString());
        const preview = content.length > 1200 ? `${content.slice(0, 1200)}\n...[truncated]` : content;
        lines.push(`- [${result.target}/${result.domain}] ${result.objective}`);
        lines.push(preview || '(no content)');
      }
```

Note: The parallel delegation typing needs a small adjustment. Add `loopResult?: LoopDelegationResult` to the result objects in the Promise chain.

**Step 3: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/agents/chapo-loop.ts
git commit -m "feat: wire SCOUT + parallel delegation with verification envelopes

Completes unified delegation protocol — all agents now return
structured results with evidence-based verification.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## File Summary

| Action | File | Purpose |
|--------|------|---------|
| Modify | `apps/api/src/agents/types.ts` | Add `LoopDelegationResult`, `ToolEvidence`, `ScoutFindings` types |
| Modify | `apps/api/src/agents/chapo-loop.ts` | Store originalUserMessage, pin spec after compaction, collect evidence in sub-loops, build verification envelopes, unify delegation handling |
