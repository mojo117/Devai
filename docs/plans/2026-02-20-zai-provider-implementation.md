# ZAI Provider + Usage Logging — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add ZAI (Zhipu AI GLM models) as primary LLM provider with usage logging, reducing API costs by 80-95%.

**Architecture:** Dedicated `ZAIProvider` implementing `LLMProviderAdapter`, reusing the `openai` SDK with custom base URL. Usage logger wraps all LLM calls in the router to track tokens and costs per provider/model/agent.

**Tech Stack:** TypeScript, `openai` SDK (already installed), ZAI OpenAI-compatible API, JSONL file logging.

---

### Task 1: Add `'zai'` to type system

**Files:**
- Modify: `apps/api/src/llm/types.ts:1`
- Modify: `apps/api/src/agents/types.ts:23`

**Step 1: Update `LLMProvider` union type**

In `apps/api/src/llm/types.ts`, line 1, change:

```typescript
// OLD
export type LLMProvider = 'anthropic' | 'openai' | 'gemini';

// NEW
export type LLMProvider = 'anthropic' | 'openai' | 'gemini' | 'zai';
```

**Step 2: Update `LLMProviderName` union type**

In `apps/api/src/agents/types.ts`, line 23, change:

```typescript
// OLD
export type LLMProviderName = 'anthropic' | 'openai' | 'gemini';

// NEW
export type LLMProviderName = 'anthropic' | 'openai' | 'gemini' | 'zai';
```

**Step 3: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add apps/api/src/llm/types.ts apps/api/src/agents/types.ts && git commit -m "feat: add zai to LLM provider type unions"
```

---

### Task 2: Add `zaiApiKey` to config

**Files:**
- Modify: `apps/api/src/config.ts:23-31` (interface) and `apps/api/src/config.ts:85-87` (loadConfig)

**Step 1: Add to Config interface**

In `apps/api/src/config.ts`, after line 30 (`geminiApiKey?: string;`), add:

```typescript
  zaiApiKey?: string;
```

**Step 2: Add to loadConfig()**

In `apps/api/src/config.ts`, after line 87 (`geminiApiKey: process.env.GEMINI_API_KEY,`), add:

```typescript
    zaiApiKey: process.env.ZAI_API_KEY,
```

**Step 3: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add apps/api/src/config.ts && git commit -m "feat: add ZAI_API_KEY to config"
```

---

### Task 3: Create ZAI provider

**Files:**
- Create: `apps/api/src/llm/providers/zai.ts`
- Reference: `apps/api/src/llm/providers/openai.ts` (pattern to follow)

**Step 1: Create `zai.ts`**

This provider follows the exact same pattern as `openai.ts` but uses a different base URL, API key, and model list. It reuses the OpenAI SDK since ZAI's API is OpenAI-compatible.

