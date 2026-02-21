# Dynamic Skills System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable Devai agents to create, manage, and execute dynamic skills — self-contained TypeScript functions registered as tools at runtime.

**Architecture:** Skills live in `skills/<id>/` folders with a `skill.json` manifest and `execute.ts` file. The skill runner dynamically imports `execute.ts`, calls `execute(args, ctx)` with a sandboxed context, and returns the result. Skills register as tools (`skill_<id>`) in the unified tool registry. CHAPO designs skills, DEVO implements them via `skill_create`.

**Tech Stack:** TypeScript, tsx (dynamic import), Zod validation, existing Devai tool/agent infrastructure

---

### Task 1: Update Shared Types

**Files:**
- Modify: `shared/src/skills.ts`
- Create: `shared/src/skill-runtime.ts`
- Modify: `shared/src/index.ts`

**Step 1: Replace SkillManifest with new format**

Replace the entire contents of `shared/src/skills.ts` with:

```typescript
export interface SkillParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  default?: unknown;
}

export interface SkillManifest {
  id: string;
  name: string;
  description: string;
  version?: string;
  parameters?: Record<string, SkillParameter>;
  createdBy?: string;
  tags?: string[];
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  version?: string;
  tags?: string[];
}
```

**Step 2: Create skill-runtime types**

Create `shared/src/skill-runtime.ts`:

```typescript
export interface SkillContext {
  /** HTTP client for external API calls */
  fetch: typeof globalThis.fetch;
  /** Read-only access to environment variables (API keys, etc.) */
  env: Readonly<Record<string, string | undefined>>;
  /** Read a file within allowed roots */
  readFile: (path: string) => Promise<string>;
  /** Write a file within allowed roots */
  writeFile: (path: string, content: string) => Promise<void>;
  /** Append a message to the skill execution log */
  log: (message: string) => void;
}

export interface SkillResult {
  success: boolean;
  result?: unknown;
  error?: string;
}
```

**Step 3: Export from index**

In `shared/src/index.ts`, add:

```typescript
export * from './skill-runtime.js';
```

**Step 4: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add shared/src/skills.ts shared/src/skill-runtime.ts shared/src/index.ts && git commit -m "feat(shared): update skill manifest types and add skill-runtime contract"
```

---

### Task 2: Update Skill Loader & Registry

**Files:**
- Modify: `apps/api/src/skills/loader.ts`
- Modify: `apps/api/src/skills/registry.ts`

**Step 1: Update the Zod schema in loader.ts**

Replace the entire contents of `apps/api/src/skills/loader.ts` with:

```typescript
import { access, readFile, readdir } from 'fs/promises';
import { join, resolve } from 'path';
import { z } from 'zod';
import type { SkillManifest } from '@devai/shared';

const SkillParameterSchema = z.object({
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
  description: z.string(),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
});

const SkillManifestSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/, 'id must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().optional(),
  parameters: z.record(SkillParameterSchema).optional(),
  createdBy: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export interface SkillLoadResult {
  skills: SkillManifest[];
  errors: string[];
}

async function loadSkillFromFile(filePath: string): Promise<SkillManifest> {
  const raw = await readFile(filePath, 'utf-8');
  const parsed = SkillManifestSchema.safeParse(JSON.parse(raw));

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join('; ');
    throw new Error(`Invalid skill manifest at ${filePath}: ${message}`);
  }

  return parsed.data;
}

/** Check if a skill has an execute.ts file */
async function hasExecuteFile(skillDir: string): Promise<boolean> {
  try {
    await access(join(skillDir, 'execute.ts'));
    return true;
  } catch {
    return false;
  }
}

