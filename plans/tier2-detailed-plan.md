# Tier 2: Medium Effort, High Impact — Detailed Implementation Plan

> Prerequisite: Tier 1 completed (Tool RAG, Kimi ID fix, GLM-5 thinking, cache detection)

---

## #9. Multi-Model Cost Routing

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

The `fastModel` already exists in every engine profile but is only used for summarization (`compaction.ts`). We reuse it for execution-phase iterations.

### Files to Modify

#### 1. `apps/api/src/agents/chapo-loop.ts`

Replace the static `model` usage in `runLoop()` with a dynamic `selectModelForIteration()`.

**Current code** (line 273):
```typescript
const model = this.modelSelection.model || chapo.model;
```

**Change to** — add model tier selection inside the loop (before the LLM call, ~line 343):

```typescript
// Before the LLM call, select model tier
const modelForThisTurn = selectModelForIteration({
  iteration: this.iteration,
  primaryModel: model,
  fastModel: this.modelSelection.fastModel,
  hadRecentError: lastErrorMessage !== '',
  thinkingEnabled,
  userText,
});
```

And pass `modelForThisTurn` instead of `model` in the `generateWithFallback` call (line 347):
```typescript
model: modelForThisTurn,
```

**New function** (add near `shouldEnableThinking`):

```typescript
interface ModelTierInput {
  iteration: number;
  primaryModel: string;
  fastModel?: string;
  hadRecentError: boolean;
  thinkingEnabled: boolean;
  userText: string;
}

function selectModelForIteration(input: ModelTierInput): string {
  const { iteration, primaryModel, fastModel, hadRecentError, thinkingEnabled, userText } = input;

  // No fast model configured → always use primary
  if (!fastModel) return primaryModel;

  // Always use primary for:
  // - First 2 iterations (planning + initial execution)
  // - Thinking-enabled turns (complex reasoning)
  // - Error recovery (need full reasoning to fix approach)
  if (iteration < 2) return primaryModel;
  if (thinkingEnabled) return primaryModel;
  if (hadRecentError) return primaryModel;

  // After iteration 3, downgrade to fast model for execution-phase
  return fastModel;
}
```

#### 2. `apps/api/src/agents/types.ts`

Add `fastModel` to `ModelSelection` interface:

```typescript
export interface ModelSelection {
  model: string;
  provider?: LLMProvider;
  fastModel?: string;                    // ADD THIS
  sameProviderFallbacks?: string[];
}
```

#### 3. `apps/api/src/llm/modelSelector.ts`

Pass `fastModel` through from engine profile:

```typescript
// In resolveModelSelection():
const effectiveFastModel = override?.fastModel ?? undefined;

return {
  model: effectiveModel,
  provider: effectiveProvider,
  fastModel: effectiveFastModel,          // ADD THIS
  sameProviderFallbacks: ...,
};
```

#### 4. Logging

Update the existing log line (chapo-loop.ts ~line 344) to show which model tier was selected:

```typescript
console.log(`${trace}[chapo-loop] LLM call #${this.iteration} starting (${provider}/${modelForThisTurn}${modelForThisTurn !== model ? ' [fast]' : ''}, ${tools.length}/${allTools.length} tools, thinking=${thinkingEnabled})`);
```

### Engine Mapping

| Engine | Primary | Fast | Cost Routing Active |
|--------|---------|------|---------------------|
| `/engine glm` | `glm-5` | `glm-4.7-flash` | Yes — iteration 2+ uses flash |
| `/engine kimi` | `kimi-k2.5` | `glm-4.7-flash` | Yes — fast is cross-provider (ZAI) |
| `/engine claude` | `claude-opus-4-5` | `glm-4.7-flash` | Yes — fast is cross-provider (ZAI) |
| `/engine gemini` | `gemini-3.1-pro` | `glm-4.7-flash` | Yes — fast is cross-provider (ZAI) |

### Verification

1. Start session with `/engine glm`, send a multi-step task (e.g. "read file X, then edit Y, then commit")
2. Check logs: iterations 0-1 should show `glm-5`, iteration 2+ should show `glm-4.7-flash [fast]`
3. Verify error recovery: trigger an error mid-loop → next iteration should use primary model

---

## #8. Reflexion Loop (Self-Critique)

**Effort**: ~2 days | **Impact**: Directly improves response quality, catches hallucinations
**Engine**: ALL (most impactful with GLM-5 which sometimes hallucinates tool arguments)

### Problem

CHAPO delivers its answer as soon as it has no more tool calls. There's no quality gate — if the LLM hallucinates, gives a partial answer, or misunderstands the question, the user gets a bad response. Claude Code and other systems have self-review steps that catch these issues.

### Design

After CHAPO decides ANSWER (no tool calls), but BEFORE returning the result, run a fast self-review pass:

```
User query → CHAPO loop → [ANSWER decision] → Reflexion check → Final answer
                                                    ↓ (if issues found)
                                              Re-inject feedback → 1 more CHAPO iteration
```

**Skip reflexion for**:
- Short answers (< 200 chars) — status updates, confirmations
- Tool-heavy sessions (iteration > 5) — the tools already verified the work
- Fast model iterations — reflexion uses the fast model, so don't review fast-model answers

### Files to Modify

#### 1. New file: `apps/api/src/agents/reflexion.ts`

```typescript
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
      systemPrompt: REFLEXION_PROMPT,
      messages: [
        {
          role: 'user',
          content: `User question: ${userQuery.slice(0, 1000)}\n\nAssistant answer:\n${answer.slice(0, 3000)}`,
        },
      ],
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

    // Ambiguous response → approve (don't block on parsing issues)
    return { approved: true };
  } catch {
    // Reflexion failed → don't block the answer
    console.warn('[reflexion] Self-review failed, approving by default');
    return { approved: true };
  }
}
```

#### 2. `apps/api/src/agents/chapo-loop.ts`

Hook reflexion into the ANSWER path (~line 407-411):

**Current code:**
```typescript
// No tool calls → ACTION: ANSWER (direct — loop ends)
if (!response.toolCalls || response.toolCalls.length === 0) {
  const answer = response.content || '';
  const userText = getTextContent(userMessage);
  return this.answerValidator.validateAndNormalize(userText, answer, this.iteration, this.emitDecisionPath.bind(this));
}
```

**Change to:**
```typescript
// No tool calls → ACTION: ANSWER
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

**Add field** to ChapoLoop class (~line 82):
```typescript
private reflexionUsed = false;
```

**Add import** at top:
```typescript
import { reviewAnswer } from './reflexion.js';
```

### Edge Cases