```typescript
import OpenAI from 'openai';
import { config } from '../../config.js';
import type { LLMProviderAdapter, GenerateRequest, GenerateResponse, ToolDefinition, LLMMessage } from '../types.js';

export class ZAIProvider implements LLMProviderAdapter {
  readonly name = 'zai' as const;
  private client: OpenAI | null = null;

  get isConfigured(): boolean {
    return !!config.zaiApiKey;
  }

  private getClient(): OpenAI {
    if (!this.client) {
      if (!config.zaiApiKey) {
        throw new Error('ZAI_API_KEY is not configured');
      }
      this.client = new OpenAI({
        apiKey: config.zaiApiKey,
        baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      });
    }
    return this.client;
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const client = this.getClient();

    // Build tool name alias map (dots to underscores, same as OpenAI)
    const toolNameToAlias = new Map<string, string>();
    const aliasToToolName = new Map<string, string>();
    if (request.tools) {
      for (const tool of request.tools) {
        const alias = tool.name.replace(/\./g, '_');
        toolNameToAlias.set(tool.name, alias);
        aliasToToolName.set(alias, tool.name);
      }
    }

    const messages: OpenAI.ChatCompletionMessageParam[] = [];

    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }

    for (const m of request.messages) {
      if (m.role === 'system') continue;
      this.convertMessage(m, messages, toolNameToAlias);
    }

    const tools = request.toolsEnabled && request.tools
      ? request.tools.map((tool) => {
          const alias = toolNameToAlias.get(tool.name) || tool.name;
          return this.convertTool(tool, alias);
        })
      : undefined;

    const response = await client.chat.completions.create({
      model: request.model || 'glm-4.7',
      max_tokens: request.maxTokens || 4096,
      messages,
      tools,
    });

    const choice = response.choices[0];
    const message = choice.message;

    const toolCalls: GenerateResponse['toolCalls'] = [];
    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        if (tc.type === 'function') {
          const name = aliasToToolName.get(tc.function.name) || tc.function.name;
          toolCalls.push({
            id: tc.id,
            name,
            arguments: JSON.parse(tc.function.arguments || '{}'),
          });
        }
      }
    }

    return {
      content: message.content || '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: choice.finish_reason === 'tool_calls' ? 'tool_use' :
                    choice.finish_reason === 'length' ? 'max_tokens' : 'stop',
      usage: response.usage ? {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
      } : undefined,
    };
  }

  private convertTool(tool: ToolDefinition, alias?: string): OpenAI.ChatCompletionTool {
    const sanitizedParameters = this.sanitizeJsonSchema({
      type: 'object',
      properties: tool.parameters.properties,
      required: tool.parameters.required,
    });

    return {
      type: 'function',
      function: {
        name: alias || tool.name,
        description: tool.description,
        parameters: sanitizedParameters,
      },
    };
  }

  private sanitizeJsonSchema(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    const schema = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};

    for (const [key, raw] of Object.entries(schema)) {
      if (key === 'properties' && raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const properties = raw as Record<string, unknown>;
        const normalizedProps: Record<string, unknown> = {};
        for (const [propName, propSchema] of Object.entries(properties)) {
          normalizedProps[propName] = this.sanitizeJsonSchema(propSchema);
        }
        out.properties = normalizedProps;
        continue;
      }

      if (key === 'items') {
        out.items = this.sanitizeJsonSchema(raw);
        continue;
      }

      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        out[key] = this.sanitizeJsonSchema(raw);
      } else {
        out[key] = raw;
      }
    }

    if (out.type === 'array' && !out.items) {
      out.items = { type: 'string' };
    }

    return out;
  }

  private convertMessage(
    message: LLMMessage,
    messages: OpenAI.ChatCompletionMessageParam[],
    toolNameToAlias: Map<string, string>
  ): void {
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = message.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: toolNameToAlias.get(tc.name) || tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      }));
      messages.push({
        role: 'assistant',
        content: message.content || null,
        tool_calls: toolCalls,
      });
      return;
    }

    if (message.role === 'user' && message.toolResults?.length) {
      for (const tr of message.toolResults) {
        messages.push({
          role: 'tool',
          tool_call_id: tr.toolUseId,
          content: tr.result,
        });
      }
      return;
    }

    messages.push({
      role: message.role as 'user' | 'assistant',
      content: message.content,
    });
  }

  listModels(): string[] {
    return [
      'glm-5',
      'glm-4.7',
      'glm-4.7-flash',
      'glm-4.5-flash',
      'glm-4.7-flashx',
    ];
  }
}
```

**Step 2: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add apps/api/src/llm/providers/zai.ts && git commit -m "feat: add ZAI provider (GLM models via OpenAI-compatible API)"
```

---

### Task 4: Register ZAI in LLM router

**Files:**
- Modify: `apps/api/src/llm/router.ts`

**Step 1: Add ZAI import**

After line 3 (`import { GeminiProvider } from './providers/gemini.js';`), add:

```typescript
import { ZAIProvider } from './providers/zai.js';
```

**Step 2: Update `DEFAULT_FALLBACK_CHAIN`**

Line 7, change:

```typescript
// OLD
const DEFAULT_FALLBACK_CHAIN: LLMProvider[] = ['anthropic', 'openai', 'gemini'];

