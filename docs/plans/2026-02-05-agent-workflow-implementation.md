# Agent Workflow Redesign - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace unreliable LLM-based routing with deterministic capability-based routing.

**Architecture:** Capability Analyzer (forced JSON from Haiku) identifies what's needed, pure TypeScript Router maps capabilities to agents, Executor Agents do the work.

**Tech Stack:** TypeScript, Vitest, Zod (schema validation), existing LLM router

---

## Phase 1: Capability Analyzer

### Task 1: Define CapabilityAnalysis Types

**Files:**
- Create: `apps/api/src/agents/analyzer/types.ts`

**Step 1: Create the types file**

```typescript
// apps/api/src/agents/analyzer/types.ts
import { z } from 'zod';

/**
 * Capability flags - what the request needs
 */
export const CapabilityNeedsSchema = z.object({
  web_search: z.boolean().describe('Needs current info from web (weather, docs, news)'),
  code_read: z.boolean().describe('Needs to read/understand existing code'),
  code_write: z.boolean().describe('Needs to create or modify files'),
  devops: z.boolean().describe('Needs git, npm, pm2, deployment operations'),
  clarification: z.boolean().describe('Request is genuinely ambiguous, must ask user'),
});

export type CapabilityNeeds = z.infer<typeof CapabilityNeedsSchema>;

/**
 * Individual task in the breakdown
 */
export const TaskBreakdownSchema = z.object({
  description: z.string().describe('What this task does'),
  capability: z.enum(['web_search', 'code_read', 'code_write', 'devops']),
  depends_on: z.number().optional().describe('Index of task this depends on'),
});

export type TaskBreakdown = z.infer<typeof TaskBreakdownSchema>;

/**
 * Full capability analysis output
 */
export const CapabilityAnalysisSchema = z.object({
  needs: CapabilityNeedsSchema,
  tasks: z.array(TaskBreakdownSchema).min(1),
  question: z.string().optional().describe('Only if clarification needed'),
  confidence: z.enum(['high', 'medium', 'low']),
});

export type CapabilityAnalysis = z.infer<typeof CapabilityAnalysisSchema>;

/**
 * Result from analyzer (includes raw response for debugging)
 */
export interface AnalyzerResult {
  analysis: CapabilityAnalysis;
  rawResponse: string;
  model: string;
  durationMs: number;
}
```

**Step 2: Run typecheck to verify**

Run: `cd /opt/Klyde/projects/Devai/apps/api && npm run typecheck`
Expected: No errors related to new types

**Step 3: Commit**

```bash
git add apps/api/src/agents/analyzer/types.ts
git commit -m "feat(agents): add CapabilityAnalysis types with Zod schemas"
```

---

### Task 2: Create Analyzer Prompt

**Files:**
- Create: `apps/api/src/agents/analyzer/prompt.ts`

**Step 1: Create the prompt file**

```typescript
// apps/api/src/agents/analyzer/prompt.ts

export const ANALYZER_SYSTEM_PROMPT = `You are a capability analyzer. Your ONLY job is to analyze user requests and output structured JSON.

You MUST output valid JSON matching this exact schema:
{
  "needs": {
    "web_search": boolean,   // true if request needs current web info (weather, docs, news, external APIs)
    "code_read": boolean,    // true if request needs to read/understand existing code
    "code_write": boolean,   // true if request needs to create or modify files
    "devops": boolean,       // true if request needs git, npm, pm2, deployment
    "clarification": boolean // true ONLY if request is genuinely ambiguous
  },
  "tasks": [
    {
      "description": "What this specific task does",
      "capability": "web_search" | "code_read" | "code_write" | "devops",
      "depends_on": optional number (index of task this depends on)
    }
  ],
  "question": "Only include if clarification is true",
  "confidence": "high" | "medium" | "low"
}

RULES:
1. ALWAYS output valid JSON - nothing else
2. Set clarification: true ONLY for genuinely ambiguous requests
3. Break complex requests into multiple tasks with dependencies
4. Be generous with capabilities - if in doubt, set to true
5. Order tasks by dependency (independent tasks first)

EXAMPLES:

User: "What's the weather in Frankfurt?"
{
  "needs": { "web_search": true, "code_read": false, "code_write": false, "devops": false, "clarification": false },
  "tasks": [{ "description": "Search web for current weather in Frankfurt", "capability": "web_search" }],
  "confidence": "high"
}

