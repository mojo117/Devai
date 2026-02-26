# SCOUT Self-Inspection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow SCOUT to read Devai's own codebase (`/opt/Devai` on Clawd) via existing fs_* tools, while keeping all other agents blocked and excluding sensitive files.

**Architecture:** Pass `agentName` from the approval bridge down into `executeTool()`, then into fs functions. When SCOUT calls read-only fs tools, `validatePath()` skips the `/opt/Devai` denial but enforces exclusion patterns for secrets. No new tools — the existing `fs_readFile`, `fs_glob`, `fs_grep`, `fs_listFiles` gain self-inspection capability only for SCOUT.

**Tech Stack:** TypeScript, Fastify, existing Devai tool infrastructure

---

### Task 1: Add Self-Inspection Config

**Files:**
- Modify: `apps/api/src/config.ts`

**Step 1: Add the self-inspection config properties**

Add to the `Config` interface after `deniedPaths`:

```typescript
// Self-inspection: allows SCOUT to read Devai's own source (read-only, secrets excluded)
selfInspectionRoot: string;
selfInspectionExclude: string[];
```

**Step 2: Add the hardcoded values**

Add after `HARDCODED_DENIED_PATHS`:

```typescript
// Directories/files within /opt/Devai that SCOUT must NOT read (secrets, runtime data)
const SELF_INSPECTION_EXCLUDE: readonly string[] = [
  '.env',
  'secrets',
  'var',
  'workspace/memory',
  '.git',
  'node_modules',
] as const;
```

**Step 3: Wire into loadConfig()**

Add to the return object:

```typescript
selfInspectionRoot: '/opt/Devai',
selfInspectionExclude: [...SELF_INSPECTION_EXCLUDE],
```

**Step 4: Commit**

```bash
git add apps/api/src/config.ts
git commit -m "feat(config): add self-inspection root and exclusions for SCOUT"
```

---

### Task 2: Add Self-Inspection to Path Validation

**Files:**
- Modify: `apps/api/src/tools/fs.ts`

**Step 1: Add FsOptions interface**

Add after the imports at the top of fs.ts:

```typescript
/** Options for path validation — controls self-inspection bypass */
export interface FsOptions {
  /** When true, allows read access to the self-inspection root (Devai's own codebase), bypassing the denied-paths check for that root only. Sensitive paths within the root are still blocked via selfInspectionExclude. */
  selfInspection?: boolean;
}
```

**Step 2: Modify validatePath to accept options**

Change the signature from:

```typescript
async function validatePath(path: string): Promise<string> {
```

to:

```typescript
async function validatePath(path: string, options?: FsOptions): Promise<string> {
```

**Step 3: Add self-inspection bypass logic**

Inside `validatePath`, right BEFORE the denied-paths loop (line ~137), add a self-inspection check. Replace the existing denied-paths block:

```typescript
  // Deny access to explicitly restricted paths
  for (const denied of config.deniedPaths) {
    const absoluteDenied = resolve(denied);
    if (normalizedPath.startsWith(absoluteDenied + '/') || normalizedPath === absoluteDenied) {
      throw new Error(`Access denied: "${path}" is in a restricted area`);
    }
  }
```

with:

```typescript
  // Deny access to explicitly restricted paths
  for (const denied of config.deniedPaths) {
    const absoluteDenied = resolve(denied);
    if (normalizedPath.startsWith(absoluteDenied + '/') || normalizedPath === absoluteDenied) {
      // Self-inspection bypass: SCOUT may read its own codebase (minus excluded paths)
      const selfRoot = resolve(config.selfInspectionRoot);
      if (options?.selfInspection && absoluteDenied === selfRoot) {
        // Check exclusion patterns within the self-inspection root
        const relativeToSelf = normalizedPath.slice(selfRoot.length + 1); // path relative to /opt/Devai
        const isExcluded = config.selfInspectionExclude.some((exclude) => {
          return relativeToSelf === exclude ||
                 relativeToSelf.startsWith(exclude + '/') ||
                 relativeToSelf.endsWith('/' + exclude) ||
                 relativeToSelf.includes('/' + exclude + '/');
        });
        if (isExcluded) {
          throw new Error(`Access denied: "${path}" is excluded from self-inspection`);
        }
        // Allowed — skip this denied-path entry
        continue;
      }
      throw new Error(`Access denied: "${path}" is in a restricted area`);
    }
  }
```

