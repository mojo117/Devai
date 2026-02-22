# DevAI Codebase Hardening — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all critical, high, and medium-priority issues from the four-agent code review (security, resilience, architecture, code quality).

**Architecture:** Defense-in-depth for security (input validation at tool boundaries), evidence-based verification for resilience, and DRY extraction for architecture. Changes are isolated per-subsystem so tasks can be committed independently.

**Tech Stack:** TypeScript, Node.js, OpenAI/Anthropic SDKs, Fastify, ws

---

## Phase 1: Critical Security Fixes

### Task 1: Sanitize SSH host parameter

**Files:**
- Modify: `apps/api/src/tools/ssh.ts:66-78`

**Step 1: Add host validation after alias resolution**

After line 78 (`user = options?.user || 'root';`), add strict host validation:

```typescript
  } else {
    // Validate direct host: must be IP or simple hostname
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.\-]*$/.test(hostOrAlias) || hostOrAlias.includes(' ')) {
      throw new Error(`Invalid host: "${hostOrAlias}". Use a known alias (baso, klyde, infrit) or a valid hostname/IP.`);
    }
    host = hostOrAlias;
    user = options?.user || 'root';
  }
```

This rejects any host containing spaces, flags (`-o`), backticks, `$()`, semicolons, or other shell metacharacters.

**Step 2: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/tools/ssh.ts
git commit -m "security: validate SSH host parameter against injection

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Sanitize PM2 process name and lines parameters

**Files:**
- Modify: `apps/api/src/tools/pm2.ts`

**Step 1: Add a validation helper at the top of the file (after imports)**

```typescript
const VALID_PROCESS_NAME = /^[a-zA-Z0-9_-]+$/;

function validateProcessName(name: string): string {
  if (!VALID_PROCESS_NAME.test(name)) {
    throw new Error(`Invalid PM2 process name: "${name}". Only alphanumeric, dash, and underscore allowed.`);
  }
  return name;
}
```

**Step 2: Add validation to each function**

In `pm2Restart` (line 94), `pm2Stop` (line 115), `pm2Start` (line 136), and `pm2Logs` (line 157), add as the first line of each function body:

```typescript
  processName = validateProcessName(processName);
```

For `pm2Logs`, also validate `lines`:

```typescript
  processName = validateProcessName(processName);
  if (!Number.isInteger(lines) || lines < 1 || lines > 5000) {
    throw new Error(`Invalid lines parameter: ${lines}. Must be integer 1-5000.`);
  }
```

**Step 3: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/tools/pm2.ts
git commit -m "security: validate PM2 process name against command injection

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Change DEFAULT_TRUST_MODE to 'default'

**Files:**
- Modify: `apps/api/src/config/trust.ts:45`

**Step 1: Change the default**

Replace line 45:
```typescript
export const DEFAULT_TRUST_MODE: TrustMode = 'trusted';
```
With:
```typescript
export const DEFAULT_TRUST_MODE: TrustMode = 'default';
```

Update the comment on line 43-44:
```typescript
// Default: require explicit confirmations for destructive tools.
// Set to 'trusted' per-session to bypass confirmations.
```

**Step 2: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/config/trust.ts
git commit -m "security: change DEFAULT_TRUST_MODE to 'default'

Restores confirmation prompts for destructive tools (bash, ssh, fs_delete,
git_push, etc). Previously set to 'trusted' which bypassed all confirmations.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Add SSRF protection to web_fetch

**Files:**
- Modify: `apps/api/src/tools/web.ts`

**Step 1: Add private IP check function before `webFetch`**

