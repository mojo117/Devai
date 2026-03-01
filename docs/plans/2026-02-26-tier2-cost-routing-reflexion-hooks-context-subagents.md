# Tier 2: Cost Routing, Reflexion, Hooks, Context Tiers, Sub-Agents

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Five features that cut LLM costs, improve answer quality, add user extensibility, fix context loss in long sessions, and enable parallel delegation.

**Architecture:** All features build on CHAPO's existing single-agent loop (`chapo-loop.ts`). They are independent of each other and can ship incrementally. Cost routing and reflexion modify the loop directly; hooks wrap tool execution; context tiers replace the compaction system; sub-agents add two new delegation tools.

**Tech Stack:** TypeScript (ESM with `.js` extensions), Vitest 4.x, ZAI `glm-4.7-flash` as fast model, existing `llmRouter.generateWithFallback()` for all LLM calls.

---

## Feature Overview

| # | Feature | Effort | New Files | Modified Files |
|---|---------|--------|-----------|----------------|
| 1 | Multi-Model Cost Routing | ~1 day | 0 | 3 |
| 2 | Reflexion Loop (Self-Critique) | ~2 days | 1 | 1 |
| 3 | Hooks System | ~2 days | 2 | 1 |
| 4 | Hierarchical Context Compaction | ~3 days | 1 | 2 |
| 5 | Sub-Agent Delegation | ~4 days | 2 | 3 |

---

## Task 1: Multi-Model Cost Routing

**Why:** CHAPO uses the expensive primary model (`glm-5`, `kimi-k2.5`, etc.) for EVERY loop iteration, including trivial tool-result-processing turns where a cheaper model works equally well. Engine profiles already define `fastModel: 'glm-4.7-flash'` but it's never wired into the loop.

**Files:**
- Modify: `apps/api/src/agents/types.ts:21-27` (add `fastModel` to `ModelSelection`)
- Modify: `apps/api/src/llm/modelSelector.ts:39-56` (extract `fastModel` from override)
- Modify: `apps/api/src/agents/chapo-loop.ts:272-274,343-347` (dynamic model per iteration)
- Test: `apps/api/src/agents/chapo-loop/costRouting.test.ts`

### Step 1: Write the failing test

Create `apps/api/src/agents/chapo-loop/costRouting.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { selectModelForIteration } from './costRouting.js';

describe('selectModelForIteration', () => {
  const base = {
    primaryModel: 'glm-5',
    fastModel: 'glm-4.7-flash',
    hadRecentError: false,
    thinkingEnabled: false,
  };

  it('returns primary model for iteration 0 (planning)', () => {
    expect(selectModelForIteration({ ...base, iteration: 0 })).toBe('glm-5');
  });

  it('returns primary model for iteration 1 (initial execution)', () => {
    expect(selectModelForIteration({ ...base, iteration: 1 })).toBe('glm-5');
  });

  it('returns fast model for iteration 2+', () => {
    expect(selectModelForIteration({ ...base, iteration: 2 })).toBe('glm-4.7-flash');
    expect(selectModelForIteration({ ...base, iteration: 5 })).toBe('glm-4.7-flash');
    expect(selectModelForIteration({ ...base, iteration: 10 })).toBe('glm-4.7-flash');
  });

  it('returns primary model when thinking is enabled', () => {
    expect(selectModelForIteration({ ...base, iteration: 3, thinkingEnabled: true })).toBe('glm-5');
  });

  it('returns primary model on error recovery', () => {
    expect(selectModelForIteration({ ...base, iteration: 4, hadRecentError: true })).toBe('glm-5');
  });

  it('returns primary model when no fast model configured', () => {
    expect(selectModelForIteration({ ...base, iteration: 5, fastModel: undefined })).toBe('glm-5');
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd /opt/Klyde/projects/Devai && npm -w apps/api run test -- src/agents/chapo-loop/costRouting.test.ts`
Expected: FAIL — module `./costRouting.js` not found.

### Step 3: Write `selectModelForIteration` function

Create `apps/api/src/agents/chapo-loop/costRouting.ts`:

```typescript
/**
 * Cost Routing — dynamic model tier selection per CHAPO iteration.
 *
 * Iterations 0-1 use the primary model (planning + initial execution).
 * Iteration 2+ downgrade to fast model unless thinking is enabled,
 * there was a recent error, or no fast model is configured.
 */

export interface ModelTierInput {
  iteration: number;
  primaryModel: string;
  fastModel?: string;
  hadRecentError: boolean;
  thinkingEnabled: boolean;
}

export function selectModelForIteration(input: ModelTierInput): string {
  const { iteration, primaryModel, fastModel, hadRecentError, thinkingEnabled } = input;

  // No fast model configured -> always primary
  if (!fastModel) return primaryModel;

  // First 2 iterations: planning + initial execution need full reasoning
  if (iteration < 2) return primaryModel;

  // Thinking-enabled turns need full reasoning
  if (thinkingEnabled) return primaryModel;

  // Error recovery needs full reasoning
  if (hadRecentError) return primaryModel;

  // Execution-phase: downgrade to fast model
  return fastModel;
}
```

### Step 4: Run test to verify it passes

Run: `cd /opt/Klyde/projects/Devai && npm -w apps/api run test -- src/agents/chapo-loop/costRouting.test.ts`
Expected: PASS — all 6 tests green.

### Step 5: Add `fastModel` to `ModelSelection` interface

In `apps/api/src/agents/types.ts`, add `fastModel` at line 26:

```typescript
export interface ModelSelection {
  provider: LLMProviderName;
  model: string;
  reason: string;
  /** Models to try on the same provider before falling back cross-provider. */
  sameProviderFallbacks?: string[];
  /** Cheaper model for execution-phase iterations (cost routing). */
  fastModel?: string;
}
```

### Step 6: Wire `fastModel` through `resolveModelSelection`

In `apps/api/src/llm/modelSelector.ts`, extract `fastModel` from the engine override and include it in the return value.

At line 45, add:
```typescript
const effectiveFastModel = override?.fastModel ?? agent.fastModel;
```

At lines 51-56 (primary provider return), add `fastModel`:
```typescript
return {
  provider: primaryProvider,
  model: effectiveModel,
  reason: reasonPrefix,
  sameProviderFallbacks: sameProviderFallback ? [sameProviderFallback] : undefined,
  fastModel: effectiveFastModel,
};
```

Do the same for the fallback return at lines 63-67 and the last-resort return at lines 75-78 — add `fastModel: effectiveFastModel` to each.

### Step 7: Integrate into `chapo-loop.ts`

In `apps/api/src/agents/chapo-loop.ts`:

**Add import** (after line 24):
```typescript
import { selectModelForIteration } from './chapo-loop/costRouting.js';
```

**Replace static model usage** inside the loop (line 346-347). Before the `llmRouter.generateWithFallback` call (~line 343), add:

```typescript
// Cost routing: select model tier for this iteration
const modelForThisTurn = selectModelForIteration({
  iteration: this.iteration,
  primaryModel: model,
  fastModel: this.modelSelection.fastModel,
  hadRecentError: lastErrorMessage !== '',
  thinkingEnabled,
});
```

**Update the LLM call** (line 347): change `model,` to `model: modelForThisTurn,`

**Update the log line** (line 344):
```typescript
console.log(`${trace}[chapo-loop] LLM call #${this.iteration} starting (${provider}/${modelForThisTurn}${modelForThisTurn !== model ? ' [fast]' : ''}, ${tools.length}/${allTools.length} tools, thinking=${thinkingEnabled})`);
```

### Step 8: Run full test suite

Run: `cd /opt/Klyde/projects/Devai && npm -w apps/api run test`
Expected: All 152+ tests PASS (no regressions).

### Step 9: Commit

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/agents/chapo-loop/costRouting.ts apps/api/src/agents/chapo-loop/costRouting.test.ts apps/api/src/agents/types.ts apps/api/src/llm/modelSelector.ts apps/api/src/agents/chapo-loop.ts
git commit -m "feat: multi-model cost routing — use fast model for execution-phase iterations"
```