User: "Check if my weather function returns correct data"
{
  "needs": { "web_search": true, "code_read": true, "code_write": false, "devops": false, "clarification": false },
  "tasks": [
    { "description": "Read the weather function code", "capability": "code_read" },
    { "description": "Fetch actual weather data for comparison", "capability": "web_search", "depends_on": 0 }
  ],
  "confidence": "high"
}

User: "Fix the bug"
{
  "needs": { "web_search": false, "code_read": false, "code_write": false, "devops": false, "clarification": true },
  "tasks": [{ "description": "Clarify which bug to fix", "capability": "code_read" }],
  "question": "Which bug should I fix? Can you describe the issue or point me to the file?",
  "confidence": "low"
}`;

export const ANALYZER_USER_TEMPLATE = (userMessage: string, projectContext?: string): string => {
  let prompt = `Analyze this request:\n\n${userMessage}`;

  if (projectContext) {
    prompt += `\n\nProject context:\n${projectContext}`;
  }

  return prompt;
};
```

**Step 2: Run typecheck**

Run: `cd /opt/Klyde/projects/Devai/apps/api && npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/api/src/agents/analyzer/prompt.ts
git commit -m "feat(agents): add capability analyzer system prompt"
```

---

### Task 3: Implement Capability Analyzer

**Files:**
- Create: `apps/api/src/agents/analyzer/index.ts`
- Test: `apps/api/src/agents/analyzer/analyzer.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/api/src/agents/analyzer/analyzer.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeRequest } from './index.js';
import { llmRouter } from '../../llm/router.js';

vi.mock('../../llm/router.js', () => ({
  llmRouter: {
    generate: vi.fn(),
  },
}));

describe('Capability Analyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('analyzes web search request correctly', async () => {
    vi.mocked(llmRouter.generate).mockResolvedValueOnce({
      content: JSON.stringify({
        needs: { web_search: true, code_read: false, code_write: false, devops: false, clarification: false },
        tasks: [{ description: 'Search for weather', capability: 'web_search' }],
        confidence: 'high',
      }),
      finishReason: 'stop',
    });

    const result = await analyzeRequest('What is the weather in Berlin?');

    expect(result.analysis.needs.web_search).toBe(true);
    expect(result.analysis.needs.code_read).toBe(false);
    expect(result.analysis.tasks).toHaveLength(1);
    expect(result.analysis.tasks[0].capability).toBe('web_search');
  });

  it('analyzes code change request correctly', async () => {
    vi.mocked(llmRouter.generate).mockResolvedValueOnce({
      content: JSON.stringify({
        needs: { web_search: false, code_read: true, code_write: true, devops: false, clarification: false },
        tasks: [
          { description: 'Read existing code', capability: 'code_read' },
          { description: 'Modify the file', capability: 'code_write', depends_on: 0 },
        ],
        confidence: 'high',
      }),
      finishReason: 'stop',
    });

    const result = await analyzeRequest('Add error handling to the login function');

    expect(result.analysis.needs.code_read).toBe(true);
    expect(result.analysis.needs.code_write).toBe(true);
    expect(result.analysis.tasks).toHaveLength(2);
  });

  it('handles clarification requests', async () => {
    vi.mocked(llmRouter.generate).mockResolvedValueOnce({
      content: JSON.stringify({
        needs: { web_search: false, code_read: false, code_write: false, devops: false, clarification: true },
        tasks: [{ description: 'Clarify request', capability: 'code_read' }],
        question: 'Which file should I modify?',
        confidence: 'low',
      }),
      finishReason: 'stop',
    });

    const result = await analyzeRequest('Fix it');

    expect(result.analysis.needs.clarification).toBe(true);
    expect(result.analysis.question).toBe('Which file should I modify?');
  });

  it('falls back to keyword detection on invalid JSON', async () => {
    vi.mocked(llmRouter.generate).mockResolvedValueOnce({
      content: 'Sorry, I cannot help with that.',
      finishReason: 'stop',
    });

    const result = await analyzeRequest('What is the weather in Frankfurt?');

    // Fallback should detect "weather" and set web_search
    expect(result.analysis.needs.web_search).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /opt/Klyde/projects/Devai/apps/api && npm test -- analyzer.test.ts`