// NEW
const DEFAULT_FALLBACK_CHAIN: LLMProvider[] = ['zai', 'anthropic', 'openai', 'gemini'];
```

**Step 3: Update `DEFAULT_MODELS`**

Lines 10-14, change:

```typescript
// OLD
const DEFAULT_MODELS: Record<LLMProvider, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  gemini: 'gemini-2.0-flash',
};

// NEW
const DEFAULT_MODELS: Record<LLMProvider, string> = {
  zai: 'glm-4.7',
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  gemini: 'gemini-2.0-flash',
};
```

**Step 4: Update `isModelForProvider`**

Lines 18-22, add `zai` to the prefixes:

```typescript
// OLD
const providerPrefixes: Record<LLMProvider, string[]> = {
  anthropic: ['claude'],
  openai: ['gpt', 'o1', 'o3'],
  gemini: ['gemini'],
};

// NEW
const providerPrefixes: Record<LLMProvider, string[]> = {
  zai: ['glm'],
  anthropic: ['claude'],
  openai: ['gpt', 'o1', 'o3'],
  gemini: ['gemini'],
};
```

**Step 5: Register ZAI provider in constructor**

Lines 39-45, add ZAI:

```typescript
// After gemini registration, add:
const zai = new ZAIProvider();
this.providers.set('zai', zai);
```

**Step 6: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add apps/api/src/llm/router.ts && git commit -m "feat: register ZAI provider in LLM router with fallback chain"
```

---

### Task 5: Update model tiers in modelSelector

**Files:**
- Modify: `apps/api/src/llm/modelSelector.ts:12-30`

**Step 1: Add GLM models to all tiers**

Replace the `MODEL_TIERS` constant (lines 12-30):

```typescript
// NEW
const MODEL_TIERS: Record<string, ModelTier[]> = {
  fast: [
    { provider: 'zai', model: 'glm-4.7-flash' },               // FREE
    { provider: 'gemini', model: 'gemini-2.0-flash' },
    { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' },
    { provider: 'openai', model: 'gpt-4o-mini' },
  ],
  balanced: [
    { provider: 'zai', model: 'glm-4.7' },                     // $0.60/$2.20
    { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    { provider: 'openai', model: 'gpt-4o' },
    { provider: 'gemini', model: 'gemini-1.5-pro' },
  ],
  powerful: [
    { provider: 'zai', model: 'glm-5' },                       // $1.00/$3.20
    { provider: 'anthropic', model: 'claude-opus-4-5-20251101' },
    { provider: 'anthropic', model: 'claude-opus-4-20250514' },
  ],
};
```

**Step 2: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add apps/api/src/llm/modelSelector.ts && git commit -m "feat: add GLM models as primary in all model tiers"
```

---

### Task 6: Update agent default models

**Files:**
- Modify: `apps/api/src/agents/chapo.ts:15-16`
- Modify: `apps/api/src/agents/devo.ts:16`
- Modify: `apps/api/src/agents/scout.ts:16-17`
- Modify: `apps/api/src/agents/caio.ts:16`

**Step 1: Update CHAPO agent**

In `chapo.ts`, lines 15-16:

```typescript
// OLD
  model: 'claude-opus-4-5-20251101',
  fallbackModel: 'claude-sonnet-4-20250514',

// NEW
  model: 'glm-5',
  fallbackModel: 'claude-opus-4-5-20251101',
```

**Step 2: Update DEVO agent**

In `devo.ts`, line 16:

```typescript
// OLD
  model: 'claude-sonnet-4-20250514',

// NEW
  model: 'glm-4.7',
  fallbackModel: 'claude-sonnet-4-20250514',
```

**Step 3: Update SCOUT agent**

In `scout.ts`, lines 16-17:

```typescript
// OLD
  model: 'claude-sonnet-4-20250514',
  fallbackModel: 'claude-3-5-haiku-20241022',

