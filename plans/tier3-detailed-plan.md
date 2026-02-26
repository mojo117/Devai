# Tier 3: Larger Efforts, Transformative — Detailed Implementation Plan

> Prerequisite: Tier 1 completed, Tier 2 recommended (especially #6 Context Compaction and #7 Sub-Agents)
>
> **#11 (Plan Mode) and #12 (Sandbox)** moved to [Tier 5 (Deferred)](./tier5-deferred-plan.md).

---

## #10. Architect/Editor Split Pattern — DETAILED IMPLEMENTATION PLAN

**Effort**: ~5 days | **Impact**: Reduces hallucination in code generation
**Engine**: ALL (primary benefit: `/engine glm` and `/engine kimi` where hallucination is more common)

### Problem

CHAPO uses a single model for both reasoning ("what needs to change?") and code generation ("write the code"). This leads to hallucination — the model invents file paths, generates wrong function signatures, or writes code that doesn't match the existing codebase. Claude Code's approach separates planning from execution. Aider's architect/editor pattern takes this further.

### Design Overview

Split file-editing tool calls into a 2-pass pipeline:

```
CHAPO calls fs_writeFile or fs_edit
                    │
         ┌──────────▼──────────────────┐
         │  toolExecutor.ts intercept   │  ← Checks architectMode flag
         └──────────┬──────────────────┘
                    │
    ┌───────────────▼───────────────────┐
    │  ARCHITECT PASS (primary model)   │  ← Same model CHAPO uses
    │  Input: tool args + file content  │
    │  Output: Structured EditPlan JSON │
    │  Cost: ~500 tokens (no code gen)  │
    └───────────────┬───────────────────┘
                    │
    ┌───────────────▼───────────────────┐
    │  EDITOR PASS (fast model)         │  ← glm-4.7-flash (all engines)
    │  Input: EditPlan + existing code  │
    │  Output: Final code content       │
    │  Cost: ~1000 tokens               │
    └───────────────┬───────────────────┘
                    │
    ┌───────────────▼───────────────────┐
    │  Optional: REVIEW (primary model) │  ← Only for fs_writeFile (new files)
    │  Input: Generated code + plan     │
    │  Output: APPROVED / ISSUES: ...   │
    │  Cost: ~256 tokens                │
    └───────────────┬───────────────────┘
                    │
         ┌──────────▼──────────────────┐
         │  Execute tool with refined   │  ← Original tool runs with
         │  content from editor         │    architect-improved content
         └─────────────────────────────┘
```

**Only intercepts**: `fs_writeFile` and `fs_edit`. All other tools pass through unchanged.

**Key insight**: The architect doesn't generate code — it produces a structured plan describing *what* to change. The fast model (cheap, fast) generates the actual code from the plan. This separation means the expensive primary model only reasons, while the cheap model handles the mechanical code generation.

### Existing Pattern: reflexion.ts

The implementation follows the exact same pattern as `reflexion.ts` (already in production):

```typescript
// reflexion.ts pattern:
const response = await llmRouter.generateWithFallback(provider, {
  model: fastModel || 'glm-4.7-flash',
  messages: [{ role: 'user', content: '...' }],
  systemPrompt: REFLEXION_PROMPT,
  maxTokens: 256,
});
```

The architect/editor module will make 2-3 of these lightweight LLM calls per intercepted tool call.

---

### Implementation Step 1: Types & Interfaces

**File**: `apps/api/src/agents/architectEditor.ts` — NEW (~180 lines)

```typescript
import { llmRouter } from '../llm/router.js';
import type { LLMProvider } from '../llm/types.js';
import { readFile } from 'fs/promises';

// ============================================
// TYPES
// ============================================

export interface ArchitectEditorConfig {
  provider: LLMProvider;
  primaryModel: string;       // Architect + Review model (e.g. 'glm-5')
  fastModel: string;          // Editor model (e.g. 'glm-4.7-flash')
  enableReview?: boolean;     // Default: true for fs_writeFile, false for fs_edit
}

interface EditPlan {
  file: string;
  action: 'create' | 'edit' | 'replace_section';
  description: string;
  existingCode: string;
  changes: Array<{
    location: string;         // "after function X" / "line 45-60" / "replace method Y"
    description: string;      // Natural language: what to change
    constraints: string[];    // "must use async/await", "preserve error handling"
  }>;
  imports: string[];          // Required imports to add/keep
  preserveSections: string[]; // Code sections that must NOT be touched
}

export interface EditRequest {
  toolName: 'fs_writeFile' | 'fs_edit';
  args: Record<string, unknown>;
}

export interface EditResult {
  /** Refined content to use instead of CHAPO's original */
  content: string;
  /** Whether the review pass approved (always true if review disabled) */
  approved: boolean;
  /** The architect's structured plan (for logging/debugging) */
  architectPlan: string;
  /** Whether architect/editor was actually used (false = passthrough) */
  wasIntercepted: boolean;
}
```

### Implementation Step 2: Prompts

```typescript
// ============================================
// PROMPTS
// ============================================

const ARCHITECT_PROMPT = `You are a code architect reviewing a file edit request.
Your job is to create a STRUCTURED PLAN for the changes — NOT to write code.

Given the requested edit and the existing file content, output a JSON EditPlan:
{
  "file": "path/to/file.ts",
  "action": "create" | "edit" | "replace_section",
  "description": "What this edit accomplishes",
  "existingCode": "relevant existing code that the editor needs to see",
  "changes": [
    {
      "location": "after the import block" | "replace function handleAuth" | "line 45-60",
      "description": "Add try/catch around the database call",
      "constraints": ["must use async/await", "keep existing return type"]
    }
  ],
  "imports": ["import { z } from 'zod'"],
  "preserveSections": ["the existing error handler at line 20-30"]
}

Rules:
- Be PRECISE about locations (function names, line ranges, landmarks)
- List ALL constraints the editor must respect
- Include relevant existing code so the editor can match the style
- Do NOT write any actual code
- Output ONLY the JSON, no markdown fences`;

const EDITOR_PROMPT = `You are a code editor. Given a structured edit plan from an architect, generate the actual code.

Rules:
- Follow the plan EXACTLY — do not add features not in the plan
- Respect ALL constraints listed in the plan
- Match the existing code style (indentation, naming, patterns)
- Preserve all sections marked in preserveSections
- Include all imports listed in the plan
- Output ONLY the final code content — no explanations, no markdown fences`;

const REVIEW_PROMPT = `You are a code reviewer. An architect created a plan and an editor generated code from it.

Check:
1. Does the code match the plan's description?
2. Are all constraints from the plan respected?
3. Are preserved sections intact?
4. Are there obvious bugs or type errors?

If acceptable: respond with exactly APPROVED
If issues found: respond with ISSUES: <brief description>

Be strict on plan adherence but don't flag style nitpicks.`;
```

### Implementation Step 3: Core Pipeline

```typescript
// ============================================
// CORE PIPELINE
// ============================================

/**
 * Run the architect/editor pipeline on a file-editing tool call.
 *
 * Returns refined content that replaces CHAPO's original tool call content.
 * On any failure, returns the original content unchanged (graceful degradation).
 */
export async function architectEdit(
  request: EditRequest,
  config: ArchitectEditorConfig,
): Promise<EditResult> {
  const { toolName, args } = request;
  const filePath = args.path as string;
  const originalContent = args.content as string;

  // Skip for very small edits (< 50 chars) — not worth the overhead
  if (originalContent && originalContent.length < 50) {
    return passthrough(originalContent);
  }

  // Read existing file content for context (if editing, not creating)
  let existingContent = '';
  if (toolName === 'fs_edit') {
    try {
      existingContent = await readFile(filePath, 'utf-8');
    } catch {
      // New file or unreadable — proceed without context
    }
  }

  // --- PASS 1: ARCHITECT (primary model) ---
  let architectPlan: string;
  try {
    const architectResponse = await llmRouter.generateWithFallback(config.provider, {
      model: config.primaryModel,
      messages: [{
        role: 'user',
        content: buildArchitectInput(toolName, filePath, originalContent, existingContent),
      }],
      systemPrompt: ARCHITECT_PROMPT,
      maxTokens: 1024,
    });
    architectPlan = architectResponse.content.trim();

    // Validate it's parseable JSON
    JSON.parse(architectPlan);
  } catch (err) {
    console.warn('[architect-editor] Architect pass failed, using original content:', err);
    return passthrough(originalContent);
  }

  // --- PASS 2: EDITOR (fast model) ---
  let editorContent: string;
  try {
    const editorResponse = await llmRouter.generateWithFallback(config.provider, {
      model: config.fastModel,
      messages: [{
        role: 'user',
        content: buildEditorInput(architectPlan, existingContent, toolName),
      }],
      systemPrompt: EDITOR_PROMPT,
      maxTokens: 4096,
    });
    editorContent = editorResponse.content.trim();

    // Strip markdown code fences if the model wrapped the output
    editorContent = stripCodeFences(editorContent);
  } catch (err) {
    console.warn('[architect-editor] Editor pass failed, using original content:', err);
    return passthrough(originalContent);
  }

  // --- PASS 3: REVIEW (primary model, optional) ---
  const shouldReview = config.enableReview ?? (toolName === 'fs_writeFile');
  let approved = true;

  if (shouldReview) {
    try {
      const reviewResponse = await llmRouter.generateWithFallback(config.provider, {
        model: config.primaryModel,
        messages: [{
          role: 'user',
          content: `Architect plan:\n${architectPlan}\n\nGenerated code:\n${editorContent.slice(0, 3000)}`,
        }],
        systemPrompt: REVIEW_PROMPT,
        maxTokens: 256,
      });
      const reviewText = reviewResponse.content.trim();
      approved = reviewText.startsWith('APPROVED');

      if (!approved) {
        console.log(`[architect-editor] Review rejected: ${reviewText.slice(0, 200)}`);
        // On rejection, fall back to original content rather than blocking
        return passthrough(originalContent, architectPlan);
      }
    } catch {
      // Review failed — approve by default (same as reflexion.ts pattern)
      console.warn('[architect-editor] Review pass failed, approving by default');
    }
  }

  console.log(`[architect-editor] Pipeline complete for ${filePath} (${toolName}): plan=${architectPlan.length}b, output=${editorContent.length}b, reviewed=${shouldReview}, approved=${approved}`);

  return {
    content: editorContent,
    approved,
    architectPlan,
    wasIntercepted: true,
  };
}

// ============================================
// HELPERS
// ============================================

function passthrough(originalContent: string, plan?: string): EditResult {
  return {
    content: originalContent,
    approved: true,
    architectPlan: plan || '',
    wasIntercepted: false,
  };
}

function buildArchitectInput(
  toolName: string,
  filePath: string,
  requestedContent: string,
  existingContent: string,
): string {
  const parts = [
    `Tool: ${toolName}`,
    `File: ${filePath}`,
  ];
  if (existingContent) {
    parts.push(`Existing file content:\n${existingContent.slice(0, 6000)}`);
  }
  parts.push(`Requested content/edit:\n${requestedContent.slice(0, 4000)}`);
  return parts.join('\n\n');
}

function buildEditorInput(
  architectPlan: string,
  existingContent: string,
  toolName: string,
): string {
  const parts = [`Edit plan from architect:\n${architectPlan}`];
  if (existingContent && toolName === 'fs_edit') {
    parts.push(`Current file content:\n${existingContent.slice(0, 6000)}`);
  }
  parts.push('Generate the complete code output now.');
  return parts.join('\n\n');
}

function stripCodeFences(content: string): string {
  // Remove ```typescript ... ``` or ```ts ... ``` wrappers
  const fenceMatch = content.match(/^```(?:typescript|ts|javascript|js)?\n([\s\S]*?)```$/);
  return fenceMatch ? fenceMatch[1].trim() : content;
}
```

---

### Implementation Step 4: toolExecutor.ts Integration

**File**: `apps/api/src/agents/chapo-loop/toolExecutor.ts` — MODIFY

Add `architectConfig` to `ToolExecutorDeps` interface:

```typescript
// Add to ToolExecutorDeps interface (line ~35):
import type { ArchitectEditorConfig, EditResult } from '../architectEditor.js';

interface ToolExecutorDeps {
  // ... existing fields ...
  architectConfig?: ArchitectEditorConfig;  // NEW — undefined = disabled
}
```

Intercept point — add BEFORE the `runHooks('before:tool', ...)` call (line ~270):

```typescript
// --- ARCHITECT/EDITOR INTERCEPT ---
// Refine file-editing tool calls through the architect/editor pipeline
if (
  (toolCall.name === 'fs_writeFile' || toolCall.name === 'fs_edit') &&
  this.deps.architectConfig &&
  toolCall.arguments.content  // Only intercept when content is provided
) {
  try {
    const { architectEdit } = await import('../architectEditor.js');
    const editResult = await architectEdit(
      { toolName: toolCall.name as 'fs_writeFile' | 'fs_edit', args: toolCall.arguments },
      this.deps.architectConfig,
    );

    if (editResult.wasIntercepted && editResult.approved) {
      // Replace content with architect-refined version
      toolCall.arguments = { ...toolCall.arguments, content: editResult.content };
      console.log(`[architect-editor] Refined ${toolCall.name} for ${toolCall.arguments.path}`);
    }
    // If not intercepted or not approved, original content passes through
  } catch (err) {
    // Graceful degradation: if the pipeline crashes, proceed with original content
    console.warn('[architect-editor] Pipeline error, proceeding with original:', err);
  }
}
// --- END ARCHITECT/EDITOR INTERCEPT ---
```

**Exact insertion point**: Between the `requestApproval` handler (line 268) and the `runHooks('before:tool', ...)` call (line 271).

---

### Implementation Step 5: chapo-loop.ts — Pass Config to ToolExecutor

**File**: `apps/api/src/agents/chapo-loop.ts` — MODIFY

In `runLoop()`, where `ChapoToolExecutor` is instantiated (~line 450):

```typescript
// Resolve architect config from engine profile
import { getEngineProfile, type EngineName } from '../llm/engineProfiles.js';
import type { ArchitectEditorConfig } from './architectEditor.js';

// Inside runLoop(), before the tool execution loop:
const engineName = stateManager.getState(this.sessionId)
  ?.taskContext.gatheredInfo.engineProfile as EngineName | undefined;
const engineProfile = engineName ? getEngineProfile(engineName) : null;
const architectMode = engineProfile?.chapo?.architectMode ?? false;

const architectConfig: ArchitectEditorConfig | undefined = architectMode
  ? {
      provider,
      primaryModel: model,
      fastModel: engineProfile?.chapo?.fastModel || 'glm-4.7-flash',
    }
  : undefined;

// Modify ChapoToolExecutor instantiation:
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
  architectConfig,          // NEW
});
```

**Note**: `architectConfig` is `undefined` when architect mode is off, so the toolExecutor intercept is a no-op. Zero overhead for engines that don't use it.

---

### Implementation Step 6: engineProfiles.ts — Add architectMode Flag

**File**: `apps/api/src/llm/engineProfiles.ts` — MODIFY

```typescript
export interface AgentModelOverride {
  model: string;
  fastModel?: string;
  fallbackModel?: string;
  sameProviderFallback?: string;
  architectMode?: boolean;       // NEW: enable architect/editor split
}