Expected: FAIL with "Cannot find module './index.js'"

**Step 3: Implement the analyzer**

```typescript
// apps/api/src/agents/analyzer/index.ts
import { llmRouter } from '../../llm/router.js';
import { CapabilityAnalysisSchema, type CapabilityAnalysis, type AnalyzerResult } from './types.js';
import { ANALYZER_SYSTEM_PROMPT, ANALYZER_USER_TEMPLATE } from './prompt.js';

/**
 * Analyze a user request to determine required capabilities
 */
export async function analyzeRequest(
  userMessage: string,
  projectContext?: string
): Promise<AnalyzerResult> {
  const start = Date.now();

  try {
    const response = await llmRouter.generate('anthropic', {
      model: 'claude-3-5-haiku-20241022', // Fast, cheap model for classification
      messages: [
        { role: 'user', content: ANALYZER_USER_TEMPLATE(userMessage, projectContext) },
      ],
      systemPrompt: ANALYZER_SYSTEM_PROMPT,
      maxTokens: 1024,
    });

    const analysis = parseAnalysisResponse(response.content, userMessage);

    return {
      analysis,
      rawResponse: response.content,
      model: 'claude-3-5-haiku-20241022',
      durationMs: Date.now() - start,
    };
  } catch (error) {
    console.error('[analyzer] LLM call failed, using fallback', error);

    return {
      analysis: keywordFallback(userMessage),
      rawResponse: '',
      model: 'fallback',
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Parse and validate the LLM response
 */
function parseAnalysisResponse(content: string, originalMessage: string): CapabilityAnalysis {
  try {
    // Try to extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[analyzer] No JSON found in response, using fallback');
      return keywordFallback(originalMessage);
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const validated = CapabilityAnalysisSchema.parse(parsed);
    return validated;
  } catch (error) {
    console.warn('[analyzer] Failed to parse response, using fallback', error);
    return keywordFallback(originalMessage);
  }
}

/**
 * Fallback keyword-based analysis when LLM fails
 */
export function keywordFallback(message: string): CapabilityAnalysis {
  const lower = message.toLowerCase();

  const needs = {
    web_search: /weather|news|current|latest|search|find online|documentation|tutorial|how to/i.test(message),
    code_read: /read|show|display|what is|explain|understand|analyze|review|check/i.test(message),
    code_write: /create|write|add|edit|modify|change|fix|update|implement|refactor/i.test(message),
    devops: /git|commit|push|pull|deploy|npm|install|pm2|restart|build|run/i.test(message),
    clarification: false,
  };

  // Determine primary capability for task
  let capability: 'web_search' | 'code_read' | 'code_write' | 'devops' = 'code_read';
  if (needs.web_search) capability = 'web_search';
  else if (needs.code_write) capability = 'code_write';
  else if (needs.devops) capability = 'devops';

  return {
    needs,
    tasks: [{ description: message, capability }],
    confidence: 'low',
  };
}

export * from './types.js';
```

**Step 4: Run tests to verify they pass**

Run: `cd /opt/Klyde/projects/Devai/apps/api && npm test -- analyzer.test.ts`
Expected: All 4 tests PASS

**Step 5: Commit**

```bash
git add apps/api/src/agents/analyzer/
git commit -m "feat(agents): implement capability analyzer with fallback"
```

---

## Phase 2: Deterministic Router

### Task 4: Define Router Types

**Files:**
- Create: `apps/api/src/agents/deterministicRouter/types.ts`

**Step 1: Create the types file**

```typescript
// apps/api/src/agents/deterministicRouter/types.ts
import type { AgentName } from '../types.js';
import type { CapabilityAnalysis, TaskBreakdown } from '../analyzer/types.js';

/**
 * Result from an agent execution
 */
export interface AgentExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  uncertain?: boolean;
  uncertaintyReason?: string;
}

/**
 * Task with assigned agent
 */
export interface AssignedTask extends TaskBreakdown {
  index: number;
  agent: AgentName;
}

/**
 * Full routing result
 */
export interface RoutingResult {
  type: 'execute' | 'question' | 'error';
  // For execute
  tasks?: AssignedTask[];
  // For question
  question?: string;
  // For error
  error?: string;
}

/**
 * Result after executing all tasks
 */
export interface ExecutionResult {
  type: 'success' | 'question' | 'error';
  results?: Map<number, AgentExecutionResult>;
  question?: string;
  error?: string;
}

/**
 * Capability to agent mapping
 */
export const CAPABILITY_AGENT_MAP: Record<string, AgentName> = {
  web_search: 'scout',
  code_read: 'koda',
  code_write: 'koda',
  devops: 'devo',
};
```