// NEW
  model: 'glm-4.7-flash',
  fallbackModel: 'claude-sonnet-4-20250514',
```

**Step 4: Update CAIO agent**

In `caio.ts`, line 16:

```typescript
// OLD
  model: 'claude-sonnet-4-20250514',

// NEW
  model: 'glm-4.7',
  fallbackModel: 'claude-sonnet-4-20250514',
```

**Step 5: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add apps/api/src/agents/chapo.ts apps/api/src/agents/devo.ts apps/api/src/agents/scout.ts apps/api/src/agents/caio.ts && git commit -m "feat: set GLM models as primary for all agents with Anthropic fallback"
```

---

### Task 7: Fix hardcoded `'anthropic'` calls in agent router

**Files:**
- Modify: `apps/api/src/agents/router.ts` (lines 510, 606, 773, 1167)

The agent router has 4 places that call `llmRouter.generate('anthropic', ...)` directly, bypassing the fallback chain. These should use `generateWithFallback` with the appropriate agent's provider, so ZAI gets used when available.

**Step 1: Change CHAPO perspective call (line 510)**

```typescript
// OLD
  const response = await llmRouter.generate('anthropic', {
    model: chapo.model,

// NEW
  const response = await llmRouter.generateWithFallback('zai', {
    model: chapo.model,
```

**Step 2: Change DEVO perspective call (line 606)**

```typescript
// OLD
    const response = await llmRouter.generate('anthropic', {
      model: devo.model,

// NEW
    const response = await llmRouter.generateWithFallback('zai', {
      model: devo.model,
```

**Step 3: Change plan synthesis call (line 773)**

```typescript
// OLD
  const response = await llmRouter.generate('anthropic', {
    model: chapo.model,

// NEW
  const response = await llmRouter.generateWithFallback('zai', {
    model: chapo.model,
```

**Step 4: Change SCOUT call (line 1167)**

```typescript
// OLD
    const response = await llmRouter.generate('anthropic', {
      model: scout.model,

// NEW
    const response = await llmRouter.generateWithFallback('zai', {
      model: scout.model,
```

**Step 5: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add apps/api/src/agents/router.ts && git commit -m "fix: replace hardcoded anthropic calls with fallback chain in agent router"
```

---

### Task 8: Create usage logger

**Files:**
- Create: `apps/api/src/llm/usage-logger.ts`

**Step 1: Create usage logger**

```typescript
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

interface UsageEntry {
  ts: string;
  provider: string;
  model: string;
  agent?: string;
  session?: string;
  input: number;
  output: number;
  costUsd: number;
}

// Prices per million tokens (input/output)
const PRICES: Record<string, [number, number]> = {
  // ZAI
  'glm-5':          [1.00, 3.20],
  'glm-4.7':        [0.60, 2.20],
  'glm-4.7-flash':  [0, 0],
  'glm-4.7-flashx': [0.07, 0.40],
  'glm-4.5-flash':  [0, 0],
  // Anthropic
  'claude-opus-4-5-20251101':  [15, 75],
  'claude-opus-4-20250514':    [15, 75],
  'claude-sonnet-4-20250514':  [3, 15],
  'claude-3-5-haiku-20241022': [0.80, 4],
  // OpenAI
  'gpt-4o':      [2.50, 10],
  'gpt-4o-mini': [0.15, 0.60],
  // Gemini
  'gemini-2.0-flash': [0.10, 0.40],
  'gemini-1.5-pro':   [1.25, 5],
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const prices = PRICES[model];
  if (!prices) return 0;
  return (inputTokens / 1_000_000) * prices[0] + (outputTokens / 1_000_000) * prices[1];
}

const LOG_DIR = '/opt/Devai/var/logs/usage';

function getLogPath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return resolve(LOG_DIR, `${date}.jsonl`);
}