export async function loadSkillsFromDir(skillsDir: string): Promise<SkillLoadResult> {
  const skills: SkillManifest[] = [];
  const errors: string[] = [];
  const resolvedDir = resolve(skillsDir);

  try {
    await access(resolvedDir);
  } catch {
    return { skills, errors };
  }

  const entries = await readdir(resolvedDir, { withFileTypes: true });

  for (const entry of entries) {
    try {
      if (entry.isDirectory()) {
        const manifestPath = join(resolvedDir, entry.name, 'skill.json');
        await access(manifestPath);
        const manifest = await loadSkillFromFile(manifestPath);

        // Check for execute.ts — skills without it are manifest-only (legacy)
        const hasCode = await hasExecuteFile(join(resolvedDir, entry.name));
        if (!hasCode) {
          errors.push(`Skill "${manifest.id}" has no execute.ts — skipped`);
          continue;
        }

        skills.push(manifest);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push(message);
    }
  }

  return { skills, errors };
}
```

**Step 2: Add tool registration to registry.ts**

Replace the entire contents of `apps/api/src/skills/registry.ts` with:

```typescript
import type { SkillManifest, SkillSummary } from '@devai/shared';
import { loadSkillsFromDir } from './loader.js';
import { config } from '../config.js';
import { toolRegistry } from '../tools/registry.js';

export interface SkillLoadSummary {
  skillsDir: string;
  count: number;
  loadedAt: string;
  errors: string[];
}

let cachedSkills: SkillManifest[] = [];
let loadErrors: string[] = [];
let loadedAt: string | null = null;

/** Build tool parameters from skill manifest parameters */
function buildToolParameters(manifest: SkillManifest): {
  type: 'object';
  properties: Record<string, { type: string; description: string; default?: unknown }>;
  required?: string[];
} {
  const properties: Record<string, { type: string; description: string; default?: unknown }> = {};
  const required: string[] = [];

  if (manifest.parameters) {
    for (const [key, param] of Object.entries(manifest.parameters)) {
      properties[key] = {
        type: param.type,
        description: param.description,
      };
      if (param.default !== undefined) {
        properties[key].default = param.default;
      }
      if (param.required !== false) {
        required.push(key);
      }
    }
  }

  return {
    type: 'object' as const,
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

/** Register a single skill as a tool in the unified registry */
function registerSkillTool(manifest: SkillManifest): void {
  const toolName = `skill_${manifest.id.replace(/-/g, '_')}`;

  toolRegistry.register({
    name: toolName,
    description: `[Skill] ${manifest.description}`,
    parameters: buildToolParameters(manifest),
    requiresConfirmation: false,
    category: 'native',
  });

  // Grant access to CHAPO and DEVO
  toolRegistry.grantAccess('chapo', toolName);
  toolRegistry.grantAccess('devo', toolName);

  console.info(`[skills] Registered skill tool: ${toolName}`);
}

/** Unregister all skill tools from the registry */
function unregisterAllSkillTools(): void {
  for (const skill of cachedSkills) {
    const toolName = `skill_${skill.id.replace(/-/g, '_')}`;
    // The unified registry doesn't have a remove-by-name, but we can re-register over them
    // Skills are re-registered on each reload anyway
  }
}

export async function refreshSkills(): Promise<SkillLoadSummary> {
  const skillsDir = config.skillsDir;
  const result = await loadSkillsFromDir(skillsDir);

  cachedSkills = result.skills;
  loadErrors = result.errors;
  loadedAt = new Date().toISOString();

  // Register each skill as a tool
  for (const skill of cachedSkills) {
    registerSkillTool(skill);
  }

  console.info(`[skills] Loaded ${cachedSkills.length} skill(s), ${loadErrors.length} error(s)`);

  return {
    skillsDir,
    count: cachedSkills.length,
    loadedAt,
    errors: loadErrors,
  };
}

export function getSkillSummaries(): SkillSummary[] {
  return cachedSkills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    version: skill.version,
    tags: skill.tags,
  }));
}

export function getSkillById(id: string): SkillManifest | undefined {
  return cachedSkills.find((skill) => skill.id === id);
}

export function getAllSkills(): SkillManifest[] {
  return [...cachedSkills];
}

export function getSkillLoadState(): { loadedAt: string | null; errors: string[] } {
  return {
    loadedAt,
    errors: loadErrors,
  };
}
```

**Step 3: Update the example skill**

Replace `skills/example/skill.json`:

```json
{
  "id": "example",
  "name": "Example Skill",
  "description": "Demonstrates the skill manifest format. Returns a greeting.",
  "version": "0.1.0",
  "parameters": {
    "name": {
      "type": "string",
      "description": "Name to greet",
      "required": true
    }
  },
  "createdBy": "manual",
  "tags": ["demo"]
}
```

Create `skills/example/execute.ts`:

```typescript
import type { SkillContext, SkillResult } from '@devai/shared';

export async function execute(
  args: Record<string, unknown>,
  ctx: SkillContext
): Promise<SkillResult> {
  const name = (args.name as string) || 'World';
  ctx.log(`Greeting ${name}`);

  return {
    success: true,
    result: { greeting: `Hello, ${name}!` },
  };
}
```

**Step 4: Update skills README**

Replace `skills/README.md`:

```markdown
# Skills

