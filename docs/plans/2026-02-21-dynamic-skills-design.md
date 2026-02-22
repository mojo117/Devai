# Dynamic Skills System — Design

**Goal:** Let Devai agents create, manage, and execute reusable skills — self-contained TypeScript functions that extend agent capabilities at runtime.

**Architecture:** Skills are folders under `skills/` with a `skill.json` manifest and an `execute.ts` file. The skill runner registers each skill as a tool (`skill_<id>`) in the unified tool registry. CHAPO designs skills, DEVO implements them. Skills are live immediately after creation.

**Tech Stack:** TypeScript, tsx (dynamic import), existing Devai tool infrastructure

---

## 1. What a Skill Is

A skill is a self-contained capability in its own folder:

```
skills/
└── generate-image/
    ├── skill.json      # Manifest: id, name, description, parameters
    └── execute.ts       # Logic: exported execute() function
```

**`skill.json`** — defines what the skill does and what inputs it needs:

```json
{
  "id": "generate-image",
  "name": "Bildgenerierung",
  "description": "Generiert Bilder mit DALL-E basierend auf Textbeschreibungen",
  "version": "1.0.0",
  "parameters": {
    "prompt": { "type": "string", "required": true, "description": "Bildbeschreibung" },
    "size": { "type": "string", "default": "1024x1024" }
  },
  "createdBy": "devo",
  "tags": ["image", "openai"]
}
```

**`execute.ts`** — the actual logic. A single exported `execute()` function that receives parameters and returns a result. Skills get a sandboxed context object with helpers — no imports from Devai internals.

The old `toolAllowList` and `systemPrompt` fields are removed from the manifest. Skills are callable functions, not prompt overlays.

---

## 2. How Skills Are Called

Skills register as regular tools. Agents call them like any other tool:

```
skill_generate_image({ prompt: "A cat in space", size: "1024x1024" })
```

**Execution flow:**

1. Agent calls `skill_generate_image` with arguments
2. Executor detects `skill_` prefix → routes to skill runner
3. Skill runner dynamically imports `skills/generate-image/execute.ts`
4. Calls `execute(args, context)` where `context` provides helpers
5. Returns the result to the agent as a normal tool result

**Why register as tools?** The entire agent infrastructure already handles tools — LLM formatting, parallel execution, audit logging, error handling. Skills get all of this for free.

---

## 3. How Skills Are Created

**User-initiated:** User says "Erstell mir einen Skill der Bilder generiert." CHAPO designs the spec, delegates to DEVO. DEVO writes `skill.json` + `execute.ts`, calls `skill_reload`, tests the skill, reports back.

**Agent-proposed:** CHAPO notices the user keeps asking for something that could be a reusable capability. CHAPO suggests: "Das könnte ein guter Skill werden — soll ich einen erstellen?" If agreed, same flow.

**DEVO's creation flow:**

1. Creates `skills/<skill-id>/` directory
2. Writes `skill.json` with manifest
3. Writes `execute.ts` with implementation
4. Calls `skill_reload` to refresh the registry
5. Tests the skill by calling it once
6. Reports back to CHAPO with the result

No approval gate — skills are live immediately.

---

## 4. The `execute.ts` Contract

Every skill exports a single function with a strict contract:

```typescript
import type { SkillContext, SkillResult } from "@devai/skill-runtime";

export async function execute(
  args: Record<string, unknown>,
  ctx: SkillContext
): Promise<SkillResult> {
  const response = await ctx.fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ctx.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt: args.prompt,
      size: args.size || "1024x1024",
    }),
  });

  const data = await response.json();
  return {
    success: true,
    result: { imageUrl: data.data[0].url },
  };
}
```

**`SkillContext` provides:**

- `fetch` — standard HTTP client (no restrictions)
- `env` — read-only access to environment variables (API keys etc.)
- `writeFile(path, content)` — write files within allowed roots
- `readFile(path)` — read files within allowed roots
- `log(message)` — append to skill execution log

**`SkillResult` returns:**

- `success: boolean`
- `result?: unknown` — any structured data the agent receives back
- `error?: string` — error message on failure

Type definitions live in `shared/src/skill-runtime.ts`. Skills must NOT import from `apps/api/src/` directly — they get everything through `ctx`.

---

## 5. Skill Runner & Registration