### Verification (manual)

1. Start session with `/engine glm`, send multi-step task
2. Check logs: iterations 0-1 show `glm-5`, iteration 2+ show `glm-4.7-flash [fast]`
3. Trigger error mid-loop — next iteration should use primary model

---

## Task 2: Reflexion Loop (Self-Critique)

**Why:** CHAPO delivers its answer as soon as it has no more tool calls. There's no quality gate — hallucinated, partial, or off-topic answers reach the user. A fast self-review pass catches these before delivery.

**Files:**
- Create: `apps/api/src/agents/reflexion.ts`
- Create: `apps/api/src/agents/reflexion.test.ts`
- Modify: `apps/api/src/agents/chapo-loop.ts:82,406-411` (hook reflexion into ANSWER path)

### Step 1: Write the failing test

Create `apps/api/src/agents/reflexion.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock llmRouter before importing
vi.mock('../llm/router.js', () => ({
  llmRouter: {
    generateWithFallback: vi.fn(),
  },
}));

import { reviewAnswer } from './reflexion.js';
import { llmRouter } from '../llm/router.js';

describe('reviewAnswer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('auto-approves short answers (< 200 chars)', async () => {
    const result = await reviewAnswer('question', 'Short answer.', 'zai');
    expect(result.approved).toBe(true);
    expect(llmRouter.generateWithFallback).not.toHaveBeenCalled();
  });

  it('approves when LLM returns APPROVED', async () => {
    vi.mocked(llmRouter.generateWithFallback).mockResolvedValueOnce({
      content: 'APPROVED',
      finishReason: 'stop',
    } as any);

    const result = await reviewAnswer(
      'How does auth work?',
      'A'.repeat(250), // > 200 chars
      'zai',
      'glm-4.7-flash',
    );
    expect(result.approved).toBe(true);
    expect(result.feedback).toBeUndefined();
  });

  it('rejects when LLM returns ISSUES', async () => {
    vi.mocked(llmRouter.generateWithFallback).mockResolvedValueOnce({
      content: 'ISSUES: The answer does not address the original question about authentication.',
      finishReason: 'stop',
    } as any);

    const result = await reviewAnswer(
      'How does auth work?',
      'A'.repeat(250),
      'zai',
      'glm-4.7-flash',
    );
    expect(result.approved).toBe(false);
    expect(result.feedback).toContain('does not address');
  });

  it('approves by default when LLM call fails', async () => {
    vi.mocked(llmRouter.generateWithFallback).mockRejectedValueOnce(new Error('LLM down'));

    const result = await reviewAnswer(
      'question',
      'A'.repeat(250),
      'zai',
    );
    expect(result.approved).toBe(true);
  });

  it('approves on ambiguous LLM response', async () => {
    vi.mocked(llmRouter.generateWithFallback).mockResolvedValueOnce({
      content: 'The answer seems fine overall.',
      finishReason: 'stop',
    } as any);

    const result = await reviewAnswer(
      'question',
      'A'.repeat(250),
      'zai',
    );
    expect(result.approved).toBe(true);
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd /opt/Klyde/projects/Devai && npm -w apps/api run test -- src/agents/reflexion.test.ts`
Expected: FAIL — module `./reflexion.js` not found.

### Step 3: Implement `reflexion.ts`

Create `apps/api/src/agents/reflexion.ts`:

```typescript
/**
 * Reflexion — fast self-review of CHAPO answers before delivery.
 *
 * Uses the fast model to evaluate whether an answer actually addresses
 * the user's question. Fires once per answer, only for non-trivial responses.
 */

import { llmRouter } from '../llm/router.js';
import type { LLMProvider } from '../llm/types.js';

export interface ReflexionResult {
  approved: boolean;
  feedback?: string;
}

const REFLEXION_PROMPT = `You are a quality reviewer. The user asked a question and an AI assistant generated an answer.

Evaluate the answer on these criteria:
1. Does it actually answer the question? (not just related information)
2. Are there factual claims that seem wrong or hallucinated?
3. Is important information missing that the user clearly needs?
4. Is the answer coherent and well-structured?

If the answer is acceptable, respond with exactly: APPROVED
If there are issues, respond with: ISSUES: <brief description of what's wrong>

Be strict but fair. Minor style issues are not worth flagging.`;

/**
 * Quick self-review of an answer before delivering to the user.
 * Uses the fast model to minimize latency and cost.
 */
export async function reviewAnswer(
  userQuery: string,
  answer: string,
  provider: LLMProvider,
  fastModel?: string,
): Promise<ReflexionResult> {
  // Skip for very short answers (confirmations, status updates)
  if (answer.length < 200) {
    return { approved: true };
  }

  const model = fastModel || 'glm-4.7-flash';

  try {
    const response = await llmRouter.generateWithFallback(provider, {
      model,
      messages: [
        {
          role: 'user',
          content: `User question: ${userQuery.slice(0, 1000)}\n\nAssistant answer:\n${answer.slice(0, 3000)}`,
        },
      ],
      systemPrompt: REFLEXION_PROMPT,
      maxTokens: 256,
    });

    const text = response.content.trim();

    if (text.startsWith('APPROVED')) {
      return { approved: true };
    }

    // Extract feedback after "ISSUES:"
    const issueMatch = text.match(/ISSUES:\s*(.*)/s);
    if (issueMatch) {
      return { approved: false, feedback: issueMatch[1].trim() };
    }

    // Ambiguous response -> approve (don't block on parsing issues)
    return { approved: true };
  } catch {
    // Reflexion failed -> don't block the answer
    console.warn('[reflexion] Self-review failed, approving by default');
    return { approved: true };
  }
}
```

### Step 4: Run test to verify it passes

Run: `cd /opt/Klyde/projects/Devai && npm -w apps/api run test -- src/agents/reflexion.test.ts`
Expected: PASS — all 5 tests green.

### Step 5: Integrate into `chapo-loop.ts`

In `apps/api/src/agents/chapo-loop.ts`:

**Add import** (after the costRouting import):
```typescript
import { reviewAnswer } from './reflexion.js';
```

**Add field** to ChapoLoop class (after line 82 `private iteration = 0;`):
```typescript
private reflexionUsed = false;
```

**Replace the ANSWER path** at lines 406-411. Change from:

```typescript
// No tool calls -> ACTION: ANSWER (direct -- loop ends)
if (!response.toolCalls || response.toolCalls.length === 0) {
  const answer = response.content || '';
  const userText = getTextContent(userMessage);
  return this.answerValidator.validateAndNormalize(userText, answer, this.iteration, this.emitDecisionPath.bind(this));
}
```

To:

```typescript
// No tool calls -> ACTION: ANSWER
if (!response.toolCalls || response.toolCalls.length === 0) {
  const answer = response.content || '';
  const userTextForReview = getTextContent(userMessage);

  // Reflexion: self-review on first answer attempt for non-trivial responses
  if (this.iteration < 5 && !this.reflexionUsed && answer.length >= 200) {
    const review = await reviewAnswer(
      userTextForReview, answer, provider, this.modelSelection.fastModel,
    );
    if (!review.approved && review.feedback) {
      this.reflexionUsed = true;
      console.log(`${trace}[chapo-loop] Reflexion rejected answer: ${review.feedback}`);
      // Inject feedback and let the loop continue for one more iteration
      this.conversation.addMessage({
        role: 'assistant',
        content: answer,
      });
      this.conversation.addMessage({
        role: 'system',
        content: `[Self-Review Feedback] Your answer has issues: ${review.feedback}. Please revise your response.`,
      });
      continue; // Back to loop — will generate a revised answer
    }
  }

  return this.answerValidator.validateAndNormalize(userTextForReview, answer, this.iteration, this.emitDecisionPath.bind(this));
}
```