```typescript
import { isIP } from 'node:net';
import dns from 'node:dns/promises';

const PRIVATE_IP_RANGES = [
  /^127\./,                    // loopback
  /^10\./,                     // class A private
  /^172\.(1[6-9]|2\d|3[01])\./, // class B private
  /^192\.168\./,               // class C private
  /^169\.254\./,               // link-local
  /^0\./,                      // current network
  /^::1$/,                     // IPv6 loopback
  /^fc00:/i,                   // IPv6 ULA
  /^fe80:/i,                   // IPv6 link-local
  /^fd/i,                      // IPv6 ULA
];

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_RANGES.some((range) => range.test(ip));
}

async function checkSsrf(hostname: string): Promise<void> {
  // Check if hostname is already an IP
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error(`Blocked: "${hostname}" resolves to a private/internal IP address.`);
    }
    return;
  }

  // Resolve DNS and check all addresses
  try {
    const addresses = await dns.resolve4(hostname);
    for (const addr of addresses) {
      if (isPrivateIp(addr)) {
        throw new Error(`Blocked: "${hostname}" resolves to private IP ${addr}.`);
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOTFOUND') {
      throw new Error(`DNS lookup failed for "${hostname}".`);
    }
    // For other DNS errors, allow the request (will fail at fetch level)
  }
}
```

**Step 2: Call `checkSsrf` in `webFetch` after URL validation**

After line 140 (`throw new Error('Unsupported protocol...')`), before the abort controller setup, add:

```typescript
  // SSRF protection: block private/internal IPs
  await checkSsrf(parsedUrl.hostname);
```

**Step 3: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/tools/web.ts
git commit -m "security: add SSRF protection to web_fetch

Block requests to private IP ranges (10.x, 172.16-31.x, 192.168.x,
127.x, 169.254.x, ::1, fc00::/7). Resolves DNS before checking to
prevent DNS rebinding attacks.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Phase 2: High Security Fixes

### Task 5: Add symlink resolution to filesystem path validation

**Files:**
- Modify: `apps/api/src/tools/fs.ts:79-128`

**Step 1: Add realpath check after path validation passes**

At the end of the `validatePath` function, before returning the translated path (the `return translatedPath` and `return resolved` lines), add a symlink resolution check. Find the section after line 126 where paths are returned and wrap the return in a symlink check:

After `const resolved = await resolvePathCaseInsensitive(translatedRoot, relativePart);` (line 124), replace the return with:

```typescript
        const resolved = await resolvePathCaseInsensitive(translatedRoot, relativePart);
        // Resolve symlinks and re-validate the real path
        return await validateRealPath(resolved, allowedRoots);
```

Add this helper function before `validatePath`:

```typescript
async function validateRealPath(filePath: string, allowedRoots: string[]): Promise<string> {
  try {
    const realPath = await fs.realpath(filePath);
    // Check the real path is still within allowed roots
    for (const root of allowedRoots) {
      const absoluteRoot = resolve(root);
      const translatedRoot = translatePath(absoluteRoot);
      if (realPath.startsWith(translatedRoot + '/') || realPath === translatedRoot ||
          realPath.startsWith(absoluteRoot + '/') || realPath === absoluteRoot) {
        return realPath;
      }
    }
    // Check denied paths on real path
    for (const denied of config.deniedPaths) {
      const absoluteDenied = resolve(denied);
      if (realPath.startsWith(absoluteDenied + '/') || realPath === absoluteDenied) {
        throw new Error(`Access denied: symlink target "${realPath}" is in a restricted area`);
      }
    }
    throw new Error(`Access denied: symlink target "${realPath}" is outside allowed roots`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // File doesn't exist yet (new file creation) — original path validation is sufficient
      return filePath;
    }
    throw err;
  }
}
```

**Step 2: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/tools/fs.ts
git commit -m "security: resolve symlinks before allowing filesystem access

Prevents symlink-based path traversal where a symlink inside an allowed
root points to a file outside it (e.g., /root/evil -> /etc/shadow).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Validate npm package names in bash tool

**Files:**
- Modify: `apps/api/src/tools/bash.ts`

**Step 1: Add package name validation to `npmInstall`**

Find the `npmInstall` function (around line 216). Add validation before the command is built:

