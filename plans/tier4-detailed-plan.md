# Tier 4: Long-Term / Research — Detailed Implementation Plan

> Prerequisite: Tier 1-2 recommended (especially #6 Context Compaction, #8 Reflexion)
> Tier 3 #11 (Plan Mode) and #14 (MCP Discovery) are helpful but not required.

---

## #15. Episodic Memory (Cross-Session Learning)

**Effort**: ~7 days | **Impact**: Agent remembers what happened, learns from past sessions
**Engine**: ALL

### Problem

DevAI has a capable memory system (vector search, embeddings, extraction, decay, namespaces) but it's **passive** — memories are only extracted at session-end compaction or when the user explicitly says "remember this". The system doesn't automatically learn from:

- Successful debugging patterns ("last time this error meant X")
- User preferences observed over time ("user always pushes to dev branch")
- Project-specific knowledge built up across sessions
- Temporal events ("deployed TaskForge yesterday at 14:30")

Claude Code's `MEMORY.md` auto-updates as the agent works. MemGPT has tiered memory with automatic promotion. DevAI needs the same.

### Current State

| Component | Status | Gap |
|-----------|--------|-----|
| Vector search (`memoryStore.ts`) | Working | Only keyword/similarity search, no temporal queries |
| Extraction pipeline (`extraction.ts`) | Working | Only runs at session-end or compaction, not real-time |
| Namespace hierarchy | Working | Episodic namespace exists but isn't auto-populated |
| Decay + reinforcement | Working | Reinforcement only fires on retrieval, not on relevance |
| Recent topics (`recentFocus.ts`) | Working | Not linked to episodic memory |
| Memory types | Defined | `episodic` type exists but no specialized extraction rules |
| `memory.md` rendering | Working | "Termine & Events" category exists but is empty |

**Database schema** (`devai_memories` table):
```sql
-- Already supports episodic:
memory_type TEXT NOT NULL,     -- 'semantic' | 'episodic' | 'procedural'
namespace TEXT NOT NULL,        -- 'devai/project/taskforge/session-abc'
strength FLOAT DEFAULT 1.0,    -- decay: strength * 0.95^days
source TEXT,                    -- 'user_stated' | 'error_resolution' | 'pattern' | 'discovery' | 'compaction'
session_id TEXT,                -- links to session
```

### Design

#### 3 New Extraction Triggers

| Trigger | When | What's Extracted |
|---------|------|-----------------|
| **Real-time** | After each successful tool execution | Patterns: "file X was edited", "command Y succeeded" |
| **Turn-end** | After CHAPO answers (no more tool calls) | Episodic summary: "User asked about X, we did Y, result was Z" |
| **Session-end** | When WebSocket disconnects | Full session learnings (existing, but enhanced) |

#### Episodic Memory Structure

```typescript
interface EpisodicMemory {
  // Standard fields (from MemoryInsert):
  content: string;           // "Fixed InputFile import by changing to node-appwrite/file"
  embedding: number[];
  memory_type: 'episodic';
  namespace: string;         // "devai/project/devai/debugging"
  priority: MemoryPriority;
  source: MemorySource;
  session_id: string;

  // Episodic-specific (stored in JSONB metadata column):
  metadata: {
    timestamp: string;       // When it happened
    duration_ms?: number;    // How long the task took
    tools_used: string[];    // Which tools were involved
    files_touched: string[]; // Which files were accessed/modified
    outcome: 'success' | 'failure' | 'partial';
    topic?: string;          // From recentFocus tagging
    trigger: 'realtime' | 'turn_end' | 'session_end';
  };
}
```

#### Temporal Query Support

Add a new function for time-based retrieval (complements vector search):

```sql
-- New SQL function for temporal queries:
CREATE OR REPLACE FUNCTION recent_episodic_memories(
  p_namespace TEXT,
  p_since TIMESTAMPTZ DEFAULT now() - INTERVAL '7 days',
  p_limit INT DEFAULT 20
) RETURNS TABLE (
  id UUID, content TEXT, memory_type TEXT, namespace TEXT,
  strength FLOAT, priority TEXT, created_at TIMESTAMPTZ,
  metadata JSONB
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
    SELECT m.id, m.content, m.memory_type, m.namespace,
           m.strength, m.priority, m.created_at, m.metadata
    FROM devai_memories m
    WHERE m.is_valid = true
      AND m.memory_type = 'episodic'
      AND m.namespace LIKE p_namespace || '%'
      AND m.created_at > p_since
      AND m.strength > 0.05
    ORDER BY m.created_at DESC
    LIMIT p_limit;
END; $$;
```

### Files to Create/Modify

#### 1. DB migration: `apps/api/src/db/migrations/004_episodic_metadata.sql` — NEW

```sql
-- Add metadata JSONB column for episodic-specific fields
ALTER TABLE devai_memories ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Index for temporal queries
CREATE INDEX IF NOT EXISTS idx_memories_episodic_time
  ON devai_memories (created_at DESC)
  WHERE memory_type = 'episodic' AND is_valid = true;

-- Function for temporal retrieval
CREATE OR REPLACE FUNCTION recent_episodic_memories(
  p_namespace TEXT,
  p_since TIMESTAMPTZ DEFAULT now() - INTERVAL '7 days',
  p_limit INT DEFAULT 20
) RETURNS TABLE (...) LANGUAGE plpgsql AS $$ ... $$;
```

#### 2. New file: `apps/api/src/memory/episodicExtractor.ts`

Real-time episodic extraction (fires after tool executions):

```typescript
import { generateEmbedding } from './embeddings.js';
import { insertMemory, findSimilarMemories } from './memoryStore.js';
import type { MemoryInsert } from './types.js';

interface EpisodicContext {
  sessionId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolResult: string;
  isError: boolean;
  userMessage: string;
  iteration: number;
  projectName?: string;
}

/** Patterns that indicate episodic-worthy events */
const EPISODIC_PATTERNS = {
  error_resolution: /\b(fixed|resolved|solved|workaround|solution)\b/i,
  deployment: /\b(deployed|pushed|released|published)\b/i,
  discovery: /\b(found|discovered|realized|turns out|the issue was)\b/i,
  configuration: /\b(configured|set up|installed|enabled|disabled)\b/i,
};

/**
 * Extract episodic memory from a tool execution result.
 * Called after each successful tool call (fire-and-forget).
 */
export async function extractEpisodicFromTool(ctx: EpisodicContext): Promise<void> {
  // Skip trivial reads and listings
  if (['fs_listFiles', 'fs_readFile', 'fs_glob'].includes(ctx.toolName) && !ctx.isError) {
    return;
  }

  // Build episodic content
  const content = buildEpisodicContent(ctx);
  if (!content) return;

  // Deduplicate: check if we already have this memory
  const similar = await findSimilarMemories(content, `devai/project/${ctx.projectName || 'global'}`);
  if (similar.length > 0 && similar[0].similarity > 0.9) {
    return; // Already know this
  }

  const embedding = await generateEmbedding(content);
  const memory: MemoryInsert = {
    content,
    embedding,
    memory_type: 'episodic',
    namespace: `devai/project/${ctx.projectName || 'global'}`,
    priority: ctx.isError ? 'high' : 'medium',
    source: detectSource(ctx),
    session_id: ctx.sessionId,
  };

  await insertMemory(memory);
}

function buildEpisodicContent(ctx: EpisodicContext): string | null {
  // Error resolutions
  if (ctx.isError) {
    return `Tool ${ctx.toolName} failed: ${ctx.toolResult.slice(0, 200)}`;
  }

  // File modifications
  if (['fs_writeFile', 'fs_edit'].includes(ctx.toolName)) {
    const path = (ctx.toolArgs.path as string) || (ctx.toolArgs.file_path as string) || '?';
    return `Modified file: ${path} (during: ${ctx.userMessage.slice(0, 100)})`;
  }

  // Git operations
  if (ctx.toolName === 'git_commit') {
    const msg = (ctx.toolArgs.message as string) || '';
    return `Committed: ${msg}`;
  }
  if (ctx.toolName === 'git_push') {
    return `Pushed to ${(ctx.toolArgs.branch as string) || 'remote'}`;
  }

  // Bash results matching episodic patterns
  if (ctx.toolName === 'bash_execute') {
    const result = ctx.toolResult.slice(0, 300);
    for (const [, pattern] of Object.entries(EPISODIC_PATTERNS)) {
      if (pattern.test(result)) {
        return `Bash: ${(ctx.toolArgs.command as string)?.slice(0, 100)} → ${result.slice(0, 150)}`;
      }
    }
  }

  return null; // Not episodic-worthy
}

function detectSource(ctx: EpisodicContext): 'error_resolution' | 'pattern' | 'discovery' {
  if (ctx.isError) return 'error_resolution';
  if (EPISODIC_PATTERNS.discovery.test(ctx.toolResult)) return 'discovery';
  return 'pattern';
}
```

#### 3. New file: `apps/api/src/memory/turnSummary.ts`

Turn-end episodic summary (fires when CHAPO answers):

```typescript
import { llmRouter } from '../llm/router.js';
import { generateEmbedding } from './embeddings.js';
import { insertMemory } from './memoryStore.js';
import type { LLMProvider } from '../llm/types.js';

const TURN_SUMMARY_PROMPT = `Extract a 1-2 sentence episodic memory from this conversation turn.

Focus on WHAT happened (actions taken, results achieved, errors encountered) not HOW (tool calls, iterations).

If nothing significant happened (just a greeting, simple Q&A), respond with: SKIP

Examples of good episodic memories:
- "Fixed Appwrite function 503 by importing InputFile from node-appwrite/file instead of main package"
- "User asked to deploy TaskForge, pushed to dev branch successfully"
- "Investigated auth bug: root cause was expired JWT, fixed by increasing token TTL to 7 days"

Respond with ONLY the memory text or SKIP. No explanations.`;

/**
 * Generate a turn-end episodic summary.
 * Called when CHAPO produces an answer (fire-and-forget).
 */
export async function extractTurnEpisodic(
  userMessage: string,
  answer: string,
  toolsUsed: string[],
  filesTouched: string[],
  sessionId: string,
  projectName?: string,
  provider?: LLMProvider,
): Promise<void> {
  // Skip trivial turns
  if (toolsUsed.length === 0 && answer.length < 200) return;

  try {
    const response = await llmRouter.generateWithFallback(
      provider ?? 'zai',
      {
        model: 'glm-4.7-flash',
        systemPrompt: TURN_SUMMARY_PROMPT,
        messages: [{
          role: 'user',
          content: `User: ${userMessage.slice(0, 500)}\n\nTools used: ${toolsUsed.join(', ')}\nFiles: ${filesTouched.join(', ')}\n\nAssistant answer: ${answer.slice(0, 1000)}`,
        }],
        maxTokens: 128,
      },
    );

    const text = response.content.trim();
    if (text === 'SKIP' || text.length < 20) return;

    const embedding = await generateEmbedding(text);
    await insertMemory({
      content: text,
      embedding,
      memory_type: 'episodic',
      namespace: `devai/project/${projectName || 'global'}`,
      priority: 'medium',
      source: 'pattern',
      session_id: sessionId,
    });

    console.log(`[episodic] Turn summary stored: ${text.slice(0, 80)}...`);
  } catch (err) {
    console.warn('[episodic] Turn summary extraction failed:', err);
  }
}
```

#### 4. `apps/api/src/memory/service.ts`

Add temporal retrieval alongside vector search:

```typescript
import { supabase } from '../db/supabaseClient.js';

/**
 * Retrieve recent episodic memories (time-based, not vector).
 */
export async function retrieveRecentEpisodic(
  projectName?: string,
  since?: Date,
  limit = 10,
): Promise<StoredMemory[]> {
  const namespace = projectName ? `devai/project/${projectName}` : 'devai';
  const sinceDate = since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days

  const { data, error } = await supabase.rpc('recent_episodic_memories', {
    p_namespace: namespace,
    p_since: sinceDate.toISOString(),
    p_limit: limit,
  });

  if (error) {
    console.error('[memory] Temporal retrieval failed:', error);
    return [];
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    content: row.content as string,
    similarity: 1.0,  // Not a vector search, full relevance
    memory_type: row.memory_type as MemoryType,
    namespace: row.namespace as string,
    strength: row.strength as number,
    priority: row.priority as MemoryPriority,
  }));
}
```

Enhance `retrieveRelevantMemories` to merge temporal + vector results:

```typescript
export async function retrieveRelevantMemories(
  query: string,
  projectName?: string,
): Promise<StoredMemory[]> {
  // Existing vector search
  const vectorResults = await vectorSearch(query, projectName);

  // New: temporal query for "what happened recently" type queries
  const temporalKeywords = /\b(yesterday|today|last time|recently|earlier|vorhin|gestern|letztens|kürzlich)\b/i;
  let temporalResults: StoredMemory[] = [];
  if (temporalKeywords.test(query)) {
    temporalResults = await retrieveRecentEpisodic(projectName);
  }

  // Merge and deduplicate
  const seen = new Set<string>();
  const merged: StoredMemory[] = [];
  for (const mem of [...vectorResults, ...temporalResults]) {
    if (!seen.has(mem.id)) {
      seen.add(mem.id);
      merged.push(mem);
    }
  }

  // Rank: vector results by similarity*strength, temporal by recency
  return merged
    .sort((a, b) => (b.similarity * b.strength) - (a.similarity * a.strength))
    .slice(0, 10);
}
```

#### 5. `apps/api/src/agents/chapo-loop.ts`

Hook episodic extraction into the loop:

```typescript
import { extractEpisodicFromTool } from '../memory/episodicExtractor.js';
import { extractTurnEpisodic } from '../memory/turnSummary.js';

// After each tool result (~line 448, inside the tool loop):
// Fire-and-forget: episodic extraction from tool result
if (outcome.toolResult && !outcome.toolResult.isError) {
  extractEpisodicFromTool({
    sessionId: this.sessionId,
    toolName: toolCall.name,
    toolArgs: toolCall.arguments,
    toolResult: outcome.toolResult.result,
    isError: outcome.toolResult.isError,
    userMessage: userText,
    iteration: this.iteration,
    projectName: this.getProjectName(),
  }).catch((err) => console.warn('[episodic] Tool extraction failed:', err));
}

// At the ANSWER path (~line 407), before returning:
// Fire-and-forget: turn-end episodic summary
const toolsUsed = this.toolCallLog.map((t) => t.name);
const filePaths = this.extractFilePathsFromToolCalls(response.toolCalls || []);
extractTurnEpisodic(
  userText, answer, toolsUsed, filePaths,
  this.sessionId, this.getProjectName(), provider,
).catch((err) => console.warn('[episodic] Turn summary failed:', err));
```

#### 6. `apps/api/src/memory/renderMemoryMd.ts`

Enhance episodic rendering in "Termine & Events" category:

```typescript
// In the category mapping, add episodic-specific handling:
if (memory.memory_type === 'episodic') {
  return 'Termine & Events';
}

// In the rendering, sort episodic by recency:
if (category === 'Termine & Events') {
  entries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}
```

### Verification

1. Start a session, edit a file, commit → check `devai_memories` for episodic entries
2. In a new session, ask "what did I work on yesterday?" → should retrieve temporal episodic memories
3. Create an error, fix it → check that error resolution is stored as high-priority episodic
4. Check `memory.md` → "Termine & Events" should have recent activity
5. Verify decay: wait 1 day, run decay → episodic memories should lose 5% strength

---

## #16. Real-Time Streaming with Progressive UI

**Effort**: ~5 days | **Impact**: Users see what the agent is doing live
**Engine**: ALL

### Problem

DevAI streams agent events (tool calls, thinking, results) but the user experience has gaps:

1. **Tool arguments are opaque**: User sees "tool_call: fs_writeFile" but not WHAT is being written until it's done
2. **No live diffs**: File edits appear as a completed result, not progressively
3. **No cancel mechanism**: Once a tool starts, the user can't stop it (only `/stop` aborts the whole loop)
4. **No token/cost visibility**: Users don't know how many tokens are being consumed

### Current State

**Event flow:**
```
CHAPO loop → sendEvent() → eventBridge → workflowBus → streamProjection → chatGateway → WebSocket → Frontend
```

**What's already streaming:**
| Event | What User Sees |
|-------|---------------|
| `agent_start` | "Chapo started (execution phase)" |
| `agent_thinking` | "Analyzing request..." / "Iteration N..." |
| `tool_call` | Tool name + full args (after LLM completes) |
| `tool_result` | Full result (after tool completes) |
| `tool_result_chunk` | Partial result (handled in frontend but NOT emitted by backend) |
| `action_pending` | Approval dialog |
| `agent_complete` | Final answer |

**What's missing:**
| Feature | Status |
|---------|--------|
| Streaming tool args (as LLM generates them) | Not possible (non-streaming API calls) |
| Progressive tool results (chunked output) | Backend support exists (`tool_result_chunk`) but unused |
| Cancel individual tool | Not implemented |
| Token counter | Backend tracks, frontend doesn't display |
| Cost estimate | Backend calculates, frontend doesn't display |

### Design

#### Phase 1: Token/Cost Live Display (2 days)

Stream token usage after each LLM call. Frontend shows a live counter.

#### Phase 2: Progressive Tool Results (2 days)

For long-running tools (bash, web_fetch, ssh), stream output chunks as they arrive.

#### Phase 3: Cancel Mechanism (1 day)

Allow canceling individual tool executions from the frontend.

### Files to Create/Modify

#### Phase 1: Token/Cost Display

##### 1a. `apps/api/src/agents/chapo-loop.ts`

Emit `context_stats` event after each LLM call (the handler already exists in frontend):

```typescript
// After the LLM call (~line 364), after accumulating token usage:
if (response?.usage) {
  this.totalTokensUsed += response.usage.inputTokens + response.usage.outputTokens;

  // Stream token stats to frontend
  this.sendEvent({
    type: 'context_stats',
    stats: {
      tokensUsed: this.totalTokensUsed,
      tokenBudget: appConfig.costCapPerRunTokens,
      iteration: this.iteration,
      maxIterations: this.config.maxIterations,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      cachedTokens: response.usage.cachedTokens,
      model: modelForThisTurn || model,
      provider,
      estimatedCostUsd: this.estimateCost(this.totalTokensUsed),
    },
  });
}
```

Add cost estimation method to `ChapoLoop`:

```typescript
private estimateCost(totalTokens: number): number {
  // Rough estimate based on the primary model
  const model = this.modelSelection.model;
  const PRICES_PER_M: Record<string, number> = {
    'glm-5': 2.1,          // ~$1 input + $3.2 output avg
    'glm-4.7-flash': 0,    // Free
    'kimi-k2.5': 2.0,
    'claude-opus-4-5': 45,  // ~$15 input + $75 output avg
    'claude-sonnet-4': 9,
  };
  const pricePerM = PRICES_PER_M[model] || 2;
  return (totalTokens / 1_000_000) * pricePerM;
}
```

##### 1b. `apps/api/src/workflow/events/catalog.ts`

Add new event type (optional — can use existing stream event):

```typescript
// Already handled by the legacy stream path, but for consistency:
CONTEXT_STATS = 'context.stats'
```

##### 1c. Frontend: New `TokenCounter` component

`apps/web/src/components/ChatUI/TokenCounter.tsx` — NEW

```tsx
interface TokenCounterProps {
  stats: ContextStats | null;
}

export function TokenCounter({ stats }: TokenCounterProps) {
  if (!stats) return null;

  const { tokensUsed, tokenBudget, estimatedCostUsd, iteration, maxIterations, model } = stats;
  const pct = Math.min(100, (tokensUsed / tokenBudget) * 100);

  return (
    <div className="token-counter">
      <div className="token-bar">
        <div className="token-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="token-text">
        {(tokensUsed / 1000).toFixed(0)}k / {(tokenBudget / 1000).toFixed(0)}k tokens
      </span>
      {estimatedCostUsd > 0 && (
        <span className="token-cost">~${estimatedCostUsd.toFixed(3)}</span>
      )}
      {iteration !== undefined && (
        <span className="token-iter">Step {iteration + 1}/{maxIterations}</span>
      )}
      {model && <span className="token-model">{model}</span>}
    </div>
  );
}
```

##### 1d. `apps/web/src/components/ChatUI/ChatUI.tsx`

Wire up the `context_stats` handler (already partially there):

```typescript
// State:
const [contextStats, setContextStats] = useState<ContextStats | null>(null);

// In handleStreamEvent:
case 'context_stats':
  setContextStats(event.stats);
  break;

// In JSX, near the input area:
<TokenCounter stats={contextStats} />
```

##### 1e. `apps/web/src/types.ts`

Extend `ContextStats`:

```typescript
export interface ContextStats {
  tokensUsed: number;
  tokenBudget: number;
  iteration?: number;
  maxIterations?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  model?: string;
  provider?: string;
  estimatedCostUsd?: number;
}
```

---

#### Phase 2: Progressive Tool Results

##### 2a. `apps/api/src/tools/bash.ts`

Stream bash output as chunks instead of waiting for completion:

```typescript
import { spawn } from 'child_process';

interface StreamCallbacks {
  onChunk: (chunk: string) => void;
  onComplete: (result: { stdout: string; stderr: string; exitCode: number }) => void;
}

/**
 * Execute bash with streaming output.
 */
function executeBashStreaming(
  command: string,
  options: { cwd: string; timeout: number; maxOutput: number },
  callbacks: StreamCallbacks,
): void {
  const child = spawn('bash', ['-c', command], {
    cwd: options.cwd,
    timeout: options.timeout,
    env: process.env,
  });

  let stdout = '';
  let stderr = '';
  let chunkBuffer = '';
  const CHUNK_INTERVAL = 500; // Send chunks every 500ms

  const flushChunk = () => {
    if (chunkBuffer.length > 0) {
      callbacks.onChunk(chunkBuffer);
      chunkBuffer = '';
    }
  };

  const chunkTimer = setInterval(flushChunk, CHUNK_INTERVAL);

  child.stdout.on('data', (data: Buffer) => {
    const text = data.toString();
    stdout += text;
    chunkBuffer += text;
    if (stdout.length > options.maxOutput) {
      child.kill();
    }
  });

  child.stderr.on('data', (data: Buffer) => {
    stderr += data.toString();
  });

  child.on('close', (code) => {
    clearInterval(chunkTimer);
    flushChunk(); // Send remaining
    callbacks.onComplete({
      stdout: stdout.slice(0, options.maxOutput),
      stderr: stderr.slice(0, options.maxOutput),
      exitCode: code || 0,
    });
  });
}
```

##### 2b. `apps/api/src/agents/chapo-loop/toolExecutor.ts`

Emit `tool_result_chunk` events during long tool executions:

```typescript
// For bash_execute and ssh_execute, use streaming execution:
this.deps.sendEvent({
  type: 'tool_result_chunk',
  agent: 'chapo',
  toolName: toolCall.name,
  toolId: toolCall.id,
  chunk: chunkText,
  isPartial: true,
});
```

##### 2c. Frontend: `ChatUI.tsx`

The `tool_result_chunk` handler already exists:

```typescript
case 'tool_result_chunk':
  upsertToolEvent(setToolEvents, id, {
    type: 'tool_result',
    name: event.toolName,
    chunk: event.chunk,        // Append to existing result
    agent: event.agent,
  });
  break;
```

But the `ToolEventCard` component needs to render streaming output:

```tsx
// In ToolEventCard.tsx:
if (event.type === 'tool_result' && event.isPartial) {
  return (
    <div className="tool-result streaming">
      <pre className="tool-output">{event.result}</pre>
      <span className="streaming-indicator">...</span>
    </div>
  );
}
```

---

#### Phase 3: Cancel Individual Tools

##### 3a. New WebSocket message type

Client → Server:
```json
{
  "type": "cancel_tool",
  "sessionId": "abc-123",
  "toolId": "tool-call-456"
}
```

##### 3b. `apps/api/src/websocket/routes.ts`

Handle the cancel message:

```typescript
case 'cancel_tool':
  const { sessionId, toolId } = message;
  cancelToolExecution(sessionId, toolId);
  break;
```

##### 3c. `apps/api/src/agents/chapo-loop/toolExecutor.ts`

Add cancellation support:

```typescript
// Track running tool processes
private runningProcesses = new Map<string, AbortController>();

// Before tool execution:
const abort = new AbortController();
this.runningProcesses.set(toolCall.id, abort);

// Pass abort signal to tool execution
const result = await executeToolWithApprovalBridge(toolCall.name, toolCall.arguments, {
  signal: abort.signal,
  // ... existing options
});

// Cleanup after execution
this.runningProcesses.delete(toolCall.id);

// Cancel method (called from WebSocket handler):
cancelTool(toolId: string): void {
  const abort = this.runningProcesses.get(toolId);
  if (abort) {
    abort.abort();
    this.runningProcesses.delete(toolId);
  }
}
```

##### 3d. Frontend: Cancel button on tool events

```tsx
// In ToolEventCard.tsx, when tool is running:
{event.status === 'running' && (
  <button
    className="cancel-tool-btn"
    onClick={() => ws.send(JSON.stringify({ type: 'cancel_tool', sessionId, toolId: event.id }))}
  >
    Cancel
  </button>
)}
```

### Verification

**Phase 1 (Token Counter):**
1. Start any task → verify token counter appears after first LLM call
2. Watch counter increment with each iteration
3. Verify cost estimate matches usage logger output
4. Verify model name switches when cost routing (Tier 2 #9) activates

**Phase 2 (Streaming):**
1. Run `bash_execute` with a long command (e.g. `npm test`) → verify output streams in real-time
2. Compare UX with before (all output at once) vs after (progressive)
3. Test `web_fetch` for large pages → verify chunked display

**Phase 3 (Cancel):**
1. Start a long bash command → click cancel → verify process is killed
2. Verify the tool result shows "[Cancelled by user]"
3. Verify the CHAPO loop continues (doesn't crash)

---

## Implementation Order

| Phase | Feature | Effort | Dependencies |
|-------|---------|--------|-------------|
| **15a** | Episodic: real-time extraction | 2 days | None |
| **15b** | Episodic: turn-end summaries | 1 day | 15a |
| **15c** | Episodic: temporal queries + memory.md | 2 days | 15a, migration |
| **15d** | Episodic: session-end enhancement | 1 day | 15a |
| **16a** | Token/cost live display | 2 days | None |
| **16b** | Progressive tool results | 2 days | None |
| **16c** | Cancel individual tools | 1 day | 16b |

**Recommended parallel track:**
- #15a-d and #16a can start simultaneously (no dependencies)
- #16b and #16c are sequential

Total: ~11 days (some parallelizable)

## Files Summary

| File | Change Type | Feature |
|------|------------|---------|
| `apps/api/src/db/migrations/004_episodic_metadata.sql` | **NEW** | #15 |
| `apps/api/src/memory/episodicExtractor.ts` | **NEW** | #15 |
| `apps/api/src/memory/turnSummary.ts` | **NEW** | #15 |
| `apps/api/src/memory/service.ts` | Modify | #15 (temporal queries, merged retrieval) |
| `apps/api/src/memory/memoryStore.ts` | Modify | #15 (temporal RPC call) |
| `apps/api/src/memory/renderMemoryMd.ts` | Modify | #15 (episodic rendering) |
| `apps/api/src/agents/chapo-loop.ts` | Modify | #15 (extraction hooks), #16a (context_stats emit) |
| `apps/web/src/components/ChatUI/TokenCounter.tsx` | **NEW** | #16a |
| `apps/web/src/components/ChatUI/ChatUI.tsx` | Modify | #16a (wire counter), #16c (cancel button) |
| `apps/web/src/types.ts` | Modify | #16a (ContextStats extension) |
| `apps/api/src/tools/bash.ts` | Modify | #16b (streaming execution) |
| `apps/api/src/agents/chapo-loop/toolExecutor.ts` | Modify | #16b (chunk events), #16c (cancel) |
| `apps/api/src/websocket/routes.ts` | Modify | #16c (cancel_tool message) |