Each skill lives in its own folder with a `skill.json` manifest and an `execute.ts` file.

## Structure

```
skills/
└── my-skill/
    ├── skill.json      # Manifest
    └── execute.ts      # Logic
```

## Manifest (skill.json)

```json
{
  "id": "my-skill",
  "name": "My Skill",
  "description": "What this skill does",
  "version": "1.0.0",
  "parameters": {
    "input": {
      "type": "string",
      "description": "The input value",
      "required": true
    }
  },
  "createdBy": "devo",
  "tags": ["category"]
}
```

## Execute (execute.ts)

```typescript
import type { SkillContext, SkillResult } from '@devai/shared';

export async function execute(
  args: Record<string, unknown>,
  ctx: SkillContext
): Promise<SkillResult> {
  // ctx.fetch — HTTP client
  // ctx.env — environment variables (API keys)
  // ctx.readFile / ctx.writeFile — file access
  // ctx.log — execution logging

  return { success: true, result: { output: 'done' } };
}
```

Skills are registered as tools (`skill_<id>`) and callable by CHAPO and DEVO.
```

**Step 5: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add apps/api/src/skills/ shared/src/skills.ts skills/ && git commit -m "feat(skills): update loader for new manifest format and register skills as tools"
```

---

### Task 3: Create the Skill Runner

**Files:**
- Create: `apps/api/src/skills/runner.ts`

**Step 1: Implement the skill runner**

Create `apps/api/src/skills/runner.ts`:

```typescript
import { resolve, join } from 'path';
import { readFile as fsReadFile, writeFile as fsWriteFile, access } from 'fs/promises';
import { config } from '../config.js';
import { getSkillById } from './registry.js';
import type { SkillContext, SkillResult } from '@devai/shared';

/** Execution timeout for skills (30 seconds) */
const SKILL_TIMEOUT_MS = 30_000;

/** Build a sandboxed SkillContext for skill execution */
function buildContext(skillId: string): SkillContext {
  const logs: string[] = [];

  return {
    fetch: globalThis.fetch,
    env: Object.freeze({ ...process.env }) as Readonly<Record<string, string | undefined>>,

    async readFile(path: string): Promise<string> {
      // Validate path is within allowed roots
      const absolutePath = resolve(path);
      const isAllowed = config.allowedRoots.some(
        (root) => absolutePath.startsWith(resolve(root) + '/') || absolutePath === resolve(root)
      );
      if (!isAllowed) {
        throw new Error(`Skill "${skillId}": readFile denied — path "${path}" outside allowed roots`);
      }
      return fsReadFile(absolutePath, 'utf-8');
    },

    async writeFile(path: string, content: string): Promise<void> {
      const absolutePath = resolve(path);
      const isAllowed = config.allowedRoots.some(
        (root) => absolutePath.startsWith(resolve(root) + '/') || absolutePath === resolve(root)
      );
      if (!isAllowed) {
        throw new Error(`Skill "${skillId}": writeFile denied — path "${path}" outside allowed roots`);
      }
      await fsWriteFile(absolutePath, content, 'utf-8');
    },

    log(message: string): void {
      const entry = `[skill:${skillId}] ${message}`;
      logs.push(entry);
      console.info(entry);
    },
  };
}

/** Execute a skill by ID with the given arguments */
export async function executeSkill(
  skillId: string,
  args: Record<string, unknown>
): Promise<SkillResult> {
  const manifest = getSkillById(skillId);
  if (!manifest) {
    return { success: false, error: `Skill "${skillId}" not found` };
  }

  const executeFilePath = join(resolve(config.skillsDir), skillId, 'execute.ts');
  try {
    await access(executeFilePath);
  } catch {
    return { success: false, error: `Skill "${skillId}" has no execute.ts` };
  }

  const ctx = buildContext(skillId);

  try {
    // Dynamic import of the skill's execute.ts
    // tsx runtime handles TypeScript transpilation
    const skillModule = await import(executeFilePath);

    if (typeof skillModule.execute !== 'function') {
      return { success: false, error: `Skill "${skillId}" does not export an execute() function` };
    }

    // Run with timeout
    const result = await Promise.race<SkillResult>([
      skillModule.execute(args, ctx),
      new Promise<SkillResult>((_, reject) =>
        setTimeout(() => reject(new Error(`Skill "${skillId}" timed out after ${SKILL_TIMEOUT_MS}ms`)), SKILL_TIMEOUT_MS)
      ),
    ]);

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    ctx.log(`Execution failed: ${message}`);
    return { success: false, error: `Skill "${skillId}" failed: ${message}` };
  }
}
```