**Step 4: Pass options through read-only fs functions**

Update the read-only function signatures to accept and forward `FsOptions`:

`listFiles`:
```typescript
export async function listFiles(path: string, options?: FsOptions): Promise<ListFilesResult> {
  const absolutePath = await validatePath(path, options);
```

`readFile`:
```typescript
export async function readFile(path: string, options?: FsOptions): Promise<ReadFileResult> {
  const absolutePath = await validatePath(path, options);
```

`globFiles`:
```typescript
export async function globFiles(
  pattern: string,
  basePath?: string,
  ignore?: string[],
  options?: FsOptions
): Promise<GlobResult> {
  let searchPath: string;
  if (basePath) {
    searchPath = await validatePath(basePath, options);
  } else {
```

`grepFiles`:
```typescript
export async function grepFiles(
  pattern: string,
  searchPath: string,
  fileGlob?: string,
  ignore?: string[],
  options?: FsOptions
): Promise<GrepResult> {
  const validatedPath = await validatePath(searchPath, options);
```

Do NOT add `FsOptions` to write functions (`writeFile`, `editFile`, `makeDirectory`, `moveFile`, `deleteFile`). Self-inspection is read-only.

**Step 5: Commit**

```bash
git add apps/api/src/tools/fs.ts
git commit -m "feat(fs): add self-inspection bypass to validatePath for SCOUT"
```

---

### Task 3: Pass Agent Context Through Executor

**Files:**
- Modify: `apps/api/src/tools/executor.ts`
- Modify: `apps/api/src/actions/approvalBridge.ts`

**Step 1: Add agentName to ToolExecutionOptions**

In `executor.ts`, update the interface:

```typescript
export interface ToolExecutionOptions {
  // Internal escape hatch used only after explicit user approval (e.g. approved action queue).
  bypassConfirmation?: boolean;
  // The agent requesting this tool — used for self-inspection access control.
  agentName?: string;
}
```

**Step 2: Build FsOptions from agent context in executor**

In the `executeTool` function, add a helper right before the switch statement (inside the `execution` async block, around line 74):

```typescript
    const execution = (async () => {
      // Self-inspection: only SCOUT gets read access to Devai's own codebase
      const fsOpts: import('./fs.js').FsOptions | undefined =
        options?.agentName === 'scout' ? { selfInspection: true } : undefined;

      switch (normalizedToolName) {
```

**Step 3: Pass fsOpts to read-only fs tool calls**

Update only the read-only fs cases in the switch:

```typescript
        case 'fs_listFiles':
          return fsTools.listFiles(args.path as string, fsOpts);

        case 'fs_readFile':
          return fsTools.readFile(args.path as string, fsOpts);

        case 'fs_glob':
          return fsTools.globFiles(
            args.pattern as string,
            args.path as string | undefined,
            undefined, // ignore
            fsOpts
          );

        case 'fs_grep':
          return fsTools.grepFiles(
            args.pattern as string,
            args.path as string,
            args.glob as string | undefined,
            undefined, // ignore
            fsOpts
          );
```

Do NOT change `fs_writeFile`, `fs_edit`, `fs_mkdir`, `fs_move`, `fs_delete` — they must never get self-inspection access.

**Step 4: Forward agentName from approvalBridge**

In `approvalBridge.ts`, update the two `executeTool()` calls to forward the agent name.

Line ~122 (bypass case):
```typescript
  if (needsBypass) {
    return executeTool(normalizedToolName, toolArgs, {
      bypassConfirmation: true,
      agentName: options?.agentName,
    });
  }
```