export const ENGINE_PROFILES: Record<EngineName, EngineProfile> = {
  glm: {
    chapo: {
      model: 'glm-5',
      fastModel: 'glm-4.7-flash',
      fallbackModel: 'claude-opus-4-5-20251101',
      sameProviderFallback: 'glm-4.7',
      architectMode: true,         // On by default — GLM-5 benefits most
    },
  },
  gemini: {
    chapo: {
      model: 'gemini-3.1-pro-preview',
      fastModel: 'glm-4.7-flash',
      fallbackModel: 'glm-5',
      architectMode: true,         // On by default
    },
  },
  claude: {
    chapo: {
      model: 'claude-opus-4-5-20251101',
      fastModel: 'glm-4.7-flash',
      fallbackModel: 'glm-5',
      architectMode: false,        // Off — Claude is reliable at both
    },
  },
  kimi: {
    chapo: {
      model: 'kimi-k2.5',
      fastModel: 'glm-4.7-flash',
      fallbackModel: 'glm-5',
      sameProviderFallback: 'glm-4.7',
      architectMode: true,         // On by default — Kimi benefits
    },
  },
};
```

---

### Implementation Step 7: Stream Events for Debugging

Add an optional `architect_editor` event type to `AgentStreamEvent` in `types.ts`:

```typescript
// Add to AgentStreamEvent union:
| { type: 'architect_editor'; phase: 'architect' | 'editor' | 'review'; file: string; status: 'start' | 'complete' | 'skip' }
```

Emit from `architectEdit()`:
```typescript
// This is optional but useful for frontend debugging.
// The sendEvent function can be passed via config if needed.
```

---

### Engine Mapping

| Engine | architectMode | Primary (Architect) | Fast (Editor) | Review |
|--------|:------------:|--------------------:|:-------------:|:------:|
| `/engine glm` | **On** | `glm-5` | `glm-4.7-flash` | fs_writeFile only |
| `/engine kimi` | **On** | `kimi-k2.5` | `glm-4.7-flash` | fs_writeFile only |
| `/engine claude` | Off | — | — | — |
| `/engine gemini` | **On** | `gemini-3.1-pro` | `glm-4.7-flash` | fs_writeFile only |

**Cost impact**: For a typical `fs_edit` call (~1000 token content):
- Without architect: 0 extra LLM calls
- With architect: +2 LLM calls (architect ~500 tok + editor ~1000 tok) ≈ +0.002 CNY on GLM
- With review: +3 LLM calls (+256 tok review) ≈ +0.003 CNY on GLM

The fast model (glm-4.7-flash) is essentially free. The primary model call for the architect pass adds minimal cost since the output is short JSON, not full code.

---

### Implementation Order (Day-by-Day)

| Day | Task | Files |
|-----|------|-------|
| **1** | Create `architectEditor.ts` with types, prompts, and `architectEdit()` function. Follow `reflexion.ts` pattern exactly. | `architectEditor.ts` (NEW) |
| **2** | Add `architectConfig` to `ToolExecutorDeps`, add intercept before hooks in `toolExecutor.ts` | `toolExecutor.ts` (MODIFY) |
| **3** | Wire config through `chapo-loop.ts` → `ChapoToolExecutor`, add `architectMode` to `engineProfiles.ts` | `chapo-loop.ts`, `engineProfiles.ts` (MODIFY) |
| **4** | Test with all 4 engines. Verify: (a) glm/kimi/gemini intercept, (b) claude passes through, (c) graceful degradation on failure | Manual testing |
| **5** | Add stream events, tune prompts based on testing, add `/architect` toggle command | `types.ts`, command handler |

### Verification

1. Enable architect mode (`/engine glm`), ask "create a new utility function for date formatting"
   - Check logs: should see `[architect-editor] Pipeline complete` with plan length + output length
   - Verify generated code matches the plan's constraints

2. Compare quality: same prompt with architect ON vs OFF
   - Expected: fewer hallucinated imports, better function signatures, matching code style

3. Test graceful degradation:
   - Kill the fast model endpoint → architect pass should succeed, editor pass fails → original content used
   - Send a very small edit (< 50 chars) → should skip pipeline entirely

4. Test with `/engine claude` → verify architect is NOT triggered (architectMode: false)

5. Performance: measure added latency per `fs_edit` call
   - Target: < 2s additional latency (architect ~500ms + editor ~800ms on GLM)

### Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Architect produces unparseable JSON | `JSON.parse()` in try/catch → falls back to original content |
| Editor ignores the plan | Review pass catches this; on rejection → original content |
| Added latency slows down CHAPO | Only fires on `fs_writeFile`/`fs_edit`, not on reads/bash/git |
| Fast model unavailable | `llmRouter.generateWithFallback` handles provider fallback automatically |
| Pipeline increases token cost | Fast model is ~10x cheaper; architect output is short JSON |

---

## #13. Kimi K2.5 Swarm Mode — IMPLEMENTED

**Effort**: ~2 days | **Impact**: Better task decomposition on `/engine kimi`
**Engine**: `/engine kimi` only

### Problem

Kimi K2.5 has built-in multi-turn reasoning and task decomposition capabilities via API parameters (`use_search`, extended thinking). DevAI doesn't leverage these Kimi-native features.

### Current State

`moonshot.ts` already handles:
- `reasoning_content` round-trip (from Tier 1 thinking mode)
- Tool call ID normalization (Tier 1)
- Tool name aliasing (dots → underscores)

But it doesn't use Kimi-specific API parameters.

### Design

Add optional Kimi-native parameters when using `/engine kimi`:

```typescript
// Additional params for Kimi K2.5:
{
  use_search: true,              // Enable Kimi's built-in web search
  n: 1,                          // Single response
  // When thinking is enabled:
  thinking: {
    type: 'enabled',
    budget_tokens: 8192,         // Cap thinking tokens
  },
}
```

### Files to Modify

#### 1. `apps/api/src/llm/providers/moonshot.ts`

Add Kimi-specific parameters to `generate()`:

```typescript
// In generate(), before the API call (~line 63):
const model = request.model || 'kimi-k2.5';