The skill runner bridges the executor and skill code. Lives at `apps/api/src/skills/runner.ts`.

**Loading:** On `skill_reload` (or first access), the runner scans `skills/*/skill.json`, validates each manifest, and registers a tool per skill:

```typescript
toolRegistry.register({
  name: `skill_${manifest.id}`,
  description: manifest.description,
  parameters: buildParametersFromManifest(manifest.parameters),
  requiresConfirmation: false,
  category: 'native',
});
```

**Execution:** When the executor hits a `skill_*` tool call:

1. Strip `skill_` prefix → get skill ID
2. Look up manifest in skill registry
3. Build `SkillContext` (fetch, env, readFile, writeFile, log)
4. Dynamically import `execute.ts` via tsx
5. Call `execute(args, ctx)` with timeout (default 30s)
6. Return `SkillResult` as the tool result
7. Log execution to audit trail

**Tool access:** Skill tools granted to CHAPO and DEVO by default. SCOUT stays read-only. CAIO gets skills tagged `communication` only.

**Error handling:** If `execute.ts` throws, the runner catches it, returns `{ success: false, error }`, and logs the failure. Broken skills don't crash the API.

---

## 6. Management Tools for DEVO

Five new tools for skill lifecycle:

**`skill_create`** — Atomic skill creation:
- Args: `id`, `name`, `description`, `parameters`, `code`, `tags`
- Creates `skills/<id>/` directory, writes manifest + code, reloads registry
- Fails if skill ID already exists

**`skill_update`** — Modify an existing skill:
- Args: `id`, `code?`, `description?`, `parameters?`
- Overwrites specified fields, re-registers the tool

**`skill_delete`** — Remove a skill:
- Args: `id`
- Removes `skills/<id>/` directory, unregisters tool
- Requires confirmation (only destructive operation)

**`skill_reload`** — Rescan skills directory and re-register all skills.

**`skill_list`** — List all loaded skills with status (active/error).

Access: DEVO gets all five. CHAPO gets `skill_list` and `skill_reload` only.

---

## 7. Prompt Updates

**CHAPO prompt** — new section:

```
## SKILLS
Du hast Zugriff auf dynamische Skills — wiederverwendbare Fähigkeiten die DEVO erstellt hat.
Nutze skill_list um verfügbare Skills zu sehen.
Wenn ein User eine Aufgabe beschreibt die ein Skill werden könnte, schlage es vor.
Delegiere Skill-Erstellung an DEVO mit klarer Spezifikation:
- Was der Skill tun soll
- Welche Parameter er braucht
- Welche APIs/Services er nutzt
```

**DEVO prompt** — new section:

```
## SKILL-ERSTELLUNG
Du kannst neue Skills erstellen mit skill_create.
Ein Skill ist eine TypeScript-Funktion mit execute(args, ctx) Signatur.
ctx bietet: fetch, env, readFile, writeFile, log.
Skills dürfen NICHT aus apps/api/src/ importieren.
Teste jeden neuen Skill einmal nach Erstellung.
```

Skills register as regular tools, so agents see them in their tool list automatically. No per-skill prompt injection needed.

---

## Summary of Changes

| Component | Change |
|-----------|--------|
| `shared/src/skills.ts` | Replace `SkillManifest` with new format (parameters, createdBy, remove toolAllowList/systemPrompt) |
| `shared/src/skill-runtime.ts` | New file: `SkillContext`, `SkillResult` type definitions |
| `skills/example/` | Update example to new format |
| `apps/api/src/skills/loader.ts` | Update Zod schema for new manifest format |
| `apps/api/src/skills/registry.ts` | Add skill → tool registration on load |
| `apps/api/src/skills/runner.ts` | New file: dynamic import + execution + context building |
| `apps/api/src/tools/registry.ts` | Add 5 skill management tool definitions |
| `apps/api/src/tools/executor.ts` | Add skill_* routing to runner + 5 management tool cases |
| `apps/api/src/agents/chapo.ts` | Grant `skill_list`, `skill_reload` |
| `apps/api/src/agents/devo.ts` | Grant all 5 skill tools |
| `apps/api/src/prompts/chapo.ts` | Add SKILLS section |
| `apps/api/src/prompts/devo.ts` | Add SKILL-ERSTELLUNG section |