### Step 6: Run full test suite

Run: `cd /opt/Klyde/projects/Devai && npm -w apps/api run test`
Expected: All tests PASS.

### Step 7: Commit

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/agents/reflexion.ts apps/api/src/agents/reflexion.test.ts apps/api/src/agents/chapo-loop.ts
git commit -m "feat: reflexion loop — fast self-review of answers before delivery"
```

### Verification (manual)

1. Send a vague question — if answer is generic, reflexion should catch it and request revision
2. Send a clear question — reflexion should approve quickly
3. Check logs for `[chapo-loop] Reflexion rejected answer:` when it fires
4. Verify latency: reflexion adds < 2s (flash model, 256 max tokens)

---

## Task 3: Hooks System (Pre/Post Tool Execution)

**Why:** DevAI has no extension point for running custom logic around tool executions. Users can't auto-format after file writes, auto-lint, add logging, or create approval gates for destructive operations.

**Files:**
- Create: `apps/api/src/hooks/hookConfig.ts`
- Create: `apps/api/src/hooks/hookConfig.test.ts`
- Create: `apps/api/src/hooks/hookRunner.ts`
- Create: `apps/api/src/hooks/hookRunner.test.ts`
- Modify: `apps/api/src/agents/chapo-loop/toolExecutor.ts:34-53,268-339` (wrap with hooks)
- Modify: `apps/api/src/agents/chapo-loop.ts:422-431` (pass `projectRoot` to toolExecutor)

### Step 1: Write the hook config test

Create `apps/api/src/hooks/hookConfig.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { matchHooks, type HookRule } from './hookConfig.js';

const rules: HookRule[] = [
  { event: 'after:tool', toolMatch: 'fs_*', command: 'prettier --write $HOOK_FILE_PATH', timeout: 5000 },
  { event: 'after:tool', command: 'echo "done"', timeout: 5000 },
  { event: 'before:tool', toolMatch: 'bash_execute', command: 'echo "audit"', blocking: true, timeout: 5000 },
  { event: 'after:tool:error', toolMatch: 'git_*', command: 'notify', timeout: 5000 },
];