const createParams: Record<string, unknown> = {
  model,
  max_tokens: request.maxTokens || 4096,
  messages,
  tools,
};

// Kimi-specific: enable built-in search for research tasks
if (request.kimiSearchEnabled) {
  createParams.use_search = true;
}

// Kimi-specific: thinking mode with budget
if (request.thinkingEnabled && model.startsWith('kimi-')) {
  createParams.thinking = {
    type: 'enabled',
    budget_tokens: 8192,
  };
}

const response = await client.chat.completions.create(
  createParams as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming
);
```

#### 2. `apps/api/src/llm/types.ts`

Add Kimi-specific request option:

```typescript
export interface GenerateRequest {
  // ... existing fields ...
  /** Enable Kimi's built-in web search (Kimi K2.5 only) */
  kimiSearchEnabled?: boolean;
}
```

#### 3. `apps/api/src/agents/chapo-loop.ts`

Enable Kimi search when the task involves web research:

```typescript
// Near the thinkingEnabled logic:
const kimiSearchEnabled = provider === 'moonshot' &&
  /\b(search|research|find|look up|documentation|suche|recherche)\b/i.test(userText);
```

Pass to `generateWithFallback`:
```typescript
kimiSearchEnabled,
```

### Engine Mapping

| Engine | Kimi Search | Kimi Thinking |
|--------|-------------|---------------|
| `/engine kimi` | Auto (keyword match) | Auto (shouldEnableThinking) |
| Other engines | N/A (ignored by non-Kimi providers) | N/A |

### Verification

1. Switch to `/engine kimi`
2. Ask "research the latest TypeScript 5.7 features" → should enable `use_search`
3. Ask "debug this complex auth issue" → should enable thinking with budget
4. Check response quality vs without these parameters

### Implementation Notes

Implemented 2026-02-26. Files changed:
- `apps/api/src/llm/types.ts` — Added `kimiSearchEnabled?: boolean` to `GenerateRequest`
- `apps/api/src/llm/providers/moonshot.ts` — Added `use_search` and `thinking` params with `createParams` dict pattern (avoids type issues with OpenAI SDK)
- `apps/api/src/agents/chapo-loop.ts` — Added keyword heuristic: `search|research|find|look up|documentation|latest|aktuell|suche|recherche|finde`

---

## #14. MCP Server Discovery & Auto-Configuration — IMPLEMENTED

**Effort**: ~4 days | **Impact**: Easy integration of new tools without manual config
**Engine**: ALL

### Problem

MCP servers are configured in a static JSON file (`mcp-servers.json`). Adding a new server requires:
1. Editing the JSON file
2. Restarting the API
3. Knowing the exact command, args, and env vars

Claude Code auto-discovers MCP servers and has a marketplace. DevAI should at least auto-discover from workspace config.

### Current State

```typescript
// mcp/config.ts — loads from static file:
// /opt/Klyde/projects/Devai/apps/api/mcp-servers.json

interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  requiresConfirmation?: boolean;
  toolPrefix: string;
  enabledForAgents: string[];
}

// mcp/manager.ts — McpManager
// - initialize(): loads config, connects all servers
// - connectServer(): creates McpClient, discovers tools, registers in toolRegistry
// - executeTool(): auto-reconnects, 30s timeout
// - getToolsForAgent(): returns tool names for an agent
```

### Design

#### Layer 1: Workspace Discovery

Discover MCP servers from workspace configuration files:

```
Workspace root/
├── workspace/
│   ├── mcp-servers.json     ← Project-specific MCP servers
│   └── ...
└── package.json             ← npm packages with MCP server metadata
```

#### Layer 2: Registry of Known Servers

Built-in registry of popular MCP servers with default configs:

```typescript
const KNOWN_MCP_SERVERS: Record<string, Partial<McpServerConfig>> = {
  'github': {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    toolPrefix: 'github',
    env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' },
  },
  'filesystem': {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    toolPrefix: 'fs_mcp',
  },
  'slack': {
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-slack'],
    toolPrefix: 'slack',
    env: { SLACK_TOKEN: '${SLACK_TOKEN}' },
  },
  // ... more popular servers
};
```

#### Layer 3: UI Configuration

Frontend panel to enable/disable MCP servers per session.

### Files to Create/Modify

#### 1. `apps/api/src/mcp/discovery.ts` — NEW

```typescript
import { readFile } from 'fs/promises';
import { join } from 'path';
import type { McpServerConfig } from './config.js';

