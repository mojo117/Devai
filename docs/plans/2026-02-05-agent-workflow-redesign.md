# Agent Workflow Redesign

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the multi-agent workflow stable and reliable by separating "understanding" from "routing" - LLMs understand requests, code routes them.

**Problem:** Current architecture relies on CHAPO (LLM) to "decide" whether to delegate to other agents. This fails silently - CHAPO says "I can't do that" instead of delegating, and users give up on features.

**Solution:** Capability Analyzer (forced JSON) + Deterministic Router (code) + Focused Executors

---

## Architecture Overview

### Current Flow (Broken)
```
User Request → CHAPO (LLM decides everything) → Maybe delegates, maybe doesn't
```

### New Flow
```
User Request → Capability Analyzer → Router (code, not LLM) → Agent(s) → Response
```

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      User Request                           │
└─────────────────────────┬───────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Capability Analyzer (CHAPO)                    │
│         LLM with forced JSON output (Haiku)                 │
│   Output: { needs: {...}, tasks: [...], confidence }        │
└─────────────────────────┬───────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   Router (Pure Code)                        │
│         Deterministic mapping: capabilities → agents        │
│              Handles dependencies & ordering                │
└───────────┬─────────────┬─────────────┬─────────────────────┘
            ▼             ▼             ▼
       ┌────────┐    ┌────────┐    ┌────────┐
       │ SCOUT  │    │  KODA  │    │  DEVO  │
       │  web   │    │  code  │    │ devops │
       └───┬────┘    └───┬────┘    └───┬────┘
           └─────────────┴─────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│            Response Synthesizer (CHAPO)                     │
│        Combines agent results into user response            │
└─────────────────────────────────────────────────────────────┘
```

---

## Component 1: Capability Analyzer

**Purpose:** Understand the request, output structured flags. No execution.

**Model:** Claude Haiku (fast, cheap - just classification)

### Output Schema

```typescript
interface CapabilityAnalysis {
  // What capabilities are needed?
  needs: {
    web_search: boolean;      // Current info, weather, docs, etc.
    code_read: boolean;       // Read/understand existing code
    code_write: boolean;      // Create or modify files
    devops: boolean;          // Git, npm, pm2, deployment
    clarification: boolean;   // Genuinely ambiguous, must ask user
  };

  // Task breakdown (if multiple steps)
  tasks: Array<{
    description: string;      // "Fetch current weather for Frankfurt"
    capability: string;       // "web_search"
    depends_on?: number;      // Task index this depends on (for ordering)
  }>;

  // Only if clarification needed
  question?: string;          // "Which city should I test against?"

  // Confidence for logging/debugging
  confidence: 'high' | 'medium' | 'low';
}
```

### Why This Works

- LLM is good at understanding "this is about weather" → `needs.web_search: true`
- Forced schema prevents "I can't do that" responses
- Task breakdown enables multi-step execution
- `clarification: true` is the ONLY way to ask user - prevents over-asking

---

## Component 2: Router (Deterministic Code)

**Purpose:** Read capability flags, invoke the right agents. Pure TypeScript, no LLM.

### Core Logic

```typescript
async function routeRequest(
  analysis: CapabilityAnalysis,
  userMessage: string,
  context: SessionContext
): Promise<AgentResult> {

  // 1. Handle clarification first
  if (analysis.needs.clarification) {
    return { type: 'question', question: analysis.question };
  }

  // 2. Map capabilities to agents
  const agentTasks = mapCapabilitiesToAgents(analysis);
  // web_search → SCOUT
  // code_read, code_write → KODA
  // devops → DEVO

  // 3. Execute in dependency order
  const results = new Map<number, AgentResult>();

  for (const task of topologicalSort(analysis.tasks)) {
    const agent = agentTasks.get(task.capability);
    const dependencyResults = getDependencyResults(task, results);

    const result = await agent.execute(task, dependencyResults);
    results.set(task.index, result);

    // Agent signals uncertainty? Ask user, don't guess
    if (result.uncertain) {
      return { type: 'question', question: result.uncertaintyReason };
    }
  }

  // 4. Combine results into response
  return combineResults(results, analysis);
}
```

### Key Guarantees

- If `needs.web_search: true`, SCOUT **will** run - no LLM deciding otherwise
- Task dependencies respected (read code before comparing to web result)
- Any agent can signal uncertainty → user gets asked
- No silent failures - every capability flag triggers an action

---

## Component 3: Executor Agents

**Purpose:** Execute specific tasks with specialized tools. No routing decisions.

### Agent Interface

```typescript
interface ExecutorAgent {
  name: 'koda' | 'devo' | 'scout';
  capabilities: string[];           // What this agent handles
  tools: string[];                  // Tools available to this agent