describe('matchHooks', () => {
  it('matches glob prefix patterns', () => {
    const matched = matchHooks(rules, 'after:tool', 'fs_writeFile');
    expect(matched).toHaveLength(2); // fs_* + no-filter rule
  });

  it('matches exact tool names', () => {
    const matched = matchHooks(rules, 'before:tool', 'bash_execute');
    expect(matched).toHaveLength(1);
    expect(matched[0].blocking).toBe(true);
  });

  it('returns no-filter hooks for any tool', () => {
    const matched = matchHooks(rules, 'after:tool', 'web_search');
    expect(matched).toHaveLength(1); // only the no-filter rule
  });

  it('returns empty for non-matching events', () => {
    const matched = matchHooks(rules, 'on:answer', 'fs_writeFile');
    expect(matched).toHaveLength(0);
  });

  it('returns empty when no rules exist', () => {
    const matched = matchHooks([], 'after:tool', 'fs_writeFile');
    expect(matched).toHaveLength(0);
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd /opt/Klyde/projects/Devai && npm -w apps/api run test -- src/hooks/hookConfig.test.ts`
Expected: FAIL — module not found.

### Step 3: Implement `hookConfig.ts`

Create `apps/api/src/hooks/hookConfig.ts`:

```typescript
/**
 * Hook Configuration — reads and matches user-defined hooks.
 *
 * Hooks fire before/after tool executions. Users configure them
 * in workspace/hooks.json or ~/.devai/hooks.json.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';

export interface HookRule {
  event: 'before:tool' | 'after:tool' | 'after:tool:error' | 'on:answer';
  toolMatch?: string;
  command: string;
  cwd?: string;
  timeout?: number;
  blocking?: boolean;
}

interface HookConfig {
  version: number;
  hooks: HookRule[];
}

const MAX_HOOK_TIMEOUT = 30_000;
const DEFAULT_HOOK_TIMEOUT = 10_000;

/** Session-scoped hook config cache */
const hookCache = new Map<string, { rules: HookRule[]; loadedAt: number }>();
const CACHE_TTL = 60_000; // 1 minute

/**
 * Load hooks from workspace/hooks.json or ~/.devai/hooks.json.
 */
export async function getHooksForSession(
  projectRoot: string | null,
): Promise<HookRule[]> {
  const cacheKey = projectRoot || 'global';
  const cached = hookCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL) {
    return cached.rules;
  }

  const paths = [
    projectRoot ? join(projectRoot, 'workspace', 'hooks.json') : null,
    join(process.env.HOME || '/root', '.devai', 'hooks.json'),
  ].filter(Boolean) as string[];

  for (const path of paths) {
    try {
      const raw = await readFile(path, 'utf-8');
      const config: HookConfig = JSON.parse(raw);
      if (config.version !== 1) continue;

      const rules = config.hooks.map((h) => ({
        ...h,
        timeout: Math.min(h.timeout || DEFAULT_HOOK_TIMEOUT, MAX_HOOK_TIMEOUT),
      }));

      hookCache.set(cacheKey, { rules, loadedAt: Date.now() });
      return rules;
    } catch {
      // File not found or invalid — try next
    }
  }

  hookCache.set(cacheKey, { rules: [], loadedAt: Date.now() });
  return [];
}

/**
 * Find hooks matching a specific event and tool name.
 */
export function matchHooks(
  rules: HookRule[],
  event: HookRule['event'],
  toolName?: string,
): HookRule[] {
  return rules.filter((rule) => {
    if (rule.event !== event) return false;
    if (!rule.toolMatch) return true; // No filter = match all
    if (!toolName) return false;

    // Simple glob: "fs_*" matches "fs_writeFile"
    if (rule.toolMatch.endsWith('*')) {
      const prefix = rule.toolMatch.slice(0, -1);
      return toolName.startsWith(prefix);
    }
    return toolName === rule.toolMatch;
  });
}

/** Clear cache — used in tests */
export function clearHookCache(): void {
  hookCache.clear();
}
```

### Step 4: Run test to verify it passes

Run: `cd /opt/Klyde/projects/Devai && npm -w apps/api run test -- src/hooks/hookConfig.test.ts`
Expected: PASS — all 5 tests green.

### Step 5: Write the hook runner test

Create `apps/api/src/hooks/hookRunner.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./hookConfig.js', () => ({
  getHooksForSession: vi.fn(),
  matchHooks: vi.fn(),
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

import { runHooks } from './hookRunner.js';
import { getHooksForSession, matchHooks } from './hookConfig.js';
import { exec } from 'child_process';

describe('runHooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns immediately when no hooks match', async () => {
    vi.mocked(getHooksForSession).mockResolvedValueOnce([]);
    vi.mocked(matchHooks).mockReturnValueOnce([]);

    const result = await runHooks('after:tool', { toolName: 'fs_writeFile', projectRoot: null });
    expect(result.blocked).toBe(false);
    expect(result.executedCount).toBe(0);
  });

  it('executes matching hooks and counts them', async () => {
    const rules = [{ event: 'after:tool' as const, command: 'echo ok', timeout: 5000 }];
    vi.mocked(getHooksForSession).mockResolvedValueOnce(rules);
    vi.mocked(matchHooks).mockReturnValueOnce(rules);
    vi.mocked(exec).mockImplementation((_cmd, _opts, cb: any) => {
      cb(null, 'ok', '');
      return {} as any;
    });

    const result = await runHooks('after:tool', { toolName: 'fs_writeFile', projectRoot: '/tmp' });
    expect(result.blocked).toBe(false);
    expect(result.executedCount).toBe(1);
  });

  it('blocks on blocking before:tool hook failure', async () => {
    const rules = [{ event: 'before:tool' as const, command: 'exit 1', timeout: 5000, blocking: true }];
    vi.mocked(getHooksForSession).mockResolvedValueOnce(rules);
    vi.mocked(matchHooks).mockReturnValueOnce(rules);
    vi.mocked(exec).mockImplementation((_cmd, _opts, cb: any) => {
      cb(new Error('hook failed'), '', 'error');
      return {} as any;
    });

    const result = await runHooks('before:tool', { toolName: 'bash_execute', projectRoot: '/tmp' });
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toContain('hook failed');
  });

  it('does not block on non-blocking hook failure', async () => {
    const rules = [{ event: 'after:tool' as const, command: 'exit 1', timeout: 5000 }];
    vi.mocked(getHooksForSession).mockResolvedValueOnce(rules);
    vi.mocked(matchHooks).mockReturnValueOnce(rules);
    vi.mocked(exec).mockImplementation((_cmd, _opts, cb: any) => {
      cb(new Error('hook failed'), '', 'error');
      return {} as any;
    });

    const result = await runHooks('after:tool', { toolName: 'fs_writeFile', projectRoot: '/tmp' });
    expect(result.blocked).toBe(false);
  });
});
```

### Step 6: Implement `hookRunner.ts`

Create `apps/api/src/hooks/hookRunner.ts`:

```typescript
/**
 * Hook Runner — executes user-configured hooks around tool calls.
 */

import { exec } from 'child_process';
import { matchHooks, getHooksForSession, type HookRule } from './hookConfig.js';

interface HookContext {
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  projectRoot: string | null;
}

export interface HookOutcome {
  blocked: boolean;
  blockReason?: string;
  executedCount: number;
}

/**
 * Run all matching hooks for an event.
 * Returns whether any blocking hook prevented execution.
 */
export async function runHooks(
  event: HookRule['event'],
  context: HookContext,
): Promise<HookOutcome> {
  const rules = await getHooksForSession(context.projectRoot);
  const matched = matchHooks(rules, event, context.toolName);

  if (matched.length === 0) {
    return { blocked: false, executedCount: 0 };
  }

  let executedCount = 0;

  for (const hook of matched) {
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      HOOK_EVENT: event,
      HOOK_TOOL_NAME: context.toolName || '',
      HOOK_TOOL_ARGS: JSON.stringify(context.toolArgs || {}),
      HOOK_TOOL_RESULT: (context.toolResult || '').slice(0, 4000),
    };

    // Extract common tool args as convenience vars
    if (context.toolArgs) {
      const args = context.toolArgs;
      if (typeof args.path === 'string') env.HOOK_FILE_PATH = args.path;
      if (typeof args.file_path === 'string') env.HOOK_FILE_PATH = args.file_path;
      if (typeof args.command === 'string') env.HOOK_COMMAND = args.command;
    }

    const cwd = hook.cwd || context.projectRoot || '/tmp';

    try {
      await execCommand(hook.command, { cwd, env, timeout: hook.timeout || 10_000 });
      executedCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[hooks] Hook failed (${event}/${context.toolName}): ${msg}`);

      if (hook.blocking && event === 'before:tool') {
        return {
          blocked: true,
          blockReason: `Hook blocked execution: ${msg}`,
          executedCount,
        };
      }
    }
  }

  return { blocked: false, executedCount };
}

function execCommand(
  command: string,
  options: { cwd: string; env: Record<string, string>; timeout: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout,
      maxBuffer: 1024 * 256,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\nstderr: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });
  });
}
```

### Step 7: Run hook tests

Run: `cd /opt/Klyde/projects/Devai && npm -w apps/api run test -- src/hooks/hookRunner.test.ts`
Expected: PASS — all 4 tests green.

### Step 8: Integrate hooks into `toolExecutor.ts`

In `apps/api/src/agents/chapo-loop/toolExecutor.ts`:

**Add import** at top:
```typescript
import { runHooks } from '../../hooks/hookRunner.js';
```

**Add `projectRoot` to `ToolExecutorDeps`** interface (after line 36 `iteration: number;`):
```typescript
projectRoot: string | null;
```

**Add before-hook** before the generic tool execution at line 268 (`// ACTION: TOOL`):
```typescript
// --- HOOK: before:tool ---
const beforeHook = await runHooks('before:tool', {
  toolName: toolCall.name,
  toolArgs: toolCall.arguments,
  projectRoot: this.deps.projectRoot,
});
if (beforeHook.blocked) {
  return {
    toolResult: {
      toolUseId: toolCall.id,
      result: `[BLOCKED] ${beforeHook.blockReason}`,
      isError: true,
    },
  };
}
```

**Add after-hook** after the tool result is built (after line 326, the `sendEvent` for `tool_result`):
```typescript
// --- HOOK: after:tool (fire-and-forget) ---
runHooks(content.isError ? 'after:tool:error' : 'after:tool', {
  toolName: toolCall.name,
  toolArgs: toolCall.arguments,
  toolResult: content.content,
  projectRoot: this.deps.projectRoot,
}).catch((err) => console.warn('[hooks] after:tool hook error:', err));
```

### Step 9: Pass `projectRoot` to `ChapoToolExecutor`

In `apps/api/src/agents/chapo-loop.ts`, at line 422-431 where `ChapoToolExecutor` is instantiated, add `projectRoot`:

```typescript
const toolExecutor = new ChapoToolExecutor({
  sessionId: this.sessionId,
  iteration: this.iteration,
  sendEvent: this.sendEvent,
  errorHandler: this.errorHandler,
  queueQuestion: this.queueQuestion.bind(this),
  queueApproval: this.queueApproval.bind(this),
  emitDecisionPath: this.emitDecisionPath.bind(this),
  buildToolResultContent,
  projectRoot: this.projectRoot,
});
```

### Step 10: Run full test suite

Run: `cd /opt/Klyde/projects/Devai && npm -w apps/api run test`
Expected: All tests PASS. (Existing `toolExecutor.test.ts` may need `projectRoot: null` added to its mock deps — check and fix if needed.)

### Step 11: Commit

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/hooks/ apps/api/src/agents/chapo-loop/toolExecutor.ts apps/api/src/agents/chapo-loop.ts
git commit -m "feat: hooks system — pre/post tool execution hooks via hooks.json"
```

---

## Task 4: Hierarchical Context Compaction

**Why:** Current compaction compresses the oldest 60% of messages into a flat summary, losing tool results, user decisions, and error resolutions. The sliding window is even worse — it drops old messages with a one-liner placeholder.

**Files:**
- Create: `apps/api/src/memory/contextTiers.ts`
- Create: `apps/api/src/memory/contextTiers.test.ts`
- Modify: `apps/api/src/agents/chapo-loop/contextManager.ts` (delegate to tiered manager)
- Modify: `apps/api/src/agents/conversation-manager.ts:24` (raise budget as safety net)

### Step 1: Write the context tiers test

Create `apps/api/src/memory/contextTiers.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../llm/router.js', () => ({
  llmRouter: {
    generateWithFallback: vi.fn(),
  },
}));

import { TieredContextManager } from './contextTiers.js';
import { llmRouter } from '../llm/router.js';