```typescript
export async function npmInstall(packageName: string, ...rest: unknown[]): Promise<...> {
  // Validate package name: @scope/name@version or name@version
  const NPM_PACKAGE_RE = /^(@[a-z0-9\-~][a-z0-9\-._~]*\/)?[a-z0-9\-~][a-z0-9\-._~]*(@[^\s;|&$`'"]+)?$/;
  if (!NPM_PACKAGE_RE.test(packageName)) {
    throw new Error(`Invalid npm package name: "${packageName}". Rejected for safety.`);
  }
  // ... existing implementation
```

**Step 2: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/tools/bash.ts
git commit -m "security: validate npm package names against injection

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Phase 3: High Resilience Fixes

### Task 7: Add timeouts to LLM API clients

**Files:**
- Modify: `apps/api/src/llm/providers/zai.ts:18-21`
- Modify: `apps/api/src/llm/providers/anthropic.ts:15-23`

**Step 1: Add timeout to ZAI provider client**

In `zai.ts`, update the OpenAI client creation (around line 18):

```typescript
      this.client = new OpenAI({
        apiKey: config.zaiApiKey,
        baseURL: 'https://api.z.ai/api/coding/paas/v4',
        timeout: 60_000, // 60s request timeout
      });
```

**Step 2: Add timeout to Anthropic provider client**

In `anthropic.ts`, update the Anthropic client creation:

```typescript
      this.client = new Anthropic({
        apiKey: config.anthropicApiKey,
        timeout: 60_000, // 60s request timeout
      });
```

**Step 3: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/llm/providers/zai.ts apps/api/src/llm/providers/anthropic.ts
git commit -m "resilience: add 60s timeout to LLM API clients

Prevents hung LLM provider from blocking requests indefinitely.
Both OpenAI and Anthropic SDKs support timeout at client level.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Fix deriveDelegationStatus for all-pendingApproval case

**Files:**
- Modify: `apps/api/src/agents/chapo-loop.ts:166-181`

**Step 1: Add pending-approval detection**

Replace the `deriveDelegationStatus` method:

```typescript
  private deriveDelegationStatus(
    evidence: ToolEvidence[],
    escalated: boolean,
    hasContent: boolean,
  ): LoopDelegationStatus {
    if (escalated) return 'escalated';
    if (evidence.length === 0 && !hasContent) return 'failed';

    const failures = evidence.filter((e) => !e.success && !e.pendingApproval);
    const successes = evidence.filter((e) => e.success);
    const pending = evidence.filter((e) => e.pendingApproval);

    if (failures.length === 0 && successes.length > 0) return 'success';
    if (successes.length > 0 && failures.length > 0) return 'partial';
    if (failures.length > 0 && successes.length === 0) return 'failed';
    // All evidence is pendingApproval — nothing actually completed yet
    if (pending.length > 0 && successes.length === 0) return 'partial';
    return 'success'; // no evidence but has content = success
  }
```

**Step 2: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/agents/chapo-loop.ts
git commit -m "resilience: fix deriveDelegationStatus for all-pendingApproval case

Previously returned 'success' when all evidence was pendingApproval
(no successes, no failures). Now correctly returns 'partial' so CHAPO
doesn't claim completion when actions are still awaiting approval.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Add error handling to sub-agent LLM calls

**Files:**
- Modify: `apps/api/src/agents/chapo-loop.ts`

**Step 1: Wrap DEVO sub-loop LLM call in try/catch with retry**

In `delegateToDevo()`, find the LLM call (around line 943, the `llmRouter.generateWithFallback` call inside the for-loop). Wrap it:

```typescript
      let response: GenerateResponse & { usedProvider: LLMProvider };
      try {
        response = await llmRouter.generateWithFallback(provider, {
          model: devo.model,
          systemPrompt: devoSystemPrompt,
          messages: devoConversation,
          tools,
          toolsEnabled: true,
          maxTokens: 4096,
        });
      } catch (llmErr) {
        const errMsg = llmErr instanceof Error ? llmErr.message : String(llmErr);
        console.error(`[chapo-loop] DEVO LLM call failed on turn ${turn + 1}:`, errMsg);
        toolEvidence.push({
          tool: 'llm_call',
          success: false,
          summary: `DEVO LLM failed: ${errMsg.slice(0, 100)}`,
        });
        // Return partial result instead of crashing the delegation
        const status = this.deriveDelegationStatus(toolEvidence, false, finalContent.length > 0);
        return {
          status: status === 'success' ? 'partial' : status,
          summary: finalContent || `DEVO LLM call failed: ${errMsg}`,
          toolEvidence,
        };
      }