- **Reflexion itself fails** → approve by default (try/catch in `reviewAnswer`)
- **Reflexion fires max 1 time** → `reflexionUsed` flag prevents infinite re-review
- **Short answers skip** → < 200 chars are not reviewed
- **Late iterations skip** → iteration > 5 means the agent has been doing tool work, answer is likely execution-based
- **Fast-model iterations** → if cost routing sends to fast model, skip reflexion (don't review fast with fast)

### Verification

1. Send a vague question like "tell me about this project" — if answer is generic/incomplete, reflexion should catch it
2. Send a clear question with a direct answer — reflexion should approve quickly
3. Check logs for `[chapo-loop] Reflexion rejected answer:` when it fires
4. Verify latency: reflexion should add < 2s (uses flash model with 256 max tokens)

---

## #5. Hooks System (Pre/Post Tool Execution)

**Effort**: ~2 days | **Impact**: Enables user customization, auto-linting, approval gates
**Engine**: ALL

### Problem

DevAI has no extension point for running custom logic around tool executions. Users can't auto-format after file writes, auto-lint, add logging, or create approval gates for destructive operations. Claude Code's hooks system is one of its most powerful features.

### Design

Use the existing **event projection system** (`workflowBus`) as the backbone. Instead of a separate hook runner, add a new `HookProjection` that listens for tool events and runs user-configured commands.

This is more maintainable than a standalone hook system because:
- It uses the existing event dispatch infrastructure
- It doesn't require wrapping tool execution in chapo-loop
- It naturally handles async execution

#### Hook Config Schema

```typescript
// File: ~/.devai/hooks.json (or workspace/hooks.json per project)
interface HookConfig {
  version: 1;
  hooks: HookRule[];
}

interface HookRule {
  /** When this hook fires */
  event: 'before:tool' | 'after:tool' | 'after:tool:error' | 'on:answer';
  /** Optional: only fire for specific tools (glob pattern) */
  toolMatch?: string;    // e.g. "fs_*", "git_*", "bash_execute"
  /** Shell command to execute */
  command: string;
  /** Working directory (default: projectRoot) */
  cwd?: string;
  /** Timeout in ms (default: 10000, max: 30000) */
  timeout?: number;
  /** If true, hook failure blocks the tool execution (only for before:tool) */
  blocking?: boolean;
}
```

**Example `hooks.json`:**
```json
{
  "version": 1,
  "hooks": [
    {
      "event": "after:tool",
      "toolMatch": "fs_writeFile",
      "command": "npx prettier --write \"$HOOK_FILE_PATH\"",
      "timeout": 5000
    },
    {
      "event": "after:tool",
      "toolMatch": "git_commit",
      "command": "npx eslint --fix .",
      "timeout": 15000
    },
    {
      "event": "before:tool",
      "toolMatch": "bash_execute",
      "command": "echo \"Running: $HOOK_TOOL_ARGS\" >> /tmp/devai-audit.log"
    }
  ]
}
```

### Files to Create/Modify

#### 1. New file: `apps/api/src/hooks/hookConfig.ts`

```typescript
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
 * Load hooks from workspace/hooks.json or ~/.devai/hooks.json
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
```

#### 2. New file: `apps/api/src/hooks/hookRunner.ts`

```typescript
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
      ...process.env,
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
      await execCommand(hook.command, {
        cwd,
        env,
        timeout: hook.timeout || 10_000,
      });
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
      maxBuffer: 1024 * 256, // 256KB
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

#### 3. `apps/api/src/agents/chapo-loop/toolExecutor.ts`

Wrap the tool execution path with before/after hooks.

**At the generic tool execution section** (~line 268-339), wrap with hooks:

```typescript
// Before the existing tool execution code:
import { runHooks } from '../../hooks/hookRunner.js';

// Inside execute(), before the generic tool path:
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

// ... existing tool execution code ...

// After tool execution succeeds:
// --- HOOK: after:tool ---
runHooks(toolResult.isError ? 'after:tool:error' : 'after:tool', {
  toolName: toolCall.name,
  toolArgs: toolCall.arguments,
  toolResult: toolResult.result,
  projectRoot: this.deps.projectRoot,
}).catch((err) => console.warn('[hooks] after:tool hook error:', err));
```

**Note**: `projectRoot` needs to be added to `ToolExecutorDeps` interface:
```typescript
interface ToolExecutorDeps {
  // ... existing fields ...
  projectRoot: string | null;     // ADD THIS
}
```

And passed from chapo-loop.ts where `ChapoToolExecutor` is instantiated (~line 422):
```typescript
const toolExecutor = new ChapoToolExecutor({
  // ... existing fields ...
  projectRoot: this.projectRoot,  // ADD THIS
});
```

### Verification

1. Create `~/.devai/hooks.json` with a simple logging hook
2. Run a task that writes a file → check that the after hook fires
3. Create a blocking before hook → verify tool execution is prevented
4. Check logs for `[hooks]` entries

---

## #6. Hierarchical Context Compaction

**Effort**: ~3 days | **Impact**: Fixes the biggest pain point in long sessions
**Engine**: ALL (especially `/engine glm` and `/engine kimi` with 128k context windows)

### Problem

Current compaction (`contextManager.ts`) compresses the oldest 60% of messages into a flat summary. This loses:
- Tool results with important code/data
- User decisions and architectural choices
- Error messages and their resolutions
- The "shape" of the conversation (what was tried, what worked)

The sliding window (`conversation-manager.ts`) is even worse — it just drops old messages with a one-liner placeholder.

### Design

Replace both systems with a unified 3-tier context manager:

```
┌─────────────────────────────────────────────┐
│  HOT (last 10 messages, full fidelity)      │  ← Current context
│  Target: < 80k tokens                       │
├─────────────────────────────────────────────┤
│  WARM (LLM-summarized, preserves artifacts) │  ← Recent history
│  Target: < 20k tokens                       │
├─────────────────────────────────────────────┤
│  COLD (bullet-point summary)                │  ← Background context
│  Target: < 5k tokens                        │
├─────────────────────────────────────────────┤
│  PINNED (never compacted)                   │  ← Original request + decisions
│  No limit (typically < 2k tokens)           │
└─────────────────────────────────────────────┘
Total budget: ~107k tokens (leaving ~73k for system prompt + tools + response)
```

#### Compaction Triggers

1. **HOT → WARM**: When HOT tier exceeds 80k tokens, move oldest messages (keeping last 10) through LLM summarization
2. **WARM → COLD**: When WARM tier exceeds 20k tokens, condense oldest WARM entries into bullet-point summary
3. **Pinning**: Messages with tool results containing code, user decisions, or error resolutions get pinned

### Files to Create/Modify

#### 1. New file: `apps/api/src/memory/contextTiers.ts`

```typescript
import type { LLMMessage } from '../llm/types.js';
import { getTextContent } from '../llm/types.js';
import { llmRouter } from '../llm/router.js';
import type { LLMProvider } from '../llm/types.js';

// Rough token estimation (4 chars/token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessageTokens(msg: LLMMessage): number {
  let tokens = estimateTokens(getTextContent(msg.content));
  if (msg.toolCalls) {
    for (const tc of msg.toolCalls) {
      tokens += estimateTokens(JSON.stringify(tc.arguments));
    }
  }
  if (msg.toolResults) {
    for (const tr of msg.toolResults) {
      tokens += estimateTokens(tr.result);
    }
  }
  return tokens;
}