describe('TieredContextManager', () => {
  let manager: TieredContextManager;

  beforeEach(() => {
    vi.clearAllMocks();
    // Use very small budgets for testing
    manager = new TieredContextManager({ hot: 500, warm: 200, cold: 100 });
  });

  it('keeps messages in hot tier by default', () => {
    manager.addMessage({ role: 'user', content: 'hello' });
    manager.addMessage({ role: 'assistant', content: 'hi' });

    const messages = manager.buildMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('hello');
  });

  it('includes pinned request in build output', () => {
    manager.setPinnedRequest('Build a REST API');
    manager.addMessage({ role: 'user', content: 'hello' });

    const messages = manager.buildMessages();
    const pinned = messages.find((m) => typeof m.content === 'string' && m.content.includes('[ORIGINAL REQUEST'));
    expect(pinned).toBeDefined();
    expect(pinned!.content).toContain('Build a REST API');
  });

  it('reports token usage across all tiers', () => {
    manager.addMessage({ role: 'user', content: 'a'.repeat(400) });
    const usage = manager.getTokenUsage();
    expect(usage).toBeGreaterThan(90); // 400 chars / 4 = 100 tokens
  });

  it('compacts hot to warm when budget exceeded', async () => {
    vi.mocked(llmRouter.generateWithFallback).mockResolvedValueOnce({
      content: 'Summary of old messages.',
      finishReason: 'stop',
    } as any);

    // Add enough messages to exceed hot budget (500 tokens = 2000 chars)
    for (let i = 0; i < 15; i++) {
      manager.addMessage({ role: 'user', content: `Message ${i}: ${'x'.repeat(200)}` });
    }

    await manager.checkAndCompact();

    // After compaction, hot should have fewer messages
    const hotMessages = manager.getHotMessages();
    expect(hotMessages.length).toBeLessThan(15);

    // Build should include warm tier summary
    const allMessages = manager.buildMessages();
    const warmMsg = allMessages.find((m) => typeof m.content === 'string' && m.content.includes('[Recent Context'));
    expect(warmMsg).toBeDefined();
  });

  it('falls back gracefully when compaction LLM call fails', async () => {
    vi.mocked(llmRouter.generateWithFallback).mockRejectedValueOnce(new Error('LLM down'));

    for (let i = 0; i < 15; i++) {
      manager.addMessage({ role: 'user', content: `Message ${i}: ${'x'.repeat(200)}` });
    }

    await manager.checkAndCompact();

    // Messages should be preserved (compaction failed gracefully)
    const hotMessages = manager.getHotMessages();
    expect(hotMessages.length).toBe(15);
  });

  it('clear() resets all tiers', () => {
    manager.addMessage({ role: 'user', content: 'hello' });
    manager.setPinnedRequest('test');
    manager.clear();

    expect(manager.buildMessages()).toHaveLength(0);
    expect(manager.getTokenUsage()).toBe(0);
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd /opt/Klyde/projects/Devai && npm -w apps/api run test -- src/memory/contextTiers.test.ts`
Expected: FAIL — module not found.

### Step 3: Implement `contextTiers.ts`

Create `apps/api/src/memory/contextTiers.ts`:

```typescript
/**
 * Tiered Context Manager — 3-tier hierarchical context for long sessions.
 *
 * HOT:    Last N messages, full fidelity (recent context)
 * WARM:   LLM-summarized blocks (recent history)
 * COLD:   Bullet-point overview (background context)
 * PINNED: Original request + user decisions (never compacted)
 */

import type { LLMMessage } from '../llm/types.js';
import { getTextContent } from '../llm/types.js';
import { llmRouter } from '../llm/router.js';
import type { LLMProvider } from '../llm/types.js';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessageTokens(msg: LLMMessage): number {
  return estimateTokens(getTextContent(msg.content));
}

interface TierBudgets {
  hot: number;
  warm: number;
  cold: number;
}

const DEFAULT_BUDGETS: TierBudgets = {
  hot: 80_000,
  warm: 20_000,
  cold: 5_000,
};

const HOT_MIN_KEPT = 10;

const WARM_SUMMARY_PROMPT = `Summarize these conversation messages concisely. Preserve:
- Tool execution results (what was done, what was found)
- Decisions made and their reasoning
- Error messages and how they were resolved
- File paths and code snippets that are still relevant

Be concise but don't lose important details. Use bullet points.`;

const COLD_SUMMARY_PROMPT = `Condense these conversation summaries into a very brief overview (max 10 bullet points). Focus only on:
- What the user originally asked
- What major actions were taken
- Current state / what's left to do`;

export class TieredContextManager {
  private cold = '';
  private warm: string[] = [];
  private hot: LLMMessage[] = [];
  private budgets: TierBudgets;
  private pinnedRequest = '';

  constructor(budgets?: Partial<TierBudgets>) {
    this.budgets = { ...DEFAULT_BUDGETS, ...budgets };
  }

  setPinnedRequest(text: string): void {
    this.pinnedRequest = text;
  }

  addMessage(msg: LLMMessage): void {
    this.hot.push(msg);
  }

  getHotMessages(): LLMMessage[] {
    return [...this.hot];
  }

  /**
   * Build the full message array for the LLM, with all tiers assembled.
   */
  buildMessages(): LLMMessage[] {
    const messages: LLMMessage[] = [];

    // 1. Cold tier (oldest context, brief)
    if (this.cold) {
      messages.push({
        role: 'system',
        content: `[Session History — Overview]\n${this.cold}`,
      });
    }

    // 2. Warm tier (summarized recent history)
    if (this.warm.length > 0) {
      messages.push({
        role: 'system',
        content: `[Recent Context — Summarized]\n${this.warm.join('\n\n---\n\n')}`,
      });
    }

    // 3. Pinned request
    if (this.pinnedRequest) {
      messages.push({
        role: 'system',
        content: `[ORIGINAL REQUEST — pinned]\n${this.pinnedRequest}`,
      });
    }

    // 4. Hot tier (full fidelity recent messages)
    messages.push(...this.hot);

    return messages;
  }

  getTokenUsage(): number {
    let total = 0;
    total += estimateTokens(this.cold);
    for (const w of this.warm) total += estimateTokens(w);
    total += estimateTokens(this.pinnedRequest);
    for (const h of this.hot) total += estimateMessageTokens(h);
    return total;
  }

  /**
   * Check if compaction is needed and execute it.
   * Call this before each LLM call.
   */
  async checkAndCompact(provider?: LLMProvider): Promise<void> {
    const hotTokens = this.hot.reduce((sum, m) => sum + estimateMessageTokens(m), 0);

    // HOT -> WARM: when hot exceeds budget
    if (hotTokens > this.budgets.hot && this.hot.length > HOT_MIN_KEPT) {
      await this.compactHotToWarm(provider);
    }

    // WARM -> COLD: when warm exceeds budget
    const warmTokens = this.warm.reduce((sum, s) => sum + estimateTokens(s), 0);
    if (warmTokens > this.budgets.warm) {
      await this.compactWarmToCold(provider);
    }
  }

  private async compactHotToWarm(provider?: LLMProvider): Promise<void> {
    const moveCount = this.hot.length - HOT_MIN_KEPT;
    if (moveCount < 2) return;

    const toCompact = this.hot.splice(0, moveCount);

    const transcript = toCompact
      .map((m) => `[${m.role}]: ${getTextContent(m.content)}`)
      .join('\n\n');

    try {
      const response = await llmRouter.generateWithFallback(
        provider ?? 'zai',
        {
          model: 'glm-4.7-flash',
          messages: [{ role: 'user', content: transcript }],
          systemPrompt: WARM_SUMMARY_PROMPT,
          maxTokens: 2048,
        },
      );
      this.warm.push(response.content);
      console.log(`[context-tiers] HOT->WARM: ${moveCount} messages -> ${estimateTokens(response.content)} tokens`);
    } catch (err) {
      // Compaction failed — push messages back to hot
      this.hot.unshift(...toCompact);
      console.error('[context-tiers] HOT->WARM compaction failed:', err);
    }
  }

  private async compactWarmToCold(provider?: LLMProvider): Promise<void> {
    const allWarm = this.warm.join('\n\n');

    try {
      const response = await llmRouter.generateWithFallback(
        provider ?? 'zai',
        {
          model: 'glm-4.7-flash',
          messages: [
            {
              role: 'user',
              content: `${this.cold ? `Previous overview:\n${this.cold}\n\n` : ''}New summaries:\n${allWarm}`,
            },
          ],
          systemPrompt: COLD_SUMMARY_PROMPT,
          maxTokens: 1024,
        },
      );
      this.cold = response.content;
      this.warm = [];
      console.log(`[context-tiers] WARM->COLD: ${estimateTokens(allWarm)} -> ${estimateTokens(this.cold)} tokens`);
    } catch (err) {
      console.error('[context-tiers] WARM->COLD compaction failed:', err);
    }
  }

  clear(): void {
    this.hot = [];
    this.warm = [];
    this.cold = '';
    this.pinnedRequest = '';
  }
}
```

### Step 4: Run test to verify it passes

Run: `cd /opt/Klyde/projects/Devai && npm -w apps/api run test -- src/memory/contextTiers.test.ts`
Expected: PASS — all 6 tests green.

### Step 5: Integrate into `ChapoLoopContextManager`

In `apps/api/src/agents/chapo-loop/contextManager.ts`, replace the compaction logic to delegate to `TieredContextManager`:

**Add import** at top:
```typescript
import { TieredContextManager } from '../../memory/contextTiers.js';
```

**Add field** to `ChapoLoopContextManager`:
```typescript
private tieredContext: TieredContextManager;
```

**Initialize in constructor:**
```typescript
constructor(
  private sessionId: string,
  private sendEvent: (event: AgentStreamEvent) => void,
  private conversation: ConversationManager,
) {
  this.tieredContext = new TieredContextManager();
}
```

**Replace `checkAndCompact()`** with tiered delegation:

```typescript
async checkAndCompact(): Promise<void> {
  const usage = this.conversation.getTokenUsage();

  // First pass: try tiered compaction (if messages are being tracked)
  if (usage > COMPACTION_THRESHOLD) {
    // Delegate to tiered context manager for future compaction
    // For now, fall back to existing flat compaction
    const messages = this.conversation.getMessages();
    const compactCount = Math.floor(messages.length * 0.6);
    if (compactCount < 2) return;

    const toCompact = messages.slice(0, compactCount);
    const toKeep = messages.slice(compactCount);

    const result = await compactMessages(toCompact, this.sessionId);

    if (result.failed) {
      this.sendEvent({
        type: 'agent_thinking',
        agent: 'chapo',
        status: 'Compaction failed — keeping original context',
      });
      return;
    }

    this.conversation.clear();
    this.conversation.addMessage({
      role: 'system',
      content: `[Context compacted — ${result.droppedTokens} tokens summarized]\n\n${result.summary}`,
    });

    if (this.originalUserMessage) {
      this.conversation.addMessage({
        role: 'system',
        content: `[ORIGINAL REQUEST — pinned]\n${this.originalUserMessage}`,
      });
    }

    for (const msg of toKeep) {
      this.conversation.addMessage(msg);
    }

    this.sendEvent({
      type: 'agent_thinking',
      agent: 'chapo',
      status: `Context kompaktiert: ${result.droppedTokens} → ${result.summaryTokens} Tokens`,
    });
  }
}
```

> **Note:** This step keeps the existing flat compaction as fallback. The `TieredContextManager` is instantiated but not yet the primary path. Task 4 Step 7 will switch to using it as the primary.

### Step 6: Raise conversation manager budget

In `apps/api/src/agents/conversation-manager.ts`, the budget is now set at the `ChapoLoop` constructor level (line 105 of `chapo-loop.ts` already passes `180_000`). The default in `conversation-manager.ts` line 24 can stay as-is since the explicit value overrides it.

### Step 7: Full migration to tiered context (separate PR)

This step is deferred to a follow-up. For now, the `TieredContextManager` class is available and tested. The full migration requires:

1. Replace `ConversationManager` in `ChapoLoop` with `TieredContextManager`
2. Update `buildLLMMessages()` calls to use `tieredContext.buildMessages()`
3. Update all `addMessage()` calls to go through `tieredContext.addMessage()`
4. Remove the `ConversationManager` as the primary message store

This is a larger refactor that should be done in its own PR after the `TieredContextManager` has been battle-tested with the fallback path.

### Step 8: Run full test suite

Run: `cd /opt/Klyde/projects/Devai && npm -w apps/api run test`
Expected: All tests PASS.

### Step 9: Commit

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/memory/contextTiers.ts apps/api/src/memory/contextTiers.test.ts apps/api/src/agents/chapo-loop/contextManager.ts
git commit -m "feat: tiered context manager — 3-tier hierarchical context for long sessions"
```

---

## Task 5: Sub-Agent Delegation

**Why:** CHAPO handles everything sequentially in one context window. Research, implementation, and verification phases fill context with data the next phase doesn't need. Delegation tools let CHAPO spawn isolated sub-agents for read-only research and bash tasks.

**Files:**
- Create: `apps/api/src/agents/sub-agent.ts`
- Create: `apps/api/src/agents/sub-agent.test.ts`
- Create: `apps/api/src/tools/definitions/delegateTools.ts`
- Create: `apps/api/src/tools/definitions/delegateTools.test.ts`
- Modify: `apps/api/src/agents/chapo.ts:37-83` (add delegate tools to CHAPO's tool list)
- Modify: `apps/api/src/tools/toolFilter.ts:12-68` (add delegation category)
- Modify: `apps/api/src/tools/registry.ts` (register delegate tools)

### Step 1: Write the sub-agent test

Create `apps/api/src/agents/sub-agent.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../llm/router.js', () => ({
  llmRouter: {
    generateWithFallback: vi.fn(),
  },
}));

vi.mock('../tools/registry.js', () => ({
  getToolsForLLM: vi.fn().mockReturnValue([
    { name: 'fs_readFile', description: 'Read file', inputSchema: { type: 'object', properties: {} } },
    { name: 'fs_glob', description: 'Glob', inputSchema: { type: 'object', properties: {} } },
    { name: 'bash_execute', description: 'Bash', inputSchema: { type: 'object', properties: {} } },
  ]),
}));

vi.mock('../actions/approvalBridge.js', () => ({
  executeToolWithApprovalBridge: vi.fn(),
}));

import { runSubAgent } from './sub-agent.js';
import { llmRouter } from '../llm/router.js';
import { executeToolWithApprovalBridge } from '../actions/approvalBridge.js';

describe('runSubAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns summary when LLM responds without tool calls', async () => {
    vi.mocked(llmRouter.generateWithFallback).mockResolvedValueOnce({
      content: 'The auth system uses JWT tokens stored in cookies.',
      finishReason: 'stop',
      toolCalls: undefined,
      usage: { inputTokens: 100, outputTokens: 50 },
    } as any);

    const result = await runSubAgent({
      type: 'research',
      task: 'How does auth work?',
      provider: 'zai',
      model: 'glm-4.7-flash',
    });

    expect(result.success).toBe(true);
    expect(result.summary).toContain('JWT tokens');
    expect(result.iterations).toBe(1);
  });

  it('executes tool calls and loops', async () => {
    // First call: LLM wants to read a file
    vi.mocked(llmRouter.generateWithFallback).mockResolvedValueOnce({
      content: 'Let me read the auth file.',
      finishReason: 'tool_use',
      toolCalls: [{ id: 'tc1', name: 'fs_readFile', arguments: { path: '/src/auth.ts' } }],
      usage: { inputTokens: 100, outputTokens: 50 },
    } as any);

    vi.mocked(executeToolWithApprovalBridge).mockResolvedValueOnce({
      success: true,
      result: 'export function authenticate() { ... }',
    });

    // Second call: LLM answers
    vi.mocked(llmRouter.generateWithFallback).mockResolvedValueOnce({
      content: 'Auth uses a custom authenticate() function.',
      finishReason: 'stop',
      toolCalls: undefined,
      usage: { inputTokens: 200, outputTokens: 80 },
    } as any);

    const result = await runSubAgent({
      type: 'research',
      task: 'How does auth work?',
      provider: 'zai',
      model: 'glm-4.7-flash',
    });

    expect(result.success).toBe(true);
    expect(result.iterations).toBe(2);
    expect(result.tokensUsed).toBe(430); // 100+50+200+80
  });

  it('respects max iterations limit', async () => {
    // Always return tool calls to trigger max iterations
    vi.mocked(llmRouter.generateWithFallback).mockResolvedValue({
      content: 'Reading more...',
      finishReason: 'tool_use',
      toolCalls: [{ id: 'tc1', name: 'fs_readFile', arguments: { path: '/src/test.ts' } }],
      usage: { inputTokens: 50, outputTokens: 30 },
    } as any);

    vi.mocked(executeToolWithApprovalBridge).mockResolvedValue({
      success: true,
      result: 'file content',
    });

    const result = await runSubAgent({
      type: 'research',
      task: 'Read everything',
      provider: 'zai',
      model: 'glm-4.7-flash',
      maxIterations: 3,
    });

    expect(result.success).toBe(false);
    expect(result.iterations).toBe(3);
    expect(result.summary).toContain('max iterations');
  });

  it('filters tools by sub-agent type', async () => {
    vi.mocked(llmRouter.generateWithFallback).mockResolvedValueOnce({
      content: 'Done.',
      finishReason: 'stop',
      usage: { inputTokens: 50, outputTokens: 20 },
    } as any);

    await runSubAgent({
      type: 'bash',
      task: 'Run tests',
      provider: 'zai',
      model: 'glm-4.7-flash',
    });

    // Verify the tools passed to LLM only include bash tools
    const callArgs = vi.mocked(llmRouter.generateWithFallback).mock.calls[0][1];
    const toolNames = callArgs.tools!.map((t: any) => t.name);
    expect(toolNames).toContain('bash_execute');
    expect(toolNames).not.toContain('fs_readFile');
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd /opt/Klyde/projects/Devai && npm -w apps/api run test -- src/agents/sub-agent.test.ts`
Expected: FAIL — module not found.

### Step 3: Implement `sub-agent.ts`

Create `apps/api/src/agents/sub-agent.ts`:

```typescript
/**
 * Sub-Agent — lightweight isolated agent for delegated tasks.
 *
 * Two types:
 * - research: read-only file access + web search
 * - bash: bash execution only
 *
 * Sub-agents get their own conversation context and strict limits.
 */

import { ConversationManager } from './conversation-manager.js';
import { llmRouter } from '../llm/router.js';
import { getToolsForLLM } from '../tools/registry.js';
import type { LLMProvider } from '../llm/types.js';
import { executeToolWithApprovalBridge } from '../actions/approvalBridge.js';

type SubAgentType = 'research' | 'bash';

const SUB_AGENT_TOOLS: Record<SubAgentType, string[]> = {
  research: ['fs_readFile', 'fs_glob', 'fs_grep', 'fs_listFiles', 'web_search', 'web_fetch'],
  bash: ['bash_execute'],
};

const SUB_AGENT_PROMPTS: Record<SubAgentType, string> = {
  research: `You are a research sub-agent. Your job is to gather information and report findings.
You have read-only access to files and web search. Gather the requested information efficiently.
When done, provide a clear structured summary of your findings. Do NOT make changes to any files.`,
  bash: `You are a bash execution sub-agent. Run the requested command(s) and report the results.
Provide stdout, stderr, and exit code. Do NOT run destructive commands unless explicitly instructed.`,
};

interface SubAgentConfig {
  type: SubAgentType;
  task: string;
  provider: LLMProvider;
  model: string;
  maxIterations?: number;
  timeoutMs?: number;
}

export interface SubAgentResult {
  summary: string;
  success: boolean;
  iterations: number;
  tokensUsed: number;
}

/**
 * Run a sub-agent to completion.
 * Returns a structured summary for injection into the parent loop.
 */
export async function runSubAgent(config: SubAgentConfig): Promise<SubAgentResult> {
  const maxIterations = config.maxIterations || 10;
  const timeoutMs = config.timeoutMs || 60_000;

  const allowedTools = SUB_AGENT_TOOLS[config.type];
  const allTools = getToolsForLLM().filter((t) => allowedTools.includes(t.name));
  const conversation = new ConversationManager(50_000);

  conversation.setSystemPrompt(SUB_AGENT_PROMPTS[config.type]);
  conversation.addMessage({ role: 'user', content: config.task });

  let tokensUsed = 0;
  const startTime = Date.now();

  for (let i = 0; i < maxIterations; i++) {
    if (Date.now() - startTime > timeoutMs) {
      return {
        summary: `Sub-agent timed out after ${i} iterations.`,
        success: false,
        iterations: i,
        tokensUsed,
      };
    }

    const response = await llmRouter.generateWithFallback(config.provider, {
      model: config.model,
      messages: conversation.buildLLMMessages(),
      systemPrompt: conversation.getSystemPrompt(),
      tools: allTools,
      toolsEnabled: true,
    });

    if (response.usage) {
      tokensUsed += response.usage.inputTokens + response.usage.outputTokens;
    }

    // No tool calls = done
    if (!response.toolCalls || response.toolCalls.length === 0) {
      return {
        summary: response.content || 'No findings.',
        success: true,
        iterations: i + 1,
        tokensUsed,
      };
    }

    // Execute tools
    conversation.addMessage({
      role: 'assistant',
      content: response.content || '',
      toolCalls: response.toolCalls,
    });

    const toolResults: { toolUseId: string; result: string; isError: boolean }[] = [];
    for (const tc of response.toolCalls) {
      try {
        const result = await executeToolWithApprovalBridge(tc.name, tc.arguments, {
          agentName: 'chapo-sub',
        });
        const content = result.success
          ? String(result.result ?? '')
          : `Error: ${result.error || 'Unknown error'}`;
        toolResults.push({ toolUseId: tc.id, result: content.slice(0, 8000), isError: !result.success });
      } catch (err) {
        toolResults.push({
          toolUseId: tc.id,
          result: `Error: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        });
      }
    }

    conversation.addMessage({ role: 'user', content: '', toolResults });
  }

  return {
    summary: 'Sub-agent reached max iterations without completing.',
    success: false,
    iterations: maxIterations,
    tokensUsed,
  };
}
```

### Step 4: Run test to verify it passes

Run: `cd /opt/Klyde/projects/Devai && npm -w apps/api run test -- src/agents/sub-agent.test.ts`
Expected: PASS — all 4 tests green.

### Step 5: Write the delegate tools test

Create `apps/api/src/tools/definitions/delegateTools.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../agents/sub-agent.js', () => ({
  runSubAgent: vi.fn(),
}));