**Step 2: Run typecheck**

Run: `cd /opt/Klyde/projects/Devai/apps/api && npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/api/src/agents/deterministicRouter/types.ts
git commit -m "feat(agents): add deterministic router types"
```

---

### Task 5: Implement Deterministic Router

**Files:**
- Create: `apps/api/src/agents/deterministicRouter/index.ts`
- Test: `apps/api/src/agents/deterministicRouter/router.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/api/src/agents/deterministicRouter/router.test.ts
import { describe, expect, it } from 'vitest';
import { routeAnalysis, topologicalSort } from './index.js';
import type { CapabilityAnalysis } from '../analyzer/types.js';

describe('Deterministic Router', () => {
  it('routes web_search to scout', () => {
    const analysis: CapabilityAnalysis = {
      needs: { web_search: true, code_read: false, code_write: false, devops: false, clarification: false },
      tasks: [{ description: 'Search weather', capability: 'web_search' }],
      confidence: 'high',
    };

    const result = routeAnalysis(analysis);

    expect(result.type).toBe('execute');
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks![0].agent).toBe('scout');
  });

  it('routes code_write to koda', () => {
    const analysis: CapabilityAnalysis = {
      needs: { web_search: false, code_read: true, code_write: true, devops: false, clarification: false },
      tasks: [
        { description: 'Read file', capability: 'code_read' },
        { description: 'Edit file', capability: 'code_write', depends_on: 0 },
      ],
      confidence: 'high',
    };

    const result = routeAnalysis(analysis);

    expect(result.type).toBe('execute');
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks![0].agent).toBe('koda');
    expect(result.tasks![1].agent).toBe('koda');
  });

  it('routes devops to devo', () => {
    const analysis: CapabilityAnalysis = {
      needs: { web_search: false, code_read: false, code_write: false, devops: true, clarification: false },
      tasks: [{ description: 'Git push', capability: 'devops' }],
      confidence: 'high',
    };

    const result = routeAnalysis(analysis);

    expect(result.type).toBe('execute');
    expect(result.tasks![0].agent).toBe('devo');
  });

  it('returns question when clarification needed', () => {
    const analysis: CapabilityAnalysis = {
      needs: { web_search: false, code_read: false, code_write: false, devops: false, clarification: true },
      tasks: [{ description: 'Unclear', capability: 'code_read' }],
      question: 'What file?',
      confidence: 'low',
    };

    const result = routeAnalysis(analysis);

    expect(result.type).toBe('question');
    expect(result.question).toBe('What file?');
  });

  it('sorts tasks by dependency', () => {
    const tasks = [
      { index: 0, description: 'A', capability: 'code_read' as const, agent: 'koda' as const },
      { index: 1, description: 'B', capability: 'code_write' as const, depends_on: 2, agent: 'koda' as const },
      { index: 2, description: 'C', capability: 'web_search' as const, depends_on: 0, agent: 'scout' as const },
    ];

    const sorted = topologicalSort(tasks);

    // A (0) must come before C (2), C must come before B (1)
    const indexOrder = sorted.map(t => t.index);
    expect(indexOrder.indexOf(0)).toBeLessThan(indexOrder.indexOf(2));
    expect(indexOrder.indexOf(2)).toBeLessThan(indexOrder.indexOf(1));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /opt/Klyde/projects/Devai/apps/api && npm test -- router.test.ts`
Expected: FAIL with "Cannot find module './index.js'"

**Step 3: Implement the router**