**Step 2: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add apps/api/src/skills/runner.ts && git commit -m "feat(skills): add skill runner with sandboxed context and dynamic import"
```

---

### Task 4: Add Skill Management Tools to Registry and Executor

**Files:**
- Modify: `apps/api/src/tools/registry.ts` (add tool definitions + ToolName entries)
- Modify: `apps/api/src/tools/executor.ts` (add switch cases)

**Step 1: Add skill tool names to ToolName type**

In `apps/api/src/tools/registry.ts`, add to the `ToolName` type union (after the `telegram_send_document` line):

```typescript
  // Skill Management Tools
  | 'skill_create'
  | 'skill_update'
  | 'skill_delete'
  | 'skill_reload'
  | 'skill_list';
```

**Step 2: Add 5 skill tool definitions to TOOL_REGISTRY**

Add to the `TOOL_REGISTRY` array (at the end, before the closing `];`):

```typescript
  // ============ Skill Management Tools ============
  {
    name: 'skill_create',
    description: 'Create a new skill. Writes skill.json manifest and execute.ts code, then registers it as a tool.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Unique skill ID (lowercase, hyphens allowed, e.g. "generate-image")' },
        name: { type: 'string', description: 'Human-readable skill name' },
        description: { type: 'string', description: 'What the skill does (shown to agents as tool description)' },
        parameters: { type: 'object', description: 'Skill parameters as { paramName: { type, description, required?, default? } }' },
        code: { type: 'string', description: 'TypeScript source code for execute.ts. Must export async function execute(args, ctx).' },
        tags: { type: 'string', description: 'Comma-separated tags for categorization' },
      },
      required: ['id', 'name', 'description', 'code'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'skill_update',
    description: 'Update an existing skill. Overwrites code and/or manifest fields, then re-registers the tool.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill ID to update' },
        code: { type: 'string', description: 'New execute.ts source code (optional)' },
        description: { type: 'string', description: 'New description (optional)' },
        parameters: { type: 'object', description: 'New parameters definition (optional)' },
      },
      required: ['id'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'skill_delete',
    description: 'Delete a skill and unregister its tool.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill ID to delete' },
      },
      required: ['id'],
    },
    requiresConfirmation: true,
  },
  {
    name: 'skill_reload',
    description: 'Reload all skills from disk and re-register their tools.',
    parameters: {
      type: 'object',
      properties: {},
    },
    requiresConfirmation: false,
  },
  {
    name: 'skill_list',
    description: 'List all loaded skills with their status.',
    parameters: {
      type: 'object',
      properties: {},
    },
    requiresConfirmation: false,
  },
```

**Step 3: Add skill tool imports and switch cases to executor.ts**

Add import at the top of `executor.ts`:

```typescript
import { executeSkill } from '../skills/runner.js';
import { refreshSkills, getSkillSummaries, getSkillById, getSkillLoadState, getAllSkills } from '../skills/registry.js';
```

Add a helper function for skill management before the `executeTool` function:

```typescript
import { writeFile as fsWriteFile, readFile as fsReadFile, mkdir, rm, access } from 'fs/promises';

