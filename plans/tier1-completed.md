# Tier 1: Quick Wins — COMPLETED

> Implemented 2025-02-26 | Branch: `feature/single-agent`

## Overview

4 quick wins from competitive research, all compiled cleanly and deployed.

---

## #1. Tool RAG — Dynamic Tool Filtering

**Engine**: ALL | **Impact**: 40-50% fewer tool tokens per LLM call

### Problem
DevAI passed all ~80 tools on every LLM call regardless of what the user asked. This wastes tokens and can confuse the model's tool selection.

### Solution
Keyword-based tool category filtering. Tools grouped into 10 categories (filesystem, git, devops, web, context, memory, scheduler, taskforge, communication, skills). Regex patterns match user message + recent conversation context to select relevant categories.

### Files Changed

| File | Change |
|------|--------|
| `apps/api/src/tools/toolFilter.ts` | **NEW** — `filterToolsForQuery()` with 10 categories, regex triggers, safe fallbacks |
| `apps/api/src/agents/chapo-loop.ts` | Import + use `filterToolsForQuery()` before each LLM call (line ~337) |

### Key Design Decisions

- **Always include**: Meta-tools (`askUser`, `respondToUser`, `requestApproval`, `chapo_plan_set`, `show_in_preview`, `search_files`, `todoWrite`) + all filesystem tools
- **Safe fallback**: Returns ALL tools when no categories match OR when filtering would leave < 15 tools
- **Per-iteration**: Filters on every iteration using `userText` + last 3 messages as context (not just first turn)
- **German keywords**: Triggers include German terms (`datei`, `ordner`, `fehler`, `recherche`, etc.)

### Code

```typescript
// chapo-loop.ts (inside loop, before LLM call)
const recentContext = this.conversation.getMessages().slice(-3).map((m) => getTextContent(m.content)).join(' ');
const tools = filterToolsForQuery(allTools, userText, recentContext);
```

---

## #2. Kimi Tool Call ID Normalization

**Engine**: `/engine kimi` (model: `kimi-k2.5`) | **Impact**: Fixes fallback failures at high conversation depth

### Problem
When Kimi is a fallback provider (not primary), tool call IDs from other providers (`toolu_xxx` from Anthropic, `call_xxx` from GLM) confuse Kimi at high conversation depth (observed at index 28/31).

### Solution
Normalize all tool call IDs to `call_{idx}_{toolAlias}` format when converting messages for Kimi. Track original→normalized mapping so tool results reference the correct IDs.

### Files Changed

| File | Change |
|------|--------|
| `apps/api/src/llm/providers/moonshot.ts` | Added `toolCallIdMap`, `normalizeToolCallId()`, clear map per `generate()` |

### Key Design Decisions

- **Preserve native IDs**: If ID already starts with `call_`, keep as-is (Kimi-native)
- **Map tracking**: `toolCallIdMap = new Map<string, string>()` maps original→normalized, cleared at start of each `generate()`
- **Order-safe**: Assistant messages (with tool_calls) always processed before user messages (with tool_results), so the map is populated before it's needed

### Code

```typescript
// moonshot.ts
private toolCallIdMap = new Map<string, string>();

private normalizeToolCallId(originalId: string, toolAlias: string, idx: number): string {
  if (originalId.startsWith('call_')) return originalId;
  const normalized = `call_${idx}_${toolAlias}`;
  this.toolCallIdMap.set(originalId, normalized);
  return normalized;
}

// In convertMessage() — assistant branch:
const normalizedId = this.normalizeToolCallId(tc.id, alias, idx);

// In convertMessage() — tool results branch:
tool_call_id: this.toolCallIdMap.get(tr.toolUseId) || tr.toolUseId,
```

---

## #3. GLM-5 Selective Thinking Mode

**Engine**: `/engine glm` (model: `glm-5`) | **Impact**: Better reasoning on complex tasks, no overhead on simple ones

### Problem
GLM-5 supports per-turn thinking mode (`enable_thinking: true`) that enables extended reasoning. But it adds latency. Simple tasks (file reads, status checks) don't benefit from it.

### Solution
Heuristic-based thinking mode activation. Only enables on first iteration (planning phase) when the user's message contains complex task keywords or is longer than 500 chars.

### Files Changed

| File | Change |
|------|--------|
| `apps/api/src/llm/types.ts` | Added `thinkingEnabled?: boolean` to `GenerateRequest`, `cachedTokens?: number` to usage |
| `apps/api/src/llm/providers/zai.ts` | Added `enable_thinking` param, `reasoning_content` capture + round-trip |
| `apps/api/src/agents/chapo-loop.ts` | Added `shouldEnableThinking()` heuristic, passes flag to `generateWithFallback` |

### Heuristic

```typescript
function shouldEnableThinking(userMessage: string, iteration: number): boolean {
  if (iteration > 0) return false;
  const complexPattern = /\b(debug|fix|refactor|plan|architect|design|why|how|analy[sz]|investigat|review|explain|compar|evaluat|warum|wieso|erkl[aä]r|vergleich|untersu|fehler|problem)\b/i;
  if (complexPattern.test(userMessage)) return true;
  if (userMessage.length > 500) return true;
  return false;
}
```

### Reasoning Content Round-Trip

When thinking is enabled, GLM-5 returns `reasoning_content` alongside the response. This must be preserved and re-injected on subsequent requests (same pattern Kimi uses):

1. **Capture**: `zai.ts` reads `message.reasoning_content` from response
2. **Store**: Saved in `toolCall.providerMetadata.reasoning_content`
3. **Re-inject**: `convertMessage()` reads from `providerMetadata`, sets `assistantMsg.reasoning_content`

---

## #4. GLM-5 Context Caching Detection

**Engine**: `/engine glm` (model: `glm-5`) | **Impact**: Visibility into whether ZAI caches system prompt + tools

### Problem
The system prompt + tool definitions are identical across turns. ZAI's API may cache them automatically (server-side), but we had no visibility.

### Solution
Log `prompt_tokens_details.cached_tokens` from the ZAI API response if available. Added `cachedTokens` field to `GenerateResponse.usage`.

### Files Changed

| File | Change |
|------|--------|
| `apps/api/src/llm/types.ts` | Added `cachedTokens?: number` to `GenerateResponse.usage` |
| `apps/api/src/llm/providers/zai.ts` | Parse `prompt_tokens_details.cached_tokens`, log when active |

### Code

```typescript
// zai.ts — in usage parsing
const details = (response.usage as unknown as Record<string, unknown>).prompt_tokens_details as Record<string, number> | undefined;
if (details?.cached_tokens) {
  console.log(`[zai] Context caching active: ${details.cached_tokens} cached tokens`);
  return { cachedTokens: details.cached_tokens };
}
```

---

## TypeScript Fixes

After implementation, 6 TypeScript errors were fixed — all `as X` casts that needed `as unknown as X` for OpenAI SDK type compatibility:

| File | Line | Fix |
|------|------|-----|
| `moonshot.ts` | 75 | `message as Record<...>` → `message as unknown as Record<...>` |
| `moonshot.ts` | 189 | `assistantMsg as ChatCompletionMessageParam` → `as unknown as ...` |
| `zai.ts` | 83 | `createParams as ChatCompletionCreateParamsNonStreaming` → `as unknown as ...` |
| `zai.ts` | 90 | Same pattern for message cast |
| `zai.ts` | 119 | Same for `response.usage` cast |
| `zai.ts` | 214 | Same for assistantMsg push |