```typescript
// apps/api/src/agents/deterministicRouter/index.ts
import type { CapabilityAnalysis } from '../analyzer/types.js';
import type { AssignedTask, RoutingResult } from './types.js';
import { CAPABILITY_AGENT_MAP } from './types.js';

/**
 * Route a capability analysis to agents
 * This is pure code - no LLM involved
 */
export function routeAnalysis(analysis: CapabilityAnalysis): RoutingResult {
  // 1. Handle clarification first
  if (analysis.needs.clarification && analysis.question) {
    return {
      type: 'question',
      question: analysis.question,
    };
  }

  // 2. Map tasks to agents
  const assignedTasks: AssignedTask[] = analysis.tasks.map((task, index) => ({
    ...task,
    index,
    agent: CAPABILITY_AGENT_MAP[task.capability] || 'koda', // Default to koda
  }));

  // 3. Sort by dependencies
  const sortedTasks = topologicalSort(assignedTasks);

  return {
    type: 'execute',
    tasks: sortedTasks,
  };
}

/**
 * Topological sort for task dependencies
 */
export function topologicalSort(tasks: AssignedTask[]): AssignedTask[] {
  const sorted: AssignedTask[] = [];
  const visited = new Set<number>();
  const visiting = new Set<number>();

  const taskMap = new Map(tasks.map(t => [t.index, t]));

  function visit(task: AssignedTask) {
    if (visited.has(task.index)) return;
    if (visiting.has(task.index)) {
      throw new Error(`Circular dependency detected at task ${task.index}`);
    }

    visiting.add(task.index);

    // Visit dependency first
    if (task.depends_on !== undefined) {
      const dep = taskMap.get(task.depends_on);
      if (dep) visit(dep);
    }

    visiting.delete(task.index);
    visited.add(task.index);
    sorted.push(task);
  }

  for (const task of tasks) {
    visit(task);
  }

  return sorted;
}

export * from './types.js';
```

**Step 4: Run tests to verify they pass**

Run: `cd /opt/Klyde/projects/Devai/apps/api && npm test -- router.test.ts`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add apps/api/src/agents/deterministicRouter/
git commit -m "feat(agents): implement deterministic router with topological sort"
```

---

## Phase 3: Response Synthesizer

### Task 6: Create Response Synthesizer

**Files:**
- Create: `apps/api/src/agents/synthesizer/index.ts`
- Create: `apps/api/src/agents/synthesizer/prompt.ts`

**Step 1: Create the prompt file**

```typescript
// apps/api/src/agents/synthesizer/prompt.ts

export const SYNTHESIZER_SYSTEM_PROMPT = `You are a response synthesizer. Your job is to combine results from multiple agents into a single, coherent response for the user.

RULES:
1. Be concise and direct
2. If results include data (weather, code, etc.), present it clearly
3. If any task failed, explain what went wrong
4. Use German language for responses
5. Don't mention internal agent names (SCOUT, KODA, DEVO) to the user
6. Format code blocks with proper syntax highlighting

Your response should feel like it came from a single helpful assistant, not multiple agents.`;

export const SYNTHESIZER_USER_TEMPLATE = (
  originalRequest: string,
  results: Array<{ task: string; success: boolean; data?: unknown; error?: string }>
): string => {
  const resultsText = results
    .map((r, i) => `Task ${i + 1}: ${r.task}\nSuccess: ${r.success}\n${r.success ? `Result: ${JSON.stringify(r.data)}` : `Error: ${r.error}`}`)
    .join('\n\n');

  return `Original request: ${originalRequest}

Agent results:
${resultsText}

Synthesize these results into a helpful response for the user.`;
};
```

**Step 2: Create the synthesizer**

```typescript
// apps/api/src/agents/synthesizer/index.ts
import { llmRouter } from '../../llm/router.js';
import { SYNTHESIZER_SYSTEM_PROMPT, SYNTHESIZER_USER_TEMPLATE } from './prompt.js';
import type { AgentExecutionResult } from '../deterministicRouter/types.js';
import type { AssignedTask } from '../deterministicRouter/types.js';

export interface SynthesizerInput {
  originalRequest: string;
  tasks: AssignedTask[];
  results: Map<number, AgentExecutionResult>;
}

/**
 * Synthesize agent results into a user-facing response
 */