/**
 * Discover MCP servers from workspace configuration.
 * Merges: static config + workspace config + known server registry.
 */
export async function discoverMcpServers(
  staticConfig: McpServerConfig[],
  projectRoot: string | null,
): Promise<McpServerConfig[]> {
  const servers = [...staticConfig];
  const existingNames = new Set(servers.map((s) => s.name));

  // 1. Workspace-level mcp-servers.json
  if (projectRoot) {
    const workspaceConfig = await loadWorkspaceMcpConfig(projectRoot);
    for (const server of workspaceConfig) {
      if (!existingNames.has(server.name)) {
        servers.push(server);
        existingNames.add(server.name);
      }
    }
  }

  return servers;
}

async function loadWorkspaceMcpConfig(projectRoot: string): Promise<McpServerConfig[]> {
  const paths = [
    join(projectRoot, 'workspace', 'mcp-servers.json'),
    join(projectRoot, '.mcp', 'servers.json'),
  ];

  for (const path of paths) {
    try {
      const raw = await readFile(path, 'utf-8');
      const config = JSON.parse(raw);
      if (Array.isArray(config.servers)) {
        return config.servers.map((s: McpServerConfig) => ({
          ...s,
          enabledForAgents: s.enabledForAgents || ['chapo'],
        }));
      }
    } catch {
      // File not found — try next
    }
  }

  return [];
}
```

#### 2. `apps/api/src/mcp/health.ts` — NEW

```typescript
import type { McpManager } from './manager.js';