```

**Step 2: Apply the same pattern to CAIO sub-loop**

In `delegateToCaio()`, find the equivalent LLM call (around line 1171) and apply the same try/catch pattern, replacing `toolEvidence` with the mapped `evidenceLog` equivalent and `'DEVO'` with `'CAIO'`.

**Step 3: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/agents/chapo-loop.ts
git commit -m "resilience: handle LLM failures in DEVO/CAIO sub-agent loops

Previously a single LLM failure (429, timeout) would crash the entire
delegation. Now catches the error, records it as evidence, and returns
a partial result so CHAPO can decide what to do.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Phase 4: Architecture — Extract SubAgentRunner

### Task 10: Extract shared delegation loop into SubAgentRunner

**Files:**
- Create: `apps/api/src/agents/sub-agent-runner.ts`
- Modify: `apps/api/src/agents/chapo-loop.ts`

This is the highest-value refactor — eliminates ~200 lines of near-identical code between `delegateToDevo()` and `delegateToCaio()`.

**Step 1: Create SubAgentRunner class**

Create `apps/api/src/agents/sub-agent-runner.ts` with the shared delegation loop logic:

```typescript
import type { AgentName, LoopDelegationResult, LoopDelegationStatus, ToolEvidence } from './types.js';
import type { AgentDefinition } from './types.js';
import type { GenerateResponse } from '../llm/types.js';
import type { LLMProvider } from '../llm/types.js';
import { getAgent, getToolsForAgent, getToolsForLLM } from './registry.js';
import { getCombinedSystemContextBlock } from './systemContext.js';
import { llmRouter } from '../llm/router.js';
import { executeToolWithApprovalBridge } from '../actions/manager.js';

type SendEventFn = (event: unknown) => void;

interface ParallelDelegation {
  target: AgentName;
  domain: string;
  objective: string;
  constraints: string[];
  expectedOutcome?: string;
  context?: unknown;
  files?: string[];
}

export interface SubAgentHooks {
  /** Called before tool execution. Return { skip: true } to block the tool. */
  preflight?: (toolName: string, args: Record<string, unknown>) => { skip: boolean; reason?: string };
  /** Called after tool execution to build custom evidence. */
  buildEvidence?: (toolName: string, args: Record<string, unknown>, result: { success: boolean; error?: string }, duration: number) => ToolEvidence;
  /** Called when a SCOUT delegation is requested from within the sub-agent. */
  handleScoutDelegation?: (query: string, scope: string) => Promise<string>;
}

const MAX_TURNS = 10;

export class SubAgentRunner {
  constructor(
    private agentName: 'devo' | 'caio',
    private sessionId: string,
    private sendEvent: SendEventFn,
    private provider: LLMProvider,
    private deriveDelegationStatus: (evidence: ToolEvidence[], escalated: boolean, hasContent: boolean) => LoopDelegationStatus,
    private hooks?: SubAgentHooks,
  ) {}