export interface TieredMessage extends LLMMessage {
  pinned?: boolean;
  tier: 'hot' | 'warm' | 'cold' | 'pinned';
  originalTokens?: number;
}

interface TierBudgets {
  hot: number;      // Default 80_000
  warm: number;     // Default 20_000
  cold: number;     // Default 5_000
}

const DEFAULT_BUDGETS: TierBudgets = {
  hot: 80_000,
  warm: 20_000,
  cold: 5_000,
};

const HOT_MIN_KEPT = 10; // Always keep at least 10 messages in hot

/**
 * Heuristic: should this message be pinned (never compacted)?
 */
function shouldPin(msg: LLMMessage): boolean {
  const text = getTextContent(msg.content);

  // Pin user decisions / explicit instructions
  if (msg.role === 'user' && text.length > 100) {
    if (/\b(always|never|must|important|requirement|decision|spec)\b/i.test(text)) {
      return true;
    }
  }

  // Pin error resolutions (system messages with fix context)
  if (msg.role === 'system' && text.includes('[ORIGINAL REQUEST')) {
    return true;
  }

  return false;
}

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
  private pinned: TieredMessage[] = [];
  private cold: string = '';     // Bullet-point summary
  private warm: string[] = [];   // Array of summary blocks
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
    if (shouldPin(msg)) {
      this.pinned.push({ ...msg, tier: 'pinned', pinned: true });
    }
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

    // 3. Pinned messages (decisions, original request)
    if (this.pinnedRequest) {
      messages.push({
        role: 'system',
        content: `[ORIGINAL REQUEST — pinned]\n${this.pinnedRequest}`,
      });
    }
    for (const pinned of this.pinned) {
      messages.push({
        role: pinned.role,
        content: pinned.content,
        toolCalls: pinned.toolCalls,
        toolResults: pinned.toolResults,
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
    for (const p of this.pinned) total += estimateMessageTokens(p);
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

    // HOT → WARM: when hot exceeds budget
    if (hotTokens > this.budgets.hot && this.hot.length > HOT_MIN_KEPT) {
      await this.compactHotToWarm(provider);
    }

    // WARM → COLD: when warm exceeds budget
    const warmTokens = this.warm.reduce((sum, s) => sum + estimateTokens(s), 0);
    if (warmTokens > this.budgets.warm) {
      await this.compactWarmToCold(provider);
    }
  }

  private async compactHotToWarm(provider?: LLMProvider): Promise<void> {
    // Move oldest messages from hot, keeping HOT_MIN_KEPT
    const moveCount = this.hot.length - HOT_MIN_KEPT;
    if (moveCount < 2) return;

    const toCompact = this.hot.splice(0, moveCount);

    // Build transcript for summarization
    const transcript = toCompact
      .map((m) => `[${m.role}]: ${getTextContent(m.content)}`)
      .join('\n\n');

    try {
      const response = await llmRouter.generateWithFallback(
        provider ?? 'zai',
        {
          model: 'glm-4.7-flash',
          systemPrompt: WARM_SUMMARY_PROMPT,
          messages: [{ role: 'user', content: transcript }],
          maxTokens: 2048,
        },
      );
      this.warm.push(response.content);
      console.log(`[context-tiers] HOT→WARM: ${moveCount} messages → ${estimateTokens(response.content)} tokens`);
    } catch (err) {
      // Compaction failed — push messages back to hot
      this.hot.unshift(...toCompact);
      console.error('[context-tiers] HOT→WARM compaction failed:', err);
    }
  }

  private async compactWarmToCold(provider?: LLMProvider): Promise<void> {
    // Merge all warm summaries into a brief cold summary
    const allWarm = this.warm.join('\n\n');

    try {
      const response = await llmRouter.generateWithFallback(
        provider ?? 'zai',
        {
          model: 'glm-4.7-flash',
          systemPrompt: COLD_SUMMARY_PROMPT,
          messages: [{ role: 'user', content: `${this.cold ? `Previous overview:\n${this.cold}\n\n` : ''}New summaries:\n${allWarm}` }],
          maxTokens: 1024,
        },
      );
      this.cold = response.content;
      this.warm = []; // Clear warm tier
      console.log(`[context-tiers] WARM→COLD: ${estimateTokens(allWarm)} → ${estimateTokens(this.cold)} tokens`);
    } catch (err) {
      console.error('[context-tiers] WARM→COLD compaction failed:', err);
      // Keep warm as-is
    }
  }

  clear(): void {
    this.hot = [];
    this.warm = [];
    this.cold = '';
    this.pinned = [];
  }
}
```

#### 2. `apps/api/src/agents/chapo-loop/contextManager.ts`

Replace the existing `checkAndCompact()` with delegation to `TieredContextManager`:

This is the largest refactor. The `ChapoLoopContextManager` currently wraps `ConversationManager`. It should instead wrap `TieredContextManager`.

**Migration path**: Keep the existing `ChapoLoopContextManager` interface but swap internals to use `TieredContextManager`. The conversation manager stays for system prompt management only.

#### 3. `apps/api/src/agents/conversation-manager.ts`

The sliding window `trimToTokenBudget()` becomes a safety net only — the tiered manager handles compaction before it. Raise the token budget to 200k (effectively disabling aggressive trimming):

```typescript
constructor(maxTokens: number = 200_000) {
```

### Verification

1. Start a long session (15+ iterations) with `/engine glm`
2. Check logs for `[context-tiers] HOT→WARM` and `WARM→COLD` transitions
3. Verify pinned messages survive compaction (original request, user decisions)
4. Verify token usage stays within budget (~107k total context)
5. Compare answer quality at iteration 15 vs current system

---

## #7. Specialized Sub-Agent Delegation

**Effort**: ~4 days | **Impact**: Enables parallel work, protects parent context from bloat
**Engine**: ALL

### Problem

CHAPO handles everything sequentially in one context window. When a task requires "research X, then implement Y, then verify Z", each phase fills the context with data the next phase doesn't need. This leads to context overflow on complex tasks.

### Design

Add 2 lightweight sub-agent types that CHAPO can delegate to:

| Sub-Agent | Tools Available | Context | Use Case |
|-----------|----------------|---------|----------|
| **research** | fs_readFile, fs_glob, fs_grep, fs_listFiles, web_search, web_fetch | Own (isolated) | "Read these 5 files and tell me how auth works" |
| **bash** | bash_execute only | Own (isolated) | "Run this test suite and report results" |

Sub-agents:
- Share the same LLM router (same engine profile, same fallback chain)
- Get their own `ConversationManager` (isolated context)
- Return a structured summary to the parent CHAPO loop
- Have strict limits: max 10 iterations, 60s timeout, 50k token budget

### Files to Create/Modify

#### 1. New file: `apps/api/src/agents/sub-agent.ts`

```typescript
import { ConversationManager } from './conversation-manager.js';
import { llmRouter } from '../llm/router.js';
import { getToolsForLLM } from '../tools/registry.js';
import type { LLMProvider, GenerateResponse } from '../llm/types.js';
import { getTextContent } from '../llm/types.js';
import { executeToolWithApprovalBridge } from '../actions/approvalBridge.js';
import { buildToolResultContent } from './utils.js';

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
  tokenBudget?: number;
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
  const tokenBudget = config.tokenBudget || 50_000;

  const allowedTools = SUB_AGENT_TOOLS[config.type];
  const allTools = getToolsForLLM().filter((t) => allowedTools.includes(t.name));
  const conversation = new ConversationManager(tokenBudget);

  conversation.setSystemPrompt(SUB_AGENT_PROMPTS[config.type]);
  conversation.addMessage({ role: 'user', content: config.task });

  let tokensUsed = 0;
  const startTime = Date.now();

  for (let i = 0; i < maxIterations; i++) {
    // Timeout check
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
        const content = buildToolResultContent(result);
        toolResults.push({ toolUseId: tc.id, result: content.content, isError: content.isError });
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

#### 2. New tools: `apps/api/src/tools/definitions/delegateTools.ts`

Register two new tools for CHAPO:

```typescript
import type { ToolDefinition, ToolResult } from '../types.js';
import { runSubAgent } from '../../agents/sub-agent.js';
import * as stateManager from '../../agents/stateManager.js';
import type { LLMProvider } from '../../llm/types.js';

export const delegateResearchTool: ToolDefinition = {
  name: 'delegate_research',
  description: 'Delegate a research task to a read-only sub-agent. The sub-agent can read files and search the web, then returns a summary. Use this for tasks like "read these files and summarize how X works" or "search the web for Y".',
  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'What to research. Be specific about what files to read or what to search for.',
      },
    },
    required: ['task'],
  },
  execute: async (args, context): Promise<ToolResult> => {
    const state = stateManager.getState(context.sessionId);
    const engine = state?.taskContext.gatheredInfo.engineProfile as string | undefined;
    const provider = (state?.taskContext.gatheredInfo.provider || 'zai') as LLMProvider;
    const model = state?.taskContext.gatheredInfo.fastModel as string || 'glm-4.7-flash';

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

export const delegateBashTool: ToolDefinition = {
  name: 'delegate_bash',
  description: 'Delegate a bash command or test suite to an isolated sub-agent. The sub-agent runs the command(s) and returns stdout/stderr. Use this for running tests, builds, or other commands where you need the output.',
  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'What to run. Describe the command(s) and what output you need.',
      },
    },
    required: ['task'],
  },
  execute: async (args, context): Promise<ToolResult> => {
    const state = stateManager.getState(context.sessionId);
    const provider = (state?.taskContext.gatheredInfo.provider || 'zai') as LLMProvider;
    const model = state?.taskContext.gatheredInfo.fastModel as string || 'glm-4.7-flash';

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

#### 3. Register tools in registry + agent access

Add `delegate_research` and `delegate_bash` to:
- `apps/api/src/tools/registry.ts` — register in unified registry
- `apps/api/src/agents/router/agentAccess.ts` — add to CHAPO's allowed tool list
- `apps/api/src/tools/toolFilter.ts` — add to a new `delegation` category

#### 4. Update toolFilter.ts

Add delegation category:
```typescript
delegation: ['delegate_research', 'delegate_bash'],
```

And trigger:
```typescript
delegation: /\b(research|investigat|explore|read.{0,10}files|find.{0,10}out|gather|collect|run.{0,10}test|test.{0,10}suite|build|compile)\b/i,
```

### Verification

1. Send "research how the auth system works in this project" → should delegate to research sub-agent
2. Send "run the test suite and tell me what fails" → should delegate to bash sub-agent
3. Verify sub-agent results appear as tool results in the main conversation
4. Verify parent context doesn't get bloated with sub-agent's intermediate steps
5. Check logs for sub-agent iterations and token usage

---

## Implementation Order

| # | Feature | Effort | Dependencies | Status |
|---|---------|--------|-------------|--------|
| **8** | Reflexion Loop | 2 days | None | **DONE** (2026-02-26) |
| **5** | Hooks System | 2 days | None | **DONE** (2026-02-26) |
| **9** | Multi-Model Cost Routing | 1 day | None | **Moved to Tier 5** |
| **6** | Hierarchical Context Compaction | 3 days | None (but benefits from #9 fast model) | **DONE** (2026-02-26) |
| **7** | Sub-Agent Delegation | 4 days | Benefits from #6 (context protection) | **Moved to Tier 5** |

**Tier 2 COMPLETE** (2026-02-26) — 3/5 features implemented, 2 moved to Tier 5.

## Files Summary

| File | Change Type | Feature |
|------|------------|---------|
| `apps/api/src/agents/chapo-loop.ts` | Modify | #9 (model tier), #8 (reflexion hook) |
| `apps/api/src/agents/types.ts` | Modify | #9 (fastModel in ModelSelection) |
| `apps/api/src/llm/modelSelector.ts` | Modify | #9 (pass fastModel through) |
| `apps/api/src/agents/reflexion.ts` | **NEW** | #8 |
| `apps/api/src/hooks/hookConfig.ts` | **NEW** | #5 |
| `apps/api/src/hooks/hookRunner.ts` | **NEW** | #5 |
| `apps/api/src/agents/chapo-loop/toolExecutor.ts` | Modify | #5 (wrap with hooks) |
| `apps/api/src/memory/contextTiers.ts` | **NEW** | #6 |
| `apps/api/src/agents/chapo-loop/contextManager.ts` | Modify | #6 (delegate to tiered) |
| `apps/api/src/agents/conversation-manager.ts` | Modify | #6 (raise budget) |
| `apps/api/src/agents/sub-agent.ts` | **NEW** | #7 |
| `apps/api/src/tools/definitions/delegateTools.ts` | **NEW** | #7 |
| `apps/api/src/tools/registry.ts` | Modify | #7 (register delegate tools) |
| `apps/api/src/agents/router/agentAccess.ts` | Modify | #7 (CHAPO tool access) |
| `apps/api/src/tools/toolFilter.ts` | Modify | #7 (delegation category) |
