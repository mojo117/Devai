# ZAI Provider Integration + Usage-Logging

**Date:** 2026-02-20
**Goal:** Replace Anthropic/OpenAI as primary LLM provider with ZAI GLM models to reduce API costs by 80-95%.

## Motivation

Devai's multi-agent system (CHAPO/DEVO/CAIO/SCOUT) generates 8-25 LLM API calls per user request through delegation chains, self-validation, and retry fallbacks. Current costs are dominated by Opus 4.5 (CHAPO) and Sonnet 4 (DEVO/CAIO).

ZAI's GLM models offer OpenAI-compatible APIs at significantly lower prices, with GLM-4.7-Flash being completely free.

## Pricing Comparison

| Model | Input $/M | Output $/M | Replaces |
|-------|-----------|------------|----------|
| GLM-5 | $1.00 | $3.20 | Opus 4.5 (~$15/$75) |
| GLM-4.7 | $0.60 | $2.20 | Sonnet 4 ($3/$15) |
| GLM-4.7-Flash | FREE | FREE | Haiku ($0.80/$4) |
| GLM-4.5-Flash | FREE | FREE | Alternative |

## Architecture

### Approach: Dedicated ZAI Provider

New `ZAIProvider` class implementing `LLMProviderAdapter`. Uses OpenAI SDK internally with custom `baseURL: https://api.z.ai/api/paas/v4`. Registered as its own provider (`'zai'`) in the LLM router.

ZAI becomes primary in all model tiers, with Anthropic/OpenAI/Gemini as automatic fallbacks.

### Agent Model Mapping

| Agent | Current | New (ZAI Primary) |
|-------|---------|-------------------|
| CHAPO | Opus 4.5 | GLM-5 |
| DEVO | Sonnet 4 | GLM-4.7 |
| CAIO | Sonnet 4 | GLM-4.7 |
| SCOUT | Sonnet 4 / Haiku | GLM-4.7-Flash (FREE) |

### Model Tier Mapping

```
fast:     zai:glm-4.7-flash → gemini:flash → anthropic:haiku
balanced: zai:glm-4.7       → anthropic:sonnet → openai:gpt-4o
powerful: zai:glm-5          → anthropic:opus
```

## Changes

### New Files

1. **`apps/api/src/llm/providers/zai.ts`**
   - Implements `LLMProviderAdapter`
   - Uses `openai` SDK with `baseURL: https://api.z.ai/api/paas/v4`
   - Models: `glm-5`, `glm-4.7`, `glm-4.7-flash`, `glm-4.5-flash`
   - Tool calling: Same format as OpenAI (function type)
   - Reuses OpenAI provider's schema sanitization and tool-name normalization

2. **`apps/api/src/llm/usage-logger.ts`**
   - Logs every LLM call: provider, model, tokens, estimated cost, agent, session
   - Output: JSONL files at `/opt/Devai/var/logs/usage/YYYY-MM-DD.jsonl`
   - Embedded price table for cost calculation
   - Wraps `generateWithFallback()` in router

### Modified Files

3. **`apps/api/src/llm/types.ts`** — Add `'zai'` to `LLMProvider` union type
4. **`apps/api/src/llm/router.ts`** — Register ZAI provider, update fallback chain to `['zai', 'anthropic', 'openai', 'gemini']`, add DEFAULT_MODELS entry, wrap generate with usage logging
5. **`apps/api/src/llm/modelSelector.ts`** — Add GLM models as primary in all tiers
6. **`apps/api/src/config.ts`** — Add `zaiApiKey: process.env.ZAI_API_KEY`
7. **`apps/api/src/agents/chapo.ts`** — Default model → `glm-5`
8. **`apps/api/src/agents/devo.ts`** — Default model → `glm-4.7`
9. **`apps/api/src/agents/caio.ts`** — Default model → `glm-4.7`
10. **`apps/api/src/agents/scout.ts`** — Default model → `glm-4.7-flash`

### Environment (on Clawd `/opt/Devai/.env`)

```
ZAI_API_KEY=<your-zai-api-key>
```

## Usage Logging Format

```json
{"ts":"2026-02-20T14:30:00Z","provider":"zai","model":"glm-5","agent":"chapo","session":"abc123","input":8500,"output":1200,"costUsd":0.012}
```

## Risk & Mitigation

- **GLM-5 reasoning quality**: May be weaker than Opus for complex orchestration. Mitigated by automatic Anthropic fallback in the chain.
- **Tool calling compatibility**: ZAI uses same format as OpenAI, but edge cases may differ. Mitigated by reusing OpenAI provider's normalization logic.
- **Rate limits**: ZAI may have different rate limits. Free-tier models (Flash) may be throttled. Monitor via usage logs.

## Estimated Savings

| Scenario | Before (Anthropic) | After (ZAI) | Savings |
|----------|--------------------|-----------  |---------|
| Simple Q&A | $0.05 | $0.00 (Flash) | 100% |
| Code review | $0.25 | $0.02 | 92% |
| Complex refactor | $2.00 | $0.15 | 92% |
| Multi-agent deploy | $3.00 | $0.25 | 92% |