export async function synthesizeResponse(input: SynthesizerInput): Promise<string> {
  const { originalRequest, tasks, results } = input;

  // If only one successful result with simple data, return directly
  if (tasks.length === 1 && results.size === 1) {
    const result = results.get(0);
    if (result?.success && typeof result.data === 'string') {
      return result.data;
    }
  }

  // Prepare results for synthesis
  const resultsArray = tasks.map((task) => {
    const result = results.get(task.index);
    return {
      task: task.description,
      success: result?.success ?? false,
      data: result?.data,
      error: result?.error,
    };
  });

  // Check if all failed
  const allFailed = resultsArray.every(r => !r.success);
  if (allFailed) {
    const errors = resultsArray.map(r => r.error).filter(Boolean).join(', ');
    return `Es ist ein Fehler aufgetreten: ${errors}`;
  }

  try {
    const response = await llmRouter.generate('anthropic', {
      model: 'claude-sonnet-4-20250514',
      messages: [
        { role: 'user', content: SYNTHESIZER_USER_TEMPLATE(originalRequest, resultsArray) },
      ],
      systemPrompt: SYNTHESIZER_SYSTEM_PROMPT,
      maxTokens: 2048,
    });

    return response.content;
  } catch (error) {
    // Fallback: return raw results
    console.error('[synthesizer] LLM failed, returning raw results', error);
    return resultsArray
      .filter(r => r.success)
      .map(r => `${r.task}: ${JSON.stringify(r.data)}`)
      .join('\n\n');
  }
}
```

**Step 3: Run typecheck**

Run: `cd /opt/Klyde/projects/Devai/apps/api && npm run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add apps/api/src/agents/synthesizer/
git commit -m "feat(agents): add response synthesizer"
```

---

## Phase 4: Integration

### Task 7: Create New Process Request Function

**Files:**
- Create: `apps/api/src/agents/newRouter.ts`

**Step 1: Create the integrated router**

```typescript
// apps/api/src/agents/newRouter.ts
/**
 * New Agent Router - Capability-based routing
 *
 * Flow: Analyze → Route → Execute → Synthesize
 */

import { analyzeRequest } from './analyzer/index.js';
import { routeAnalysis, topologicalSort } from './deterministicRouter/index.js';
import { synthesizeResponse } from './synthesizer/index.js';
import type { AssignedTask, AgentExecutionResult } from './deterministicRouter/types.js';
import type { SendEventFn } from './router.js';
import { executeAgentTask } from './executor.js';

export interface NewProcessRequestOptions {
  sessionId: string;
  userMessage: string;
  projectRoot: string | null;
  sendEvent: SendEventFn;
}

/**
 * Process a user request through the new capability-based system
 */
export async function processRequestNew(options: NewProcessRequestOptions): Promise<string> {
  const { sessionId, userMessage, projectRoot, sendEvent } = options;

  console.info('[newRouter] Processing request', { sessionId, messageLength: userMessage.length });

  // Phase 1: Analyze
  sendEvent({ type: 'agent_thinking', agent: 'chapo', status: 'Analysiere Anfrage...' });

  const analyzerResult = await analyzeRequest(userMessage, projectRoot || undefined);

  console.info('[newRouter] Analysis complete', {
    needs: analyzerResult.analysis.needs,
    taskCount: analyzerResult.analysis.tasks.length,
    confidence: analyzerResult.analysis.confidence,
    model: analyzerResult.model,
    durationMs: analyzerResult.durationMs,
  });

  // Phase 2: Route
  const routing = routeAnalysis(analyzerResult.analysis);

  // Handle clarification
  if (routing.type === 'question') {
    sendEvent({ type: 'user_question', question: { questionId: sessionId, question: routing.question!, fromAgent: 'chapo', timestamp: new Date().toISOString() } });
    return routing.question!;
  }

  // Handle error
  if (routing.type === 'error') {
    sendEvent({ type: 'error', agent: 'chapo', error: routing.error! });
    return `Fehler: ${routing.error}`;
  }

  // Phase 3: Execute tasks
  const tasks = routing.tasks!;
  const results = new Map<number, AgentExecutionResult>();

  for (const task of tasks) {
    sendEvent({
      type: 'agent_start',
      agent: task.agent,
      phase: 'execution'
    });
    sendEvent({
      type: 'agent_thinking',
      agent: task.agent,
      status: task.description
    });

    // Get dependency results
    const dependencyData = task.depends_on !== undefined
      ? results.get(task.depends_on)?.data
      : undefined;

    try {
      const result = await executeAgentTask(task, dependencyData, {
        sessionId,
        projectRoot,
        sendEvent,
      });

      results.set(task.index, result);

      // If agent signals uncertainty, ask user
      if (result.uncertain) {
        sendEvent({
          type: 'user_question',
          question: {
            questionId: `${sessionId}-${task.index}`,
            question: result.uncertaintyReason!,
            fromAgent: task.agent,
            timestamp: new Date().toISOString()
          }
        });
        return result.uncertaintyReason!;
      }

      sendEvent({ type: 'agent_complete', agent: task.agent, result: 'done' });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      results.set(task.index, { success: false, error: errorMsg });
      sendEvent({ type: 'error', agent: task.agent, error: errorMsg });
    }
  }

  // Phase 4: Synthesize
  sendEvent({ type: 'agent_thinking', agent: 'chapo', status: 'Erstelle Antwort...' });

  const response = await synthesizeResponse({
    originalRequest: userMessage,
    tasks,
    results,
  });

  sendEvent({ type: 'agent_complete', agent: 'chapo', result: response });

  return response;
}
```

**Step 2: Run typecheck**

Run: `cd /opt/Klyde/projects/Devai/apps/api && npm run typecheck`
Expected: Error about missing `executeAgentTask` - this is expected, we'll create it next

**Step 3: Commit**

```bash
git add apps/api/src/agents/newRouter.ts
git commit -m "feat(agents): add new capability-based router (WIP)"
```

---

### Task 8: Create Agent Task Executor

**Files:**
- Create: `apps/api/src/agents/executor.ts`

**Step 1: Create the executor**

```typescript
// apps/api/src/agents/executor.ts
/**
 * Agent Task Executor
 *
 * Executes individual tasks using the appropriate agent's tools
 */

