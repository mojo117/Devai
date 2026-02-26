# Structured Memory System — Design

**Goal:** Replace scattered memory files (MEMORY.md, daily files, RECENT_FOCUS.md) and hidden DB injection with a single, structured `memory.md` that serves as both the readable frontend and the CHAPO context source.

**Approach:** Hybrid — Supabase DB stays as backend (embeddings, search, decay), `memory.md` is rendered from it.

---

## The `memory.md` Structure

Lives at `workspace/memory.md`. Single file, loaded into CHAPO context via `workspaceMdLoader`.

```markdown
# Memory

## User
- Jörn, Deutsch, CET/CEST
- Watchlist: /root/home/orga/WATCHLIST.md (Movies & Serien)

## Projekte
- DevAI hat 41 Tasks (Done, To-Do, Backlog, Ideas, In Arbeit, Test)
- Duplicate Tasks: "Devai kann sich selbst neue skills bauen" und "Skill-Erstellungsfähigkeit"

## Workflows
- Scheduler/Reminder: IMMER an CAIO delegieren, nie System-Cron
- TaskForge Tasks: Titel, Beschreibung, Priorität und Labels erforderlich

## Termine & Events
- 25.02.2026 11:00 — Termin Wernstedt (Telegram Reminder gesetzt)

## Erkenntnisse
- taskforge_list_tasks war truncated auf 240 chars (gefixt 23.02.2026)
```

Entries are short bullets. No metadata, no timestamps-as-headers. DB keeps the metadata.

---

## Sync Flow

**Writing (unchanged logic):**
1. `memory_remember` → saves to Supabase `devai_memories` (with embedding, type, namespace)
2. Session-end extraction → extracts candidates, deduplicates, stores new entries
3. **New:** After each write, `renderMemoryMd()` regenerates `workspace/memory.md` from DB

**Reading (simplified):**
- `workspaceMdLoader` loads `memory.md` instead of MEMORY.md + daily files
- No separate `memory_retrieval` block — the .md IS the memory context
- Vector search in DB stays for `memory_search` tool (on-demand)

**When rendering triggers:**
- After `memory_remember` (immediate)
- After session-end extraction (when new memories stored)
- After daily decay job (strengths change → order may shift)

---

## Context Blocks — Before & After

**Removed blocks:**
- `memory_retrieval` — integrated into memory.md
- `memory_quality` — diagnostics go to logs, not context
- `recent_focus` — topic weighting integrated into rendering

**Kept blocks:**
- `workspace_policy` (AGENTS.md, SOUL.md, USER.md + memory.md)
- `memory_behavior_policy` (static rules)
- `channel_context` (Telegram/Web-UI)
- `scheduler_errors` (live error buffer)
- `user_global_context` (settings)

**Token savings:** ~1,760 → ~1,200-1,400 tokens (less overhead from deduplication)

---

## Namespace-to-Category Mapping

| Namespace Prefix | → Section |
|---|---|
| `devai/user`, `personal` | `## User` |
| `devai/project/*` | `## Projekte` |
| `devai/global`, `architecture` | `## Projekte` |
| `persona/*` | **Not rendered** — identity lives in SOUL.md |
| `memory_type: procedural` | `## Workflows` |
| Date/appointment references | `## Termine & Events` |
| Everything else | `## Erkenntnisse` |

**Rendering rules:**
- Only `content` text as bullet (`- ...`)
- Max 200 chars per entry (truncated if longer)
- If two memories have >90% text overlap, render only the stronger one
- Token budget: ~3,000 tokens (~12,000 chars)
- Sorted by strength (highest first) within each category

---

## Extraction Quality

**Sharpen extraction prompt — do NOT extract:**
- Failed operations with no lasting value ("file not found", tool errors)
- Pure status messages ("task created", "commit pushed") — that's git history
- Identity statements ("I am Chapo") — lives in SOUL.md
- Duplicates of system prompt content (team roles, tool lists)

**Rendering as quality gate:** Even if bad memories enter the DB, the token budget naturally filters them out. Low-strength memories from irrelevant namespaces don't make it into memory.md.

---

## Files Changed

**New:**
| File | Purpose |
|---|---|
| `apps/api/src/memory/renderMemoryMd.ts` | Renders `memory.md` from DB — namespace mapping, dedup, budget |

**Modified:**
| File | Change |
|---|---|
| `apps/api/src/memory/extraction.ts` | Sharpen extraction prompt (noise filter) |
| `apps/api/src/memory/workspaceMemory.ts` | After `rememberNote()` → trigger `renderMemoryMd()` |
| `apps/api/src/scanner/workspaceMdLoader.ts` | Load `memory.md` instead of MEMORY.md + daily files |
| `apps/api/src/agents/systemContext.ts` | Remove `memory_retrieval`, `memory_quality`, `recent_focus` blocks |
| `apps/api/src/memory/service.ts` | `retrieveRelevantMemories()` only for `memory_search` tool, not context injection |
| `apps/api/src/scheduler/schedulerService.ts` | Decay job triggers `renderMemoryMd()` after run |

**Deleted:**
| File | Reason |
|---|---|
| `workspace/MEMORY.md` | Replaced by `workspace/memory.md` |
| `workspace/memory/RECENT_FOCUS.md` | No longer needed |
| `apps/api/src/memory/recentFocusRenderer.ts` | Topic rendering integrated into memory.md |

**Daily files (`workspace/memory/YYYY-MM-DD.md`):** Stay as archive, no longer loaded.

---

## Verification

1. `npx vitest run` — all tests green
2. Start new session → `memory.md` loaded instead of old blocks
3. `memory_remember "Test"` → DB entry + memory.md updated immediately
4. Open `memory.md` → readable, categorized overview
5. Check PM2 logs for `assembled profile` → no more `memory_retrieval`, `memory_quality`, `recent_focus` blocks