export interface McpServerHealth {
  name: string;
  connected: boolean;
  toolCount: number;
  lastError?: string;
  lastConnectedAt?: string;
}

/**
 * Get health status of all MCP servers.
 */
export function getMcpHealth(manager: McpManager): McpServerHealth[] {
  // ... read connection status from manager's internal state
}

/**
 * Auto-reconnect disconnected servers.
 * Run on a 60s interval.
 */
export async function autoReconnect(manager: McpManager): Promise<void> {
  const health = getMcpHealth(manager);
  for (const server of health) {
    if (!server.connected) {
      console.log(`[mcp] Auto-reconnecting ${server.name}...`);
      try {
        await manager.reconnectServer(server.name);
      } catch (err) {
        console.warn(`[mcp] Auto-reconnect failed for ${server.name}:`, err);
      }
    }
  }
}
```

#### 3. `apps/api/src/mcp/manager.ts`

Add methods for dynamic server management:

```typescript
// New methods on McpManager:

/** Reconnect a specific server */
async reconnectServer(name: string): Promise<void>

/** Add a new server at runtime (without restart) */
async addServer(config: McpServerConfig): Promise<void>

/** Remove a server at runtime */
async removeServer(name: string): Promise<void>

/** Get connection status of all servers */
getServerStatus(): Map<string, { connected: boolean; toolCount: number }>
```

#### 4. Frontend: MCP settings panel

Add a new settings section in the web app:
- List all discovered MCP servers
- Show connection status (green/red)
- Enable/disable per server
- "Add custom server" form
- Reconnect button

### Verification

1. Create `workspace/mcp-servers.json` in a project
2. Restart API → verify new servers are discovered and connected
3. Disconnect a server (kill its process) → verify auto-reconnect fires within 60s
4. Add a server via the UI → verify tools are immediately available
5. Remove a server → verify tools are unregistered

### Implementation Notes

Implemented 2026-02-26. Files changed:
- `apps/api/src/mcp/discovery.ts` — **NEW**: Probes 3 workspace paths (`workspace/mcp-servers.json`, `.mcp/servers.json`, `.devai/mcp-servers.json`), supports both `mcpServers` and `servers` array formats, skips name collisions with static config
- `apps/api/src/mcp/health.ts` — **NEW**: `startHealthMonitor()` runs 60s auto-reconnect loop via `setInterval`, `autoReconnect()` iterates disconnected servers, `getMcpHealth()` returns status array
- `apps/api/src/mcp/manager.ts` — `McpManager` class exported (was private), added `addServer()`, `removeServer()`, `reconnectServer()` methods, `initialize()` now accepts optional `projectRoot` for workspace discovery, `shutdown()` stops health monitor
- `apps/api/src/mcp/index.ts` — Re-exports for discovery, health, and new types

---

## Implementation Order

| # | Feature | Effort | Status |
|---|---------|--------|--------|
| **13** | Kimi Swarm Mode | 2 days | **DONE** |
| **14** | MCP Discovery | 4 days | **DONE** |
| **10** | Architect/Editor Split | 5 days | **Next** |

#11 (Plan Mode) and #12 (Sandbox) → [Tier 5](./tier5-deferred-plan.md)

## Files Summary

| File | Change Type | Feature |
|------|------------|---------|
| `apps/api/src/agents/architectEditor.ts` | **NEW** | #10 |
| `apps/api/src/agents/chapo-loop/toolExecutor.ts` | Modify | #10 (intercept fs_write/edit) |
| `apps/api/src/llm/engineProfiles.ts` | Modify | #10 (architectMode flag) |
| `apps/api/src/llm/providers/moonshot.ts` | Modify | #13 (Kimi-specific params) — DONE |
| `apps/api/src/llm/types.ts` | Modify | #13 (kimiSearchEnabled) — DONE |
| `apps/api/src/agents/chapo-loop.ts` | Modify | #13 (Kimi search heuristic) — DONE |
| `apps/api/src/mcp/discovery.ts` | **NEW** | #14 — DONE |
| `apps/api/src/mcp/health.ts` | **NEW** | #14 — DONE |
| `apps/api/src/mcp/manager.ts` | Modify | #14 (dynamic add/remove/reconnect) — DONE |