  async run(delegation: ParallelDelegation, formatDelegationContext: (d: ParallelDelegation) => string): Promise<LoopDelegationResult> {
    const agent = getAgent(this.agentName);
    const toolNames = getToolsForAgent(this.agentName);
    const tools = getToolsForLLM().filter((t) => toolNames.includes(t.name));
    const systemContextBlock = getCombinedSystemContextBlock(this.sessionId);
    const delegationContext = formatDelegationContext(delegation);
    const toolEvidence: ToolEvidence[] = [];
    let finalContent = '';

    const systemPrompt = `${agent.systemPrompt}\n\n${systemContextBlock}\n\n${delegationContext}`;

    this.sendEvent({ type: 'agent_switch', from: 'chapo', to: this.agentName, reason: `Delegation: ${delegation.objective}` });
    this.sendEvent({
      type: 'delegation',
      from: 'chapo',
      to: this.agentName,
      task: delegation.objective,
      domain: delegation.domain,
      objective: delegation.objective,
      constraints: delegation.constraints,
      expectedOutcome: delegation.expectedOutcome,
    });

    const messages: Array<{ role: string; content: string; toolCalls?: unknown[]; toolResults?: unknown[] }> = [
      { role: 'user', content: delegation.objective },
    ];

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      this.sendEvent({ type: 'agent_thinking', agent: this.agentName, status: `Turn ${turn + 1}...` });

      let response: GenerateResponse & { usedProvider: LLMProvider };
      try {
        response = await llmRouter.generateWithFallback(this.provider, {
          model: agent.model,
          systemPrompt,
          messages,
          tools,
          toolsEnabled: true,
          maxTokens: 4096,
        });
      } catch (llmErr) {
        const errMsg = llmErr instanceof Error ? llmErr.message : String(llmErr);
        console.error(`[chapo-loop] ${this.agentName.toUpperCase()} LLM call failed on turn ${turn + 1}:`, errMsg);
        toolEvidence.push({ tool: 'llm_call', success: false, summary: `LLM failed: ${errMsg.slice(0, 100)}` });
        const status = this.deriveDelegationStatus(toolEvidence, false, finalContent.length > 0);
        return { status: status === 'success' ? 'partial' : status, summary: finalContent || `LLM call failed: ${errMsg}`, toolEvidence };
      }

      if (response.content) {
        finalContent = response.content;
      }

      if (!response.toolCalls || response.toolCalls.length === 0) {
        break;
      }

      const toolResults: Array<{ toolUseId: string; result: string; isError?: boolean }> = [];

      for (const toolCall of response.toolCalls) {
        // Escalation
        if (toolCall.name === 'escalateToChapo') {
          const desc = (toolCall.arguments as { reason?: string }).reason || 'Unknown';
          this.sendEvent({ type: 'agent_complete', agent: this.agentName, result: `${this.agentName.toUpperCase()} eskaliert: ${desc}` });
          return {
            status: 'escalated',
            summary: `${this.agentName.toUpperCase()} eskaliert: ${desc}\n\nBisheriges Ergebnis:\n${finalContent}`,
            toolEvidence,
            escalation: desc,
          };
        }

        // SCOUT delegation
        if (toolCall.name === 'delegateToScout' && this.hooks?.handleScoutDelegation) {
          const { query, scope } = toolCall.arguments as { query: string; scope?: string };
          try {
            const scoutResult = await this.hooks.handleScoutDelegation(query, scope || 'codebase');
            toolEvidence.push({ tool: 'delegateToScout', success: true, summary: `SCOUT: ${(query || '').slice(0, 80)}` });
            toolResults.push({ toolUseId: toolCall.id, result: scoutResult });
          } catch (scoutErr) {
            const errMsg = scoutErr instanceof Error ? scoutErr.message : String(scoutErr);
            toolEvidence.push({ tool: 'delegateToScout', success: false, summary: errMsg });
            toolResults.push({ toolUseId: toolCall.id, result: `SCOUT error: ${errMsg}`, isError: true });
          }
          continue;
        }

        // Preflight hook
        if (this.hooks?.preflight) {
          const preflight = this.hooks.preflight(toolCall.name, toolCall.arguments as Record<string, unknown>);
          if (preflight.skip) {
            toolResults.push({ toolUseId: toolCall.id, result: `Tool blocked: ${preflight.reason || 'preflight rejected'}`, isError: true });
            continue;
          }
        }

        // Regular tool execution
        const startTime = Date.now();
        this.sendEvent({ type: 'tool_call', agent: this.agentName, toolName: toolCall.name, args: toolCall.arguments });
        try {
          const result = await executeToolWithApprovalBridge(
            toolCall.name,
            toolCall.arguments as Record<string, unknown>,
            this.sessionId,
            this.sendEvent,
            { agentName: this.agentName, delegationId: undefined },
          );
          const duration = Date.now() - startTime;

          const evidence = this.hooks?.buildEvidence
            ? this.hooks.buildEvidence(toolCall.name, toolCall.arguments as Record<string, unknown>, result, duration)
            : { tool: toolCall.name, success: result.success, summary: result.success ? `${toolCall.name} OK (${duration}ms)` : (result.error || `${toolCall.name} failed`) };

          toolEvidence.push(evidence);
          this.sendEvent({ type: 'tool_result', agent: this.agentName, toolName: toolCall.name, result: result.data, success: result.success });
          toolResults.push({ toolUseId: toolCall.id, result: typeof result.data === 'string' ? result.data : JSON.stringify(result.data), isError: !result.success });
        } catch (toolErr) {
          const duration = Date.now() - startTime;
          const errMsg = toolErr instanceof Error ? toolErr.message : String(toolErr);
          toolEvidence.push({ tool: toolCall.name, success: false, summary: errMsg });
          this.sendEvent({ type: 'tool_result', agent: this.agentName, toolName: toolCall.name, result: errMsg, success: false });
          toolResults.push({ toolUseId: toolCall.id, result: `Error: ${errMsg}`, isError: true });
        }
      }

      // Add assistant + tool results to conversation
      messages.push({ role: 'assistant', content: response.content || '', toolCalls: response.toolCalls });
      messages.push({ role: 'user', content: '', toolResults });
    }