vi.mock('../../agents/stateManager.js', () => ({
  getState: vi.fn().mockReturnValue({
    taskContext: {
      gatheredInfo: {
        provider: 'zai',
        fastModel: 'glm-4.7-flash',
      },
    },
  }),
}));

import { delegateResearchTool, delegateBashTool } from './delegateTools.js';
import { runSubAgent } from '../../agents/sub-agent.js';

describe('delegateResearchTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to research sub-agent and returns result', async () => {
    vi.mocked(runSubAgent).mockResolvedValueOnce({
      summary: 'Auth uses JWT in cookies.',
      success: true,
      iterations: 2,
      tokensUsed: 500,
    });

    const result = await delegateResearchTool.execute(
      { task: 'How does auth work?' },
      { sessionId: 'sess-1' } as any,
    );

    expect(result.success).toBe(true);
    expect(result.result).toContain('Auth uses JWT');
    expect(result.result).toContain('2 iterations');
    expect(vi.mocked(runSubAgent)).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'research', task: 'How does auth work?' }),
    );
  });
});

describe('delegateBashTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to bash sub-agent and returns result', async () => {
    vi.mocked(runSubAgent).mockResolvedValueOnce({
      summary: 'All 42 tests passed.',
      success: true,
      iterations: 1,
      tokensUsed: 200,
    });

    const result = await delegateBashTool.execute(
      { task: 'Run npm test' },
      { sessionId: 'sess-1' } as any,
    );

    expect(result.success).toBe(true);
    expect(result.result).toContain('42 tests passed');
    expect(vi.mocked(runSubAgent)).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bash', task: 'Run npm test' }),
    );
  });
});
```

### Step 6: Implement `delegateTools.ts`

Create `apps/api/src/tools/definitions/delegateTools.ts`:

```typescript
/**
 * Delegation Tools — CHAPO can delegate research and bash tasks
 * to isolated sub-agents with their own context windows.
 */

