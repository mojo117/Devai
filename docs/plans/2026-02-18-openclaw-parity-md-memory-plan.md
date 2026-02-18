# OpenClaw-Style Markdown Context + Persistent Memory Plan (DevAI)

Date: 2026-02-18  
Owner: DevAI team  
Target runtime: Clawd server (`/opt/Devai`) running in parallel with OpenClaw (`/root/openclaw`, `/root/.openclaw`)

## Goal

Make DevAI feel more like OpenClaw by:

1. Loading a structured set of Markdown context files on every new chat turn.
2. Supporting persistent memory (daily + long-term).
3. Keeping DevAI and OpenClaw isolated but parallel on Clawd.

## Current State (Verified)

- DevAI currently loads:
  - `devai.md` via `apps/api/src/scanner/devaiMdLoader.ts`
  - `CLAUDE.md` chain via `apps/api/src/scanner/claudeMdLoader.ts`
- Session chat history persistence already exists (Supabase `messages`, replay of last 30 messages in WS route).
- Global context API exists (`/settings/global-context`) but is not injected into agent prompts yet.
- OpenClaw workspace pattern exists at `/root/.openclaw/workspace` with files like:
  - `AGENTS.md`, `SOUL.md`, `USER.md`, `TOOLS.md`, `MEMORY.md`, `memory/YYYY-MM-DD.md`

## Key Decision

Do **not** copy all OpenClaw markdown files.  
Instead, copy only the **instruction/memory workspace pattern** and add DevAI equivalents with the same purpose.

Reason: full OpenClaw docs are very large and include unrelated product docs; loading all of them would hurt relevance and token budget.

## Target DevAI Workspace Layout (Clawd)

Create a dedicated DevAI memory/context workspace:

`/opt/Devai/workspace/`

Files:

- `AGENTS.md` (session rules + load order)
- `SOUL.md` (assistant behavior/personality)
- `USER.md` (user profile/preferences)
- `TOOLS.md` (local machine-specific notes)
- `MEMORY.md` (long-term curated memory)
- `memory/YYYY-MM-DD.md` (daily memory logs)

## Load Policy Per New Chat Request

Order (top to bottom in prompt):

1. `devai.md` (global DevAI rules)
2. project `CLAUDE.md` chain (already implemented)
3. workspace context bundle:
   - `AGENTS.md`
   - `SOUL.md`
   - `USER.md`
   - `TOOLS.md`
   - `memory/today.md`
   - `memory/yesterday.md`
   - `MEMORY.md` (only for private/main chat mode)
4. `globalContext` from settings (if enabled)

Guardrails:

- Hard character/token cap for workspace block (example: 24k chars).
- Deterministic truncation with source markers.
- Per-file max to prevent one file from dominating.

## Architecture Changes

### 1) New Loader

Add `apps/api/src/scanner/workspaceMdLoader.ts`:

- Resolve workspace path from env (default `/opt/Devai/workspace` on Clawd).
- Load required files by role.
- Return `{ files, combined, diagnostics }`.
- Support load mode:
  - `main`: include `MEMORY.md`
  - `shared`: exclude `MEMORY.md`

### 2) Prompt Composition Unification

Create a helper in API layer (for both router paths):

- `buildSystemContextBlocks(sessionId, projectRoot, chatMode)`
- Includes `devaiMdBlock`, `claudeMdBlock`, `workspaceMdBlock`, `globalContextBlock`

Use this helper in:

- `apps/api/src/agents/router.ts` (legacy router)
- `apps/api/src/agents/executor.ts` (new router execution path)
- analyzer/synthesizer prompt path where needed for consistency

### 3) Global Context Wiring

Load `globalContext` setting once per request and inject as a dedicated block:

- label clearly: `## User Global Context`
- support `enabled` flag from existing settings payload

## Persistent Memory Design

## MVP (File-first, immediate)

- Memory source of truth is markdown files in `/opt/Devai/workspace`.
- Add API utility methods:
  - append daily note (`memory/YYYY-MM-DD.md`)
  - update/replace `MEMORY.md` sections
- Add explicit assistant behavior rule:
  - when user says "remember this", write to daily memory
  - optionally promote to `MEMORY.md` if durable preference/fact

## Phase 2 (Hybrid index, optional)

- Add DB table `memory_entries` (or SQLite sidecar) for fast retrieval:
  - `id`, `user_id`, `kind`, `content`, `source_file`, `source_date`, `tags`, `created_at`
- Keep markdown canonical; index is derived/rebuildable.
- Add recall endpoint/tool:
  - search by keyword/date/tag

## Parallel-Run Safety (DevAI + OpenClaw)

- Keep separate roots:
  - DevAI: `/opt/Devai/*`
  - OpenClaw: `/root/.openclaw/*` and `/root/openclaw/*`
- No shared config or memory files.
- No PM2/process/port changes required for this feature.
- No `.env` changes unless explicitly approved later.

## Implementation Phases

### Phase 0 - Foundation (0.5 day)

- Create workspace directory/files for DevAI on Clawd.
- Seed templates (adapted from OpenClaw templates, no personal secrets copied).
- Add docs for expected file purpose.

### Phase 1 - Loader + Prompt Injection (1-1.5 days)

- Implement `workspaceMdLoader.ts`
- Integrate in both router paths
- Inject global context block
- Add caps/truncation diagnostics

### Phase 2 - Memory Write/Recall MVP (1 day)

- Add file utilities + API endpoints/tool wrappers
- Add "remember this" behavior contract
- Add basic retrieval by keyword/date from markdown

### Phase 3 - UI + Controls (0.5-1 day)

- Expose workspace memory status in UI/settings
- Optional toggle for including `MEMORY.md` in non-private contexts

### Phase 4 - Test + Rollout (0.5 day)

- Unit tests for loader ordering, truncation, mode gating
- Integration test for prompt composition
- Smoke test on Clawd dev runtime

## Acceptance Criteria

- New chat turn includes expected markdown blocks in deterministic order.
- DevAI recalls prior user facts across restarts (from workspace files).
- "Remember this" creates/updates daily memory file.
- `MEMORY.md` is excluded from shared-mode chats.
- DevAI and OpenClaw continue running in parallel with no file or process conflict.

## Risks and Mitigations

- Risk: prompt bloat from too many markdown files
  - Mitigation: strict caps + per-file budgets + truncation markers
- Risk: sensitive data leakage from long-term memory
  - Mitigation: chat-mode gating + explicit include rules
- Risk: behavior drift across legacy/new router
  - Mitigation: centralized context builder used by both paths

## Suggested Next Execution Plan

1. Implement Phase 1 first (loader + prompt wiring + global context), no infra changes.
2. Then implement Phase 2 memory write/read MVP.
3. Validate with 5 scripted memory scenarios (remember, recall, restart, shared-mode, truncation).