    this.sendEvent({ type: 'agent_complete', agent: this.agentName, result: finalContent });

    const status = this.deriveDelegationStatus(toolEvidence, false, finalContent.length > 0);
    return { status, summary: finalContent, toolEvidence };
  }
}
```

**Step 2: Refactor delegateToDevo and delegateToCaio to use SubAgentRunner**

In `chapo-loop.ts`, replace the body of `delegateToDevo()` with:

```typescript
  private async delegateToDevo(delegation: ParallelDelegation): Promise<LoopDelegationResult> {
    const provider = (this.modelSelection.provider || 'anthropic') as LLMProvider;
    const runner = new SubAgentRunner(
      'devo',
      this.sessionId,
      this.sendEvent,
      provider,
      this.deriveDelegationStatus.bind(this),
      {
        handleScoutDelegation: (query, scope) => this.runScoutForSubAgent(query, scope),
      },
    );
    return runner.run(delegation, this.formatDelegationContext.bind(this));
  }
```

Replace the body of `delegateToCaio()` with:

```typescript
  private async delegateToCaio(delegation: ParallelDelegation): Promise<LoopDelegationResult> {
    const provider = (this.modelSelection.provider || 'anthropic') as LLMProvider;
    const runner = new SubAgentRunner(
      'caio',
      this.sessionId,
      this.sendEvent,
      provider,
      this.deriveDelegationStatus.bind(this),
      {
        preflight: (name, args) => this.preflightCaioToolCall(name, args),
        buildEvidence: (name, args, result, duration) => this.buildCaioToolEvidence(name, args, result, duration),
        handleScoutDelegation: (query, scope) => this.runScoutForSubAgent(query, scope),
      },
    );
    return runner.run(delegation, this.formatDelegationContext.bind(this));
  }
```

Extract the SCOUT delegation logic into a shared helper:

```typescript
  private async runScoutForSubAgent(query: string, scope: string): Promise<string> {
    const scoutResult = await this.runScout({ query, scope: scope as ScoutScope, sessionId: this.sessionId });
    return scoutResult.summary || JSON.stringify(scoutResult, null, 2);
  }
