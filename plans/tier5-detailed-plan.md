# Tier 5: Cost Optimization & Delegation — Detailed Implementation Plan

> Prerequisite: Tier 2 completed (Reflexion, Hooks, Context Tiers)

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
| **9** | Multi-Model Cost Routing | 1 day | None | Pending |
| **7** | Sub-Agent Delegation | 4 days | Benefits from #6 (context protection, done in Tier 2) | Pending |

Total: ~5 days (2 features)

## Files Summary

| File | Change Type | Feature |
|------|------------|---------|
| `apps/api/src/agents/chapo-loop.ts` | Modify | #9 (model tier selection) |
| `apps/api/src/agents/types.ts` | Modify | #9 (fastModel in ModelSelection) |
| `apps/api/src/llm/modelSelector.ts` | Modify | #9 (pass fastModel through) |
| `apps/api/src/agents/sub-agent.ts` | **NEW** | #7 |
| `apps/api/src/tools/definitions/delegateTools.ts` | **NEW** | #7 |
| `apps/api/src/tools/registry.ts` | Modify | #7 (register delegate tools) |
| `apps/api/src/agents/router/agentAccess.ts` | Modify | #7 (CHAPO tool access) |
| `apps/api/src/tools/toolFilter.ts` | Modify | #7 (delegation category) |