import type { AssignedTask, AgentExecutionResult } from './deterministicRouter/types.js';
import type { SendEventFn } from './router.js';
import { executeTool } from '../tools/executor.js';
import { getToolsForLLM } from '../tools/registry.js';
import { llmRouter } from '../llm/router.js';
import { getAgent, getToolsForAgent } from './router.js';
import type { LLMMessage } from '../llm/types.js';

export interface ExecuteTaskOptions {
  sessionId: string;
  projectRoot: string | null;
  sendEvent: SendEventFn;
}

/**
 * Execute a single task using the assigned agent
 */
export async function executeAgentTask(
  task: AssignedTask,
  dependencyData: unknown,
  options: ExecuteTaskOptions
): Promise<AgentExecutionResult> {
  const { sessionId, projectRoot, sendEvent } = options;
  const agent = getAgent(task.agent);
  const agentToolNames = getToolsForAgent(task.agent);
  const tools = getToolsForLLM().filter(t => agentToolNames.includes(t.name));

  // Build focused prompt for this specific task
  const taskPrompt = buildTaskPrompt(task, dependencyData, projectRoot);

  const messages: LLMMessage[] = [
    { role: 'user', content: taskPrompt },
  ];

  // Run agent with tool use
  let turn = 0;
  const MAX_TURNS = 5;
  let finalResult: unknown = null;

  while (turn < MAX_TURNS) {
    turn++;

    const response = await llmRouter.generate('anthropic', {
      model: agent.model,
      messages,
      systemPrompt: agent.systemPrompt,
      tools,
      toolsEnabled: true,
    });

    // No more tool calls - we're done
    if (!response.toolCalls || response.toolCalls.length === 0) {
      finalResult = response.content;
      break;
    }

    // Add assistant message
    messages.push({
      role: 'assistant',
      content: response.content || '',
      toolCalls: response.toolCalls,
    });

    // Execute tools
    const toolResults: { toolUseId: string; result: string; isError: boolean }[] = [];

    for (const toolCall of response.toolCalls) {
      sendEvent({
        type: 'tool_call',
        agent: task.agent,
        toolName: toolCall.name,
        args: toolCall.arguments,
      });

      const result = await executeTool(toolCall.name, toolCall.arguments);

      sendEvent({
        type: 'tool_result',
        agent: task.agent,
        toolName: toolCall.name,
        result: result.result,
        success: result.success,
      });

      toolResults.push({
        toolUseId: toolCall.id,
        result: result.success ? JSON.stringify(result.result) : `Error: ${result.error}`,
        isError: !result.success,
      });

      // Store successful result
      if (result.success) {
        finalResult = result.result;
      }
    }

    // Add tool results
    messages.push({
      role: 'user',
      content: '',
      toolResults,
    });
  }

  return {
    success: true,
    data: finalResult,
  };
}