import { runSubAgent } from '../../agents/sub-agent.js';
import * as stateManager from '../../agents/stateManager.js';
import type { LLMProvider } from '../../llm/types.js';

interface ToolExecutionContext {
  sessionId: string;
}

interface ToolResult {
  success: boolean;
  result: string;
}

export const delegateResearchTool = {
  name: 'delegate_research',
  description: 'Delegate a research task to a read-only sub-agent. The sub-agent can read files and search the web, then returns a summary. Use this for tasks like "read these files and summarize how X works" or "search the web for Y".',
  parameters: {
    type: 'object' as const,
    properties: {
      task: {
        type: 'string',
        description: 'What to research. Be specific about what files to read or what to search for.',
      },
    },
    required: ['task'],
  },
  execute: async (args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> => {
    const state = stateManager.getState(context.sessionId);
    const provider = (state?.taskContext.gatheredInfo.provider || 'zai') as LLMProvider;
    const model = (state?.taskContext.gatheredInfo.fastModel as string) || 'glm-4.7-flash';

    const result = await runSubAgent({
      type: 'research',
      task: args.task as string,
      provider,
      model,
    });

    return {
      success: result.success,
      result: `[Research Sub-Agent — ${result.iterations} iterations, ${result.tokensUsed} tokens]\n\n${result.summary}`,
    };
  },
};

export const delegateBashTool = {
  name: 'delegate_bash',
  description: 'Delegate a bash command or test suite to an isolated sub-agent. The sub-agent runs the command(s) and returns stdout/stderr. Use this for running tests, builds, or other commands where you need the output.',
  parameters: {
    type: 'object' as const,
    properties: {
      task: {
        type: 'string',
        description: 'What to run. Describe the command(s) and what output you need.',
      },
    },
    required: ['task'],
  },
  execute: async (args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> => {
    const state = stateManager.getState(context.sessionId);
    const provider = (state?.taskContext.gatheredInfo.provider || 'zai') as LLMProvider;
    const model = (state?.taskContext.gatheredInfo.fastModel as string) || 'glm-4.7-flash';

    const result = await runSubAgent({
      type: 'bash',
      task: args.task as string,
      provider,
      model,
    });

    return {
      success: result.success,
      result: `[Bash Sub-Agent — ${result.iterations} iterations]\n\n${result.summary}`,
    };
  },
};
```

### Step 7: Run delegate tools tests

Run: `cd /opt/Klyde/projects/Devai && npm -w apps/api run test -- src/tools/definitions/delegateTools.test.ts`
Expected: PASS — all 2 tests green.

### Step 8: Register delegate tools

**In `apps/api/src/agents/chapo.ts`**, add to the tools array (after line 82):
```typescript
// -- Delegation --
'delegate_research', 'delegate_bash',
```

**In `apps/api/src/tools/toolFilter.ts`**, add new category and trigger:

After line 53 (after `skills`), add:
```typescript
delegation: [
  'delegate_research', 'delegate_bash',
],
```

After line 67 (after `skills` trigger), add:
```typescript
delegation: /\b(research|investigat|explore|read.{0,10}files|find.{0,10}out|gather|collect|run.{0,10}test|test.{0,10}suite|build|compile|delegate)\b/i,
```

**In `apps/api/src/tools/registry.ts`**, register the delegate tools. Find where native tools are registered and add:

```typescript
import { delegateResearchTool, delegateBashTool } from './definitions/delegateTools.js';
```

Register them alongside other tool definitions. The exact registration depends on the registry pattern — look for where tools like `fs_readFile` are registered and follow the same pattern for `delegate_research` and `delegate_bash`.

### Step 9: Run full test suite

Run: `cd /opt/Klyde/projects/Devai && npm -w apps/api run test`
Expected: All tests PASS. If toolFilter tests exist, they may need updates for the new category.

### Step 10: Commit

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/agents/sub-agent.ts apps/api/src/agents/sub-agent.test.ts apps/api/src/tools/definitions/delegateTools.ts apps/api/src/tools/definitions/delegateTools.test.ts apps/api/src/agents/chapo.ts apps/api/src/tools/toolFilter.ts apps/api/src/tools/registry.ts
git commit -m "feat: sub-agent delegation — delegate_research and delegate_bash tools"
```

### Verification (manual)

1. Send "research how the auth system works in this project" — should delegate to research sub-agent
2. Send "run the test suite and tell me what fails" — should delegate to bash sub-agent
3. Verify sub-agent results appear as tool results in the main conversation
4. Check logs for sub-agent iterations and token usage

---

## Implementation Order Summary

| Order | Feature | Effort | Dependencies |
|-------|---------|--------|-------------|
| 1 | Multi-Model Cost Routing | 1 day | None |
| 2 | Reflexion Loop | 2 days | None (uses fastModel from #1 if available) |
| 3 | Hooks System | 2 days | None |
| 4 | Hierarchical Context Compaction | 3 days | None |
| 5 | Sub-Agent Delegation | 4 days | Benefits from #4 context protection |

**Total: ~12 days**

## Files Created/Modified Summary

| File | Action | Task |
|------|--------|------|
| `agents/chapo-loop/costRouting.ts` | CREATE | 1 |
| `agents/chapo-loop/costRouting.test.ts` | CREATE | 1 |
| `agents/types.ts` | MODIFY | 1 |
| `llm/modelSelector.ts` | MODIFY | 1 |
| `agents/chapo-loop.ts` | MODIFY | 1, 2, 3 |
| `agents/reflexion.ts` | CREATE | 2 |
| `agents/reflexion.test.ts` | CREATE | 2 |
| `hooks/hookConfig.ts` | CREATE | 3 |
| `hooks/hookConfig.test.ts` | CREATE | 3 |
| `hooks/hookRunner.ts` | CREATE | 3 |
| `hooks/hookRunner.test.ts` | CREATE | 3 |
| `agents/chapo-loop/toolExecutor.ts` | MODIFY | 3 |
| `memory/contextTiers.ts` | CREATE | 4 |
| `memory/contextTiers.test.ts` | CREATE | 4 |
| `agents/chapo-loop/contextManager.ts` | MODIFY | 4 |
| `agents/sub-agent.ts` | CREATE | 5 |
| `agents/sub-agent.test.ts` | CREATE | 5 |
| `tools/definitions/delegateTools.ts` | CREATE | 5 |
| `tools/definitions/delegateTools.test.ts` | CREATE | 5 |
| `agents/chapo.ts` | MODIFY | 5 |
| `tools/toolFilter.ts` | MODIFY | 5 |
| `tools/registry.ts` | MODIFY | 5 |

**11 new files, 11 modified files.**