async function skillCreate(args: ToolArgs): Promise<unknown> {
  const id = args.id as string;
  const name = args.name as string;
  const description = args.description as string;
  const code = args.code as string;
  const parameters = args.parameters as Record<string, unknown> | undefined;
  const tags = args.tags ? (args.tags as string).split(',').map((t) => t.trim()).filter(Boolean) : undefined;

  const skillDir = join(config.skillsDir, id);

  // Check if skill already exists
  try {
    await access(skillDir);
    throw new Error(`Skill "${id}" already exists. Use skill_update to modify it.`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }

  const manifest = {
    id,
    name,
    description,
    version: '1.0.0',
    ...(parameters ? { parameters } : {}),
    createdBy: 'devo',
    ...(tags ? { tags } : {}),
  };

  await mkdir(skillDir, { recursive: true });
  await fsWriteFile(join(skillDir, 'skill.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  await fsWriteFile(join(skillDir, 'execute.ts'), code, 'utf-8');

  // Reload to register the new skill as a tool
  const loadResult = await refreshSkills();
  const toolName = `skill_${id.replace(/-/g, '_')}`;

  return {
    created: true,
    skillId: id,
    toolName,
    skillsLoaded: loadResult.count,
    errors: loadResult.errors,
  };
}

async function skillUpdate(args: ToolArgs): Promise<unknown> {
  const id = args.id as string;
  const skillDir = join(config.skillsDir, id);

  // Verify skill exists
  const existing = getSkillById(id);
  if (!existing) {
    throw new Error(`Skill "${id}" not found`);
  }

  // Update code if provided
  if (args.code) {
    await fsWriteFile(join(skillDir, 'execute.ts'), args.code as string, 'utf-8');
  }

  // Update manifest fields if provided
  if (args.description || args.parameters) {
    const manifestPath = join(skillDir, 'skill.json');
    const raw = await fsReadFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw);

    if (args.description) manifest.description = args.description;
    if (args.parameters) manifest.parameters = args.parameters;

    await fsWriteFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  // Reload to re-register
  await refreshSkills();

  return { updated: true, skillId: id };
}

async function skillDelete(args: ToolArgs): Promise<unknown> {
  const id = args.id as string;
  const skillDir = join(config.skillsDir, id);

  const existing = getSkillById(id);
  if (!existing) {
    throw new Error(`Skill "${id}" not found`);
  }

  await rm(skillDir, { recursive: true, force: true });
  await refreshSkills();

  return { deleted: true, skillId: id };
}
```

Add switch cases inside the `executeTool` function's switch statement (before the `default:` case):

```typescript
        // Skill Management Tools
        case 'skill_create':
          return skillCreate(args);

        case 'skill_update':
          return skillUpdate(args);

        case 'skill_delete':
          return skillDelete(args);

        case 'skill_reload':
          return refreshSkills();

        case 'skill_list':
          return {
            skills: getSkillSummaries(),
            ...getSkillLoadState(),
          };
```

Also add a dynamic skill execution handler. In the `default:` case, BEFORE the MCP routing, add:

```typescript
        default: {
          // Route dynamic skill tools (skill_<id>) to the skill runner
          if (normalizedToolName.startsWith('skill_')) {
            // Extract skill ID: skill_generate_image -> generate-image
            const skillId = normalizedToolName.slice(6).replace(/_/g, '-');
            const skill = getSkillById(skillId);
            if (skill) {
              return executeSkill(skillId, args);
            }
          }

          // Route MCP tools to the MCP manager
          if (mcpManager.isMcpTool(normalizedToolName)) {
```

**Step 4: Add skill management tools to READ_ONLY_TOOLS set**

In `executor.ts`, add `'skill_list'` and `'skill_reload'` to the `READ_ONLY_TOOLS` set.

**Step 5: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add apps/api/src/tools/registry.ts apps/api/src/tools/executor.ts && git commit -m "feat(skills): add skill management tools and dynamic skill execution routing"
```

---

### Task 5: Grant Skill Tools to Agents

**Files:**
- Modify: `apps/api/src/agents/devo.ts`
- Modify: `apps/api/src/agents/chapo.ts`

**Step 1: Add skill tools to DEVO**

In `apps/api/src/agents/devo.ts`, add to the `tools` array (before `'delegateToScout'`):

```typescript
    // Skill management
    'skill_create',
    'skill_update',
    'skill_delete',
    'skill_reload',
    'skill_list',
```

**Step 2: Add skill tools to CHAPO**

In `apps/api/src/agents/chapo.ts`, add to the `tools` array (before `'delegateToDevo'`):

```typescript
    // Skill tools (read-only management)
    'skill_list',
    'skill_reload',
```

**Step 3: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add apps/api/src/agents/devo.ts apps/api/src/agents/chapo.ts && git commit -m "feat(agents): grant skill management tools to DEVO and CHAPO"
```

---

### Task 6: Update Agent Prompts

**Files:**
- Modify: `apps/api/src/prompts/devo.ts`
- Modify: `apps/api/src/prompts/chapo.ts`

**Step 1: Add skill section to DEVO prompt**

In `apps/api/src/prompts/devo.ts`, add before `## CODE BEST PRACTICES`:

```typescript
### Skill Management
- skill_create(id, name, description, code, parameters?, tags?) - Neuen Skill erstellen
- skill_update(id, code?, description?, parameters?) - Bestehenden Skill aktualisieren
- skill_delete(id) - Skill löschen
- skill_reload() - Alle Skills neu laden
- skill_list() - Verfügbare Skills anzeigen

## SKILL-ERSTELLUNG

Du kannst neue Skills erstellen mit skill_create. Ein Skill ist eine TypeScript-Funktion:

\\\`\\\`\\\`typescript
import type { SkillContext, SkillResult } from '@devai/shared';

export async function execute(
  args: Record<string, unknown>,
  ctx: SkillContext
): Promise<SkillResult> {
  // ctx.fetch — HTTP Client für API-Aufrufe
  // ctx.env — Umgebungsvariablen (API Keys etc.)
  // ctx.readFile / ctx.writeFile — Dateizugriff
  // ctx.log — Ausführungs-Log
  return { success: true, result: { output: 'done' } };
}
\\\`\\\`\\\`

**Regeln:**
- Skills dürfen NICHT aus apps/api/src/ importieren — alles über ctx
- Teste jeden neuen Skill einmal nach Erstellung
- Skill-IDs: lowercase mit Bindestrichen (z.B. "generate-image")
```

**Step 2: Add skill section to CHAPO prompt**

In `apps/api/src/prompts/chapo.ts`, add before `## DELEGATIONS-CONTRACT (PFLICHT)`:

```typescript
## SKILLS

Du hast Zugriff auf dynamische Skills — wiederverwendbare Fähigkeiten die DEVO erstellt hat.
Nutze skill_list() um verfügbare Skills zu sehen.
Wenn ein User eine Aufgabe beschreibt die ein Skill werden könnte, schlage es vor:
"Das könnte ein guter Skill werden — soll ich einen erstellen?"
Delegiere Skill-Erstellung an DEVO mit klarer Spezifikation:
- Was der Skill tun soll
- Welche Parameter er braucht
- Welche APIs/Services er nutzt
```

**Step 3: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add apps/api/src/prompts/devo.ts apps/api/src/prompts/chapo.ts && git commit -m "feat(prompts): add skill creation docs to DEVO and CHAPO prompts"
```

---

### Task 7: Load Skills on Server Startup

**Files:**
- Modify: `apps/api/src/server.ts`

**Step 1: Add skill loading on startup**

Find the section where routes are registered and add after all route registrations:

```typescript
import { refreshSkills } from './skills/registry.js';
```

And after route registration:

```typescript
  // Load skills and register as tools
  const skillResult = await refreshSkills();
  console.info(`[server] Skills loaded: ${skillResult.count} skills, ${skillResult.errors.length} errors`);
```

**Step 2: Commit**

```bash
cd /opt/Klyde/projects/Devai && git add apps/api/src/server.ts && git commit -m "feat(server): load skills on startup"
```

---

### Task 8: Verification

**Step 1: Check TypeScript compilation**

Run: `cd /opt/Klyde/projects/Devai/apps/api && npx tsc --noEmit 2>&1 | grep -E "(skill|Skill)" | head -20`
Expected: No NEW errors related to skill files (pre-existing errors are OK)

**Step 2: Run existing tests**

Run: `cd /opt/Klyde/projects/Devai/apps/api && npx vitest run`
Expected: All previously passing tests still pass

**Step 3: Test on Clawd**

After Mutagen sync:

```bash
# Restart API
ssh root@10.0.0.5 "pm2 restart devai-api-dev"

# Wait for boot
sleep 5

# Check health
ssh root@10.0.0.5 "curl -s http://localhost:3009/api/health | python3 -c 'import sys,json; print(json.load(sys.stdin)[\"status\"])'"

# Check skills loaded
ssh root@10.0.0.5 "curl -s http://localhost:3009/api/skills | python3 -m json.tool"
```

Expected: Health returns "ok", skills endpoint shows the example skill.

**Step 4: Commit any fixes**

```bash
cd /opt/Klyde/projects/Devai && git add -A && git commit -m "fix: address issues from skill system verification"
```

---

## Summary

| Task | Files | What |
|------|-------|------|
| 1 | `shared/src/skills.ts`, `shared/src/skill-runtime.ts`, `shared/src/index.ts` | New types |
| 2 | `apps/api/src/skills/loader.ts`, `apps/api/src/skills/registry.ts`, `skills/*` | Loader + registry + example |
| 3 | `apps/api/src/skills/runner.ts` | Skill execution engine |
| 4 | `apps/api/src/tools/registry.ts`, `apps/api/src/tools/executor.ts` | Tool definitions + routing |
| 5 | `apps/api/src/agents/devo.ts`, `apps/api/src/agents/chapo.ts` | Agent access |
| 6 | `apps/api/src/prompts/devo.ts`, `apps/api/src/prompts/chapo.ts` | Agent prompts |
| 7 | `apps/api/src/server.ts` | Startup loading |
| 8 | — | Verification |