function buildTaskPrompt(
  task: AssignedTask,
  dependencyData: unknown,
  projectRoot: string | null
): string {
  let prompt = `TASK: ${task.description}`;

  if (dependencyData) {
    prompt += `\n\nContext from previous task:\n${JSON.stringify(dependencyData, null, 2)}`;
  }

  if (projectRoot) {
    prompt += `\n\nWorking directory: ${projectRoot}`;
  }

  prompt += '\n\nExecute this task directly. Do not ask questions unless absolutely necessary.';

  return prompt;
}
```

**Step 2: Run typecheck**

Run: `cd /opt/Klyde/projects/Devai/apps/api && npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/api/src/agents/executor.ts
git commit -m "feat(agents): add agent task executor"
```

---

### Task 9: Add Feature Flag and Integration

**Files:**
- Modify: `apps/api/src/agents/router.ts`
- Modify: `apps/api/src/config.ts`

**Step 1: Add feature flag to config**

Check current config structure first, then add:

```typescript
// Add to apps/api/src/config.ts

// Feature flags
useNewAgentRouter: process.env.USE_NEW_AGENT_ROUTER === 'true',
```

**Step 2: Modify router.ts to use new router when flag is enabled**

Add at the top of `processRequest` function in `apps/api/src/agents/router.ts`:

```typescript
// At the start of processRequest function, add:
import { processRequestNew } from './newRouter.js';
import { config } from '../config.js';

// Inside processRequest, before existing code:
if (config.useNewAgentRouter) {
  console.info('[agents] Using NEW capability-based router');
  return processRequestNew({ sessionId, userMessage, projectRoot, sendEvent });
}

// ... rest of existing code
```

**Step 3: Run typecheck**

Run: `cd /opt/Klyde/projects/Devai/apps/api && npm run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add apps/api/src/agents/router.ts apps/api/src/config.ts
git commit -m "feat(agents): add feature flag for new router"
```

---

### Task 10: Test Integration

**Step 1: Add env variable on Baso server**

```bash
ssh root@77.42.90.193 "echo 'USE_NEW_AGENT_ROUTER=true' >> /opt/shared-repos/Devai/worktree-preview/.env"
```

**Step 2: Restart API server**

```bash
ssh root@77.42.90.193 "pm2 restart devai-api-dev"
```

**Step 3: Test in browser**

1. Open https://devai.klyde.tech
2. Test: "What's the weather in Frankfurt?"
   - Expected: SCOUT runs web_search, returns weather data
3. Test: "List files in src/"
   - Expected: KODA runs fs_listFiles, returns file list
4. Test: "Fix it"
   - Expected: Asks clarifying question

**Step 4: Check logs**

```bash
ssh root@77.42.90.193 "pm2 logs devai-api-dev --lines 50 --nostream | grep newRouter"
```

Expected: See "[newRouter] Processing request" and "[newRouter] Analysis complete" logs

**Step 5: Commit if tests pass**

```bash
git add -A
git commit -m "feat(agents): new capability-based router integration complete"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | CapabilityAnalysis types | `analyzer/types.ts` |
| 2 | Analyzer prompt | `analyzer/prompt.ts` |
| 3 | Capability Analyzer | `analyzer/index.ts`, `analyzer.test.ts` |
| 4 | Router types | `deterministicRouter/types.ts` |
| 5 | Deterministic Router | `deterministicRouter/index.ts`, `router.test.ts` |
| 6 | Response Synthesizer | `synthesizer/index.ts`, `prompt.ts` |
| 7 | New Process Request | `newRouter.ts` |
| 8 | Agent Task Executor | `executor.ts` |
| 9 | Feature Flag | `router.ts`, `config.ts` |
| 10 | Integration Test | Manual testing |

**Total estimated tasks:** 10 tasks, ~30 steps

**Rollback plan:** Set `USE_NEW_AGENT_ROUTER=false` to disable new router and use old behavior.