Line ~125 (normal case):
```typescript
  return executeTool(normalizedToolName, toolArgs, {
    agentName: options?.agentName,
  });
```

**Step 5: Commit**

```bash
git add apps/api/src/tools/executor.ts apps/api/src/actions/approvalBridge.ts
git commit -m "feat(executor): forward agentName to fs tools for self-inspection"
```

---

### Task 4: Update SCOUT's System Prompt

**Files:**
- Modify: `apps/api/src/prompts/scout.ts`

**Step 1: Add self-inspection docs to the prompt**

In SCOUT's system prompt, add a new section after `## DATEISYSTEM-ZUGRIFF (EINGESCHRÄNKT)`:

```typescript
## SELBST-INSPEKTION (DEVAI CODEBASE)
Du kannst DevAIs eigenen Quellcode unter /opt/Devai lesen, um Fragen über die eigene Architektur, Implementierung und Konfiguration zu beantworten.

**Erlaubt:**
- Quellcode lesen: /opt/Devai/apps/api/src/**, /opt/Devai/apps/web/src/**, /opt/Devai/shared/**
- Dokumentation lesen: /opt/Devai/docs/**, /opt/Devai/README.md, /opt/Devai/CLAUDE.md
- Konfiguration lesen: /opt/Devai/package.json, /opt/Devai/apps/*/package.json
- Soul-Dateien lesen: /opt/Devai/workspace/souls/**

**VERBOTEN (automatisch blockiert):**
- .env (Secrets, API Keys)
- secrets/ (Verschlüsselungsvorlagen)
- var/ (Laufzeitdaten, Logs, Datenbank)
- workspace/memory/ (private Erinnerungen)
- .git/ (Git-Interna)
- node_modules/

Nutze diese Fähigkeit wenn der User Fragen über DevAIs eigene Funktionsweise stellt.
```

**Step 2: Commit**

```bash
git add apps/api/src/prompts/scout.ts
git commit -m "feat(scout): document self-inspection capability in system prompt"
```

---

### Task 5: Manual Verification

**Step 1: Check TypeScript compilation**

Run: `cd /opt/Klyde/projects/Devai/apps/api && npx tsc --noEmit`
Expected: No errors

**Step 2: Run existing tests**

Run: `cd /opt/Klyde/projects/Devai/apps/api && npx vitest run`
Expected: All existing tests pass

**Step 3: Verify self-inspection works (manual)**

After deploy to Clawd (via Mutagen sync + PM2 restart), test in the Devai chat UI:
- Ask: "Welche Agents gibt es in deinem System?" — SCOUT should read `/opt/Devai/apps/api/src/agents/` and answer
- Ask: "Zeig mir deine Tool-Registry" — SCOUT should read `/opt/Devai/apps/api/src/tools/registry.ts`
- Ask: "Was steht in deiner .env?" — Should get "Access denied: excluded from self-inspection"

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: address review feedback for self-inspection"
```

---

## Summary of Changes

| File | Change | Why |
|------|--------|-----|
| `config.ts` | Add `selfInspectionRoot` + `selfInspectionExclude` | Configure which path SCOUT can inspect and what's excluded |
| `fs.ts` | Add `FsOptions` type, modify `validatePath()` + 4 read-only functions | Self-inspection bypass with exclusion enforcement |
| `executor.ts` | Add `agentName` to options, pass `fsOpts` to read-only fs calls | Route agent identity to fs layer |
| `approvalBridge.ts` | Forward `agentName` to `executeTool()` | Bridge between agent layer and executor |
| `prompts/scout.ts` | Document self-inspection capability | Tell SCOUT it can read its own code |

**Security guarantees:**
- Only SCOUT gets self-inspection (agent name check in executor)
- Only read-only fs functions accept the flag (write functions unchanged)
- Secrets excluded at the path validation level (.env, secrets/, var/, workspace/memory/)
- `/opt/Devai` stays in HARDCODED_DENIED_PATHS — all other agents remain blocked