```

Adapt `preflightCaioToolCall` to return `{ skip: boolean; reason?: string }` and extract `buildCaioToolEvidence` as a method returning `ToolEvidence`.

**Step 3: Delete the old delegation loop code**

Remove the old `delegateToDevo` body (~225 lines) and `delegateToCaio` body (~250 lines), along with `applyCaioEvidenceSummary` (dead code).

**Step 4: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/agents/sub-agent-runner.ts apps/api/src/agents/chapo-loop.ts
git commit -m "refactor: extract SubAgentRunner from duplicate delegation loops

Eliminates ~400 lines of near-identical code between delegateToDevo()
and delegateToCaio(). Both now use SubAgentRunner with hooks for
agent-specific behavior (CAIO preflight, evidence building).

Also removes dead code: applyCaioEvidenceSummary(), delegateToKoda check.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Phase 5: Medium Priority — Remaining Fixes

### Task 11: Remove dead code and legacy references

**Files:**
- Modify: `apps/api/src/agents/chapo-loop.ts`
- Modify: `apps/api/src/agents/conversation-manager.ts`
- Modify: `apps/api/src/agents/error-handler.ts`

**Step 1: Remove `delegateToKoda` check**

In `chapo-loop.ts` around line 355, change:
```typescript
if (toolCall.name === 'delegateToKoda' || toolCall.name === 'delegateToDevo') {
```
To:
```typescript
if (toolCall.name === 'delegateToDevo') {
```

**Step 2: Remove unused ConversationManager methods**

In `conversation-manager.ts`, delete:
- `addThinking()` method
- `getRemainingTokens()` method
- `getSummary()` method

Keep `replaceLastAssistant()` — it IS used by self-validation.

**Step 3: Remove unused ErrorHandler methods**

In `error-handler.ts`, delete:
- `setErrorCallback()` method and the `errorCallback` field
- `resetRetry()` method
- `getErrors()` method

**Step 4: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/agents/chapo-loop.ts apps/api/src/agents/conversation-manager.ts apps/api/src/agents/error-handler.ts
git commit -m "cleanup: remove dead code and legacy references

- Remove delegateToKoda legacy check (old agent name)
- Remove unused ConversationManager methods (addThinking, getRemainingTokens, getSummary)
- Remove unused ErrorHandler methods (setErrorCallback, resetRetry, getErrors)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 12: Add WebSocket heartbeat and rate limiting

**Files:**
- Modify: `apps/api/src/websocket/routes.ts`

**Step 1: Add server-side ping/pong heartbeat**

In the `/ws/chat` connection handler, after the socket is set up and added to the session, add:

```typescript
    // Server-side heartbeat: detect dead connections
    const HEARTBEAT_INTERVAL = 30_000; // 30 seconds
    const PONG_TIMEOUT = 10_000;       // 10 seconds to respond
    let isAlive = true;

    socket.on('pong', () => { isAlive = true; });

    const heartbeat = setInterval(() => {
      if (!isAlive) {
        console.info(`[WS] Dead connection detected for session ${sessionId}, terminating`);
        clearInterval(heartbeat);
        socket.terminate();
        return;
      }
      isAlive = false;
      socket.ping();
    }, HEARTBEAT_INTERVAL);

    socket.on('close', () => { clearInterval(heartbeat); });
```

**Step 2: Add per-connection message rate limiting**

Before the message handler in the `/ws/chat` route, add:

```typescript
    // Rate limiting: max 30 messages per 10 seconds per connection
    const RATE_WINDOW = 10_000;
    const RATE_LIMIT = 30;
    let messageTimestamps: number[] = [];

    // Inside the message handler, at the top:
    const now = Date.now();
    messageTimestamps = messageTimestamps.filter((ts) => now - ts < RATE_WINDOW);
    if (messageTimestamps.length >= RATE_LIMIT) {
      socket.send(JSON.stringify({ type: 'error', error: 'Rate limit exceeded. Please slow down.' }));
      return;
    }
    messageTimestamps.push(now);
```

**Step 3: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/websocket/routes.ts
git commit -m "resilience: add WebSocket heartbeat and message rate limiting

- Server-side ping/pong every 30s to detect dead connections
- Per-connection rate limit: 30 messages per 10 seconds

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 13: Narrow filesystem allowed roots and block .env reads

**Files:**
- Modify: `apps/api/src/config.ts`

**Step 1: Add more denied paths**

Find the `HARDCODED_DENIED_PATHS` array and add:

```typescript
const HARDCODED_DENIED_PATHS: string[] = [
  '/root/.openclaw',
  '/opt/Devai',
  // Security-sensitive paths
  '/root/.ssh',
  '/root/.gnupg',
  '/root/.claude',
  '/root/.aws',
  '/root/.config',
];
```

**Step 2: Remove `.env` from allowed extensions**

Find `toolAllowedExtensions` and remove `.env` from the list. If the agent needs specific env values, it should use a dedicated config tool, not read raw .env files.

**Step 3: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/config.ts
git commit -m "security: expand denied paths and block .env file reads

Add ~/.ssh, ~/.gnupg, ~/.claude, ~/.aws, ~/.config to denied paths.
Remove .env from allowed file extensions to prevent secrets exposure.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 14: Deduplicate buildToolResultContent

**Files:**
- Create: `apps/api/src/agents/utils.ts`
- Modify: `apps/api/src/agents/chapo-loop.ts`
- Modify: `apps/api/src/agents/router.ts`

**Step 1: Extract to shared utility**

Create `apps/api/src/agents/utils.ts`:

```typescript
/**
 * Build a text representation of a tool result for inclusion in LLM messages.
 */
export function buildToolResultContent(data: unknown, isError: boolean): string {
  if (typeof data === 'string') return data;
  if (data === null || data === undefined) return isError ? 'Tool execution failed' : 'OK';
  try {
    const json = JSON.stringify(data, null, 2);
    return json.length > 8000 ? `${json.slice(0, 8000)}\n...[truncated]` : json;
  } catch {
    return String(data);
  }
}
```

**Step 2: Replace in both files**

In `chapo-loop.ts`, remove the local `buildToolResultContent` function and import from `./utils.js`.

In `router.ts`, remove the local `buildToolResultContent` function and import from `./utils.js`.

**Step 3: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/agents/utils.ts apps/api/src/agents/chapo-loop.ts apps/api/src/agents/router.ts
git commit -m "cleanup: deduplicate buildToolResultContent into shared utility

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 15: Fix `any` types

**Files:**
- Modify: `apps/api/src/server.ts`

**Step 1: Replace `(app as any).mcpInitPromise`**

At the module level (before the function that uses it), declare:

```typescript
let mcpInitPromise: Promise<void> | undefined;
```

Replace `(app as any).mcpInitPromise = ...` with `mcpInitPromise = ...`.

Replace `await (app as any).mcpInitPromise` with `if (mcpInitPromise) await mcpInitPromise`.

**Step 2: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/server.ts
git commit -m "cleanup: remove any casts for mcpInitPromise in server.ts

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## File Summary

| Action | File | Purpose |
|--------|------|---------|
| Modify | `tools/ssh.ts` | Validate host parameter against injection |
| Modify | `tools/pm2.ts` | Validate processName against injection |
| Modify | `config/trust.ts` | Change DEFAULT_TRUST_MODE to 'default' |
| Modify | `tools/web.ts` | Add SSRF protection (private IP blocking) |
| Modify | `tools/fs.ts` | Resolve symlinks before path validation |
| Modify | `tools/bash.ts` | Validate npm package names |
| Modify | `llm/providers/zai.ts` | Add 60s client timeout |
| Modify | `llm/providers/anthropic.ts` | Add 60s client timeout |
| Modify | `agents/chapo-loop.ts` | Fix deriveDelegationStatus, sub-agent error handling, refactor to use SubAgentRunner, remove dead code |
| Create | `agents/sub-agent-runner.ts` | Shared delegation loop (extracted from DEVO/CAIO) |
| Modify | `agents/conversation-manager.ts` | Remove unused methods |
| Modify | `agents/error-handler.ts` | Remove unused methods |
| Modify | `websocket/routes.ts` | Add heartbeat + rate limiting |
| Modify | `config.ts` | Expand denied paths, remove .env from allowed extensions |
| Create | `agents/utils.ts` | Shared buildToolResultContent |
| Modify | `agents/router.ts` | Import shared buildToolResultContent |
| Modify | `server.ts` | Remove any casts |