export function logUsage(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  agent?: string,
  session?: string
): void {
  try {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }

    const entry: UsageEntry = {
      ts: new Date().toISOString(),
      provider,
      model,
      agent,
      session,
      input: inputTokens,
      output: outputTokens,
      costUsd: estimateCost(model, inputTokens, outputTokens),
    };

    appendFileSync(getLogPath(), JSON.stringify(entry) + '\n');
  } catch {
    // Logging must never break the main flow
  }
}
```

**Step 2: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add apps/api/src/llm/usage-logger.ts && git commit -m "feat: add JSONL usage logger with cost estimation per model"
```

---

### Task 9: Integrate usage logging into LLM router

**Files:**
- Modify: `apps/api/src/llm/router.ts`

**Step 1: Add import**

At top of file, add:

```typescript
import { logUsage } from './usage-logger.js';
```

**Step 2: Add logging after successful generate calls**

In the `generate()` method (line 74), wrap the return:

```typescript
// OLD (line 74)
    return provider.generate(request);

// NEW
    const response = await provider.generate(request);
    if (response.usage) {
      logUsage(providerName, request.model || 'unknown', response.usage.inputTokens, response.usage.outputTokens);
    }
    return response;
```

**Step 3: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add apps/api/src/llm/router.ts && git commit -m "feat: integrate usage logging into LLM router generate()"
```

---

### Task 10: Set ZAI API key on Clawd and test

**Files:**
- Modify: `/opt/Devai/.env` on Clawd (via SSH)

**Step 1: Add ZAI_API_KEY to .env on Clawd**

```bash
ssh root@10.0.0.5 "echo 'ZAI_API_KEY=f567441bc30f481c9e465f78bfcb7019.irsviVrey2QGeebg' >> /opt/Devai/.env"
```

**Step 2: Restart API server**

```bash
ssh root@10.0.0.5 "pm2 restart devai-api-dev"
```

**Step 3: Wait for Mutagen sync + server restart (~5s)**

```bash
sleep 5
```

**Step 4: Verify API health**

```bash
curl -s https://devai.klyde.tech/api/health | jq
```

Expected: `{ "status": "ok" }` or similar health response.

**Step 5: Test with a simple request via curl**

Send a test message to the Devai API and check logs to verify ZAI is being used:

```bash
ssh root@10.0.0.5 "pm2 logs devai-api-dev --lines 20 --nostream"
```

Look for `[llm]` log lines showing `zai` as the provider.

**Step 6: Check usage log was created**

```bash
ssh root@10.0.0.5 "ls -la /opt/Devai/var/logs/usage/ && cat /opt/Devai/var/logs/usage/$(date +%Y-%m-%d).jsonl"
```

**Step 7: Commit and push**

```bash
cd /opt/Klyde/projects/Devai && git push origin dev
```

---

## Summary of all changes

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `apps/api/src/llm/types.ts` | Modify | Add `'zai'` to `LLMProvider` |
| 2 | `apps/api/src/agents/types.ts` | Modify | Add `'zai'` to `LLMProviderName` |
| 3 | `apps/api/src/config.ts` | Modify | Add `zaiApiKey` config |
| 4 | `apps/api/src/llm/providers/zai.ts` | Create | ZAI provider (OpenAI SDK + custom baseURL) |
| 5 | `apps/api/src/llm/router.ts` | Modify | Register ZAI, update fallback chain, add usage logging |
| 6 | `apps/api/src/llm/modelSelector.ts` | Modify | Add GLM models as primary in all tiers |
| 7 | `apps/api/src/agents/chapo.ts` | Modify | Model → `glm-5` |
| 8 | `apps/api/src/agents/devo.ts` | Modify | Model → `glm-4.7` |
| 9 | `apps/api/src/agents/scout.ts` | Modify | Model → `glm-4.7-flash` |
| 10 | `apps/api/src/agents/caio.ts` | Modify | Model → `glm-4.7` |
| 11 | `apps/api/src/agents/router.ts` | Modify | Replace 4 hardcoded `'anthropic'` calls with fallback |
| 12 | `apps/api/src/llm/usage-logger.ts` | Create | JSONL usage logger with cost estimation |
| 13 | Clawd `.env` | Modify | Add `ZAI_API_KEY` |