  execute(
    task: Task,
    dependencyResults: Map<number, AgentResult>,
    context: SessionContext
  ): Promise<AgentResult>;
}
```

### SCOUT (Explorer)
- **Capabilities:** `web_search`, `web_fetch`, `codebase_search`
- **Tools:** `web_search`, `web_fetch`, `fs_glob`, `fs_grep`, `fs_readFile`
- **Behavior:** Search/read, return structured findings
- **Can signal:** "Search returned no results for X - should I try different terms?"

### KODA (Developer)
- **Capabilities:** `code_read`, `code_write`
- **Tools:** `fs_readFile`, `fs_writeFile`, `fs_edit`, `fs_glob`, `git_diff`
- **Behavior:** Read, understand, modify code
- **Can signal:** "Found 3 files matching 'weather'. Which one?"

### DEVO (DevOps)
- **Capabilities:** `devops`
- **Tools:** `git_*`, `npm_*`, `pm2_*`, `bash_execute`
- **Behavior:** Run commands, manage processes
- **Can signal:** "This will restart production. Confirm?"

### Uncertainty Signaling

Each agent can return `{ uncertain: true, reason: "..." }` when:
- Multiple valid options exist
- Action is risky/destructive
- Results are ambiguous

This bubbles up to the user - no guessing.

---

## Component 4: CHAPO's New Role

**Old Role:** Coordinator that decides everything (unreliable)

**New Role:** Capability Analyzer + Response Synthesizer

### Job 1: Analyze (Start of request)

```typescript
async function analyzeRequest(userMessage: string): Promise<CapabilityAnalysis> {
  const response = await llm.generate({
    model: 'claude-haiku',  // Fast, cheap - just classification
    systemPrompt: ANALYZER_PROMPT,
    userMessage,
    responseFormat: 'json',  // Forced structured output
    schema: CapabilityAnalysisSchema
  });

  return response;
}
```

### Job 2: Synthesize (End of request)

```typescript
async function synthesizeResponse(
  originalRequest: string,
  agentResults: Map<number, AgentResult>
): Promise<string> {
  // Combine agent outputs into coherent user response
  const response = await llm.generate({
    model: 'claude-sonnet',  // Better quality for user-facing text
    systemPrompt: SYNTHESIZER_PROMPT,
    context: { originalRequest, results: agentResults }
  });

  return response;
}
```

### What CHAPO No Longer Does

- ❌ Decide whether to delegate
- ❌ Choose which agent handles what
- ❌ Execute tools directly
- ❌ Ask unnecessary clarifying questions

---

## Error Handling & Fallbacks

**Principle:** Fail clearly, never silently.

### Layer 1: Capability Analyzer Fails

```typescript
// If analyzer returns invalid JSON or errors
if (!isValidAnalysis(analysis)) {
  // Fallback: Simple keyword detection
  const fallbackAnalysis = keywordFallback(userMessage);
  // "weather" → needs.web_search = true
  // "edit", "create" → needs.code_write = true
}
```

### Layer 2: Agent Execution Fails

```typescript
try {
  result = await agent.execute(task);
} catch (error) {
  // Don't hide it - tell the user clearly
  return {
    type: 'error',
    message: `${agent.name} couldn't complete "${task.description}": ${error.message}`,
    suggestion: 'Try rephrasing or breaking into smaller steps'
  };
}
```

### Layer 3: Tool Fails

```typescript
// Inside agent execution
const toolResult = await executeTool(toolName, args);

if (!toolResult.success) {
  // Agent decides: retry, skip, or signal uncertainty
  if (isRetryable(toolResult.error)) {
    return retry(toolName, args, { attempts: 2 });
  }
  return { uncertain: true, reason: `Tool failed: ${toolResult.error}` };
}
```

### Layer 4: Timeout Protection

```typescript
const result = await Promise.race([
  routeRequest(analysis, message, context),
  timeout(30000, 'Request took too long - try a simpler task')
]);
```

### What Users See

- ✅ Clear error messages, not silent failures
- ✅ Suggestions for recovery
- ✅ Ability to retry or rephrase
- ❌ Never "I can't do that" when we actually can

---

## Migration Path

Incremental migration to avoid breaking existing functionality:

### Phase 1: Add Capability Analyzer
- Create new `analyzer.ts` alongside existing router
- Run analyzer in parallel with old CHAPO qualification
- Log comparison: does analyzer correctly identify capabilities?
- No behavior change yet

### Phase 2: Add Deterministic Router
- Create new `deterministicRouter.ts`
- Use analyzer output to route
- Keep old routing as fallback if analyzer confidence is low
- A/B test: new router vs old router

### Phase 3: Simplify Agents
- Remove delegation logic from agents
- Agents become pure executors
- Add uncertainty signaling

### Phase 4: Full Switch
- Remove old delegation meta-tools (delegateToScout, etc.)
- Remove old CHAPO qualification logic
- New architecture is primary

---

## Benefits

| Aspect | Old | New |
|--------|-----|-----|
| Routing reliability | LLM decides (unreliable) | Code routes (deterministic) |
| Silent failures | "I can't do that" | Never - always routes or asks |
| Speed | Full LLM call for routing | Haiku classification + parallel execution |
| Cost | Multiple Opus calls | Haiku for analysis, Sonnet for synthesis |
| Debugging | Black box LLM decisions | Clear capability flags, deterministic routing |
| User experience | Unpredictable | Consistent, asks only when uncertain |

---

## Files to Create/Modify

### New Files
- `apps/api/src/agents/analyzer.ts` - Capability Analyzer
- `apps/api/src/agents/deterministicRouter.ts` - Code-based router
- `apps/api/src/agents/synthesizer.ts` - Response combiner

### Modify
- `apps/api/src/agents/router.ts` - Integrate new components
- `apps/api/src/agents/koda.ts` - Simplify to executor
- `apps/api/src/agents/devo.ts` - Simplify to executor
- `apps/api/src/agents/scout.ts` - Simplify to executor
- `apps/api/src/agents/chapo.ts` - Redefine as analyzer/synthesizer

### Remove (Phase 4)
- Delegation meta-tools from `chapo.ts`
- Old qualification logic from `router.ts`
