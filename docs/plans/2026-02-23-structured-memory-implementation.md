# Structured Memory System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace scattered memory files (MEMORY.md, daily files, RECENT_FOCUS.md) and hidden DB-to-context injection with a single `memory.md` rendered from Supabase, serving as both the readable frontend and the CHAPO context source.

**Architecture:** Supabase `devai_memories` stays as the backend (embeddings, search, decay). A new `renderMemoryMd()` function queries the DB, groups memories by namespace→category, deduplicates, budget-caps, and writes `workspace/memory.md`. The workspace loader loads `memory.md` instead of MEMORY.md + daily files. Context blocks `memory_retrieval`, `memory_quality`, and `recent_focus` are removed from `systemContext.ts`.

**Tech Stack:** TypeScript, Supabase (pgvector), Vitest, Node.js fs/promises

**Design doc:** `docs/plans/2026-02-23-structured-memory-design.md`

---

### Task 1: Create `renderMemoryMd.ts` — the core renderer

**Files:**
- Create: `apps/api/src/memory/renderMemoryMd.ts`
- Test: `apps/api/src/memory/renderMemoryMd.test.ts`

This module queries `devai_memories` (valid, strength-sorted), maps namespaces to categories, deduplicates by text overlap, respects a character budget, and writes `workspace/memory.md`.

**Step 1: Write the failing test**

Create `apps/api/src/memory/renderMemoryMd.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase before importing
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();

const supabaseMock = vi.hoisted(() => ({
  getSupabase: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            data: [],
            error: null,
          })),
        })),
      })),
    })),
  })),
}));

vi.mock('../db/index.js', () => supabaseMock);

// Mock fs
const fsMock = vi.hoisted(() => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockRejectedValue(new Error('ENOENT')),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('fs/promises', () => fsMock);

import { mapNamespaceToCategory, renderMemoryMd, CATEGORY_ORDER } from './renderMemoryMd.js';

describe('mapNamespaceToCategory', () => {
  it('maps devai/user to User', () => {
    expect(mapNamespaceToCategory('devai/user', 'semantic')).toBe('User');
  });

  it('maps personal to User', () => {
    expect(mapNamespaceToCategory('personal', 'semantic')).toBe('User');
  });

  it('maps devai/project/* to Projekte', () => {
    expect(mapNamespaceToCategory('devai/project/taskforge', 'semantic')).toBe('Projekte');
  });

  it('maps devai/global to Projekte', () => {
    expect(mapNamespaceToCategory('devai/global', 'semantic')).toBe('Projekte');
  });

  it('maps architecture to Projekte', () => {
    expect(mapNamespaceToCategory('architecture', 'semantic')).toBe('Projekte');
  });

  it('skips persona namespace (returns null)', () => {
    expect(mapNamespaceToCategory('persona/chapo', 'semantic')).toBeNull();
  });

  it('maps procedural type to Workflows', () => {
    expect(mapNamespaceToCategory('devai/general', 'procedural')).toBe('Workflows');
  });

  it('maps unknown namespace to Erkenntnisse', () => {
    expect(mapNamespaceToCategory('devai/general', 'semantic')).toBe('Erkenntnisse');
  });
});

describe('CATEGORY_ORDER', () => {
  it('has 5 categories in correct order', () => {
    expect(CATEGORY_ORDER).toEqual(['User', 'Projekte', 'Workflows', 'Termine & Events', 'Erkenntnisse']);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /opt/Klyde/projects/Devai && npx vitest run apps/api/src/memory/renderMemoryMd.test.ts`
Expected: FAIL — module `./renderMemoryMd.js` not found

**Step 3: Write the implementation**

Create `apps/api/src/memory/renderMemoryMd.ts`:

```typescript
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { getSupabase } from '../db/index.js';
import { resolveWorkspaceRoot } from './workspaceMemory.js';
import type { MemoryType } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ENTRY_CHARS = 200;
const MAX_TOTAL_CHARS = 12000;
const OVERLAP_THRESHOLD = 0.9;

export const CATEGORY_ORDER = [
  'User',
  'Projekte',
  'Workflows',
  'Termine & Events',
  'Erkenntnisse',
] as const;

export type MemoryCategory = (typeof CATEGORY_ORDER)[number];

// ---------------------------------------------------------------------------
// Namespace → Category mapping
// ---------------------------------------------------------------------------

export function mapNamespaceToCategory(
  namespace: string,
  memoryType: MemoryType,
): MemoryCategory | null {
  const ns = namespace.toLowerCase();

  // persona/* → not rendered (identity lives in SOUL.md)
  if (ns.startsWith('persona')) return null;

  // devai/user, personal → User
  if (ns.startsWith('devai/user') || ns === 'personal') return 'User';

  // procedural type → Workflows (regardless of namespace)
  if (memoryType === 'procedural') return 'Workflows';

  // devai/project/*, devai/global, architecture → Projekte
  if (
    ns.startsWith('devai/project') ||
    ns === 'devai/global' ||
    ns.startsWith('architecture')
  ) {
    return 'Projekte';
  }

  // Fallback
  return 'Erkenntnisse';
}

// ---------------------------------------------------------------------------
// Deduplication: simple trigram-based overlap check
// ---------------------------------------------------------------------------

function normalizeForComparison(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function computeOverlap(a: string, b: string): number {
  const normA = normalizeForComparison(a);
  const normB = normalizeForComparison(b);

  if (normA === normB) return 1.0;

  const shorter = normA.length <= normB.length ? normA : normB;
  const longer = normA.length > normB.length ? normA : normB;

  if (shorter.length === 0) return 0;

  // Character-level overlap ratio
  let matches = 0;
  const windowSize = Math.min(3, shorter.length);

  for (let i = 0; i <= shorter.length - windowSize; i++) {
    const trigram = shorter.slice(i, i + windowSize);
    if (longer.includes(trigram)) matches++;
  }

  const totalTrigrams = shorter.length - windowSize + 1;
  return totalTrigrams > 0 ? matches / totalTrigrams : 0;
}

// ---------------------------------------------------------------------------
// DB row type (what we SELECT)
// ---------------------------------------------------------------------------

interface MemoryRow {
  id: string;
  content: string;
  memory_type: MemoryType;
  namespace: string;
  strength: number;
  priority: string;
}

// ---------------------------------------------------------------------------
// Core: renderMemoryMd
// ---------------------------------------------------------------------------

export async function renderMemoryMd(workspaceRoot?: string): Promise<string> {
  const root = await resolveWorkspaceRoot(workspaceRoot);
  await mkdir(root, { recursive: true });

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('devai_memories')
    .select('id, content, memory_type, namespace, strength, priority')
    .eq('is_valid', true)
    .order('strength', { ascending: false });

  if (error) {
    console.error('[renderMemoryMd] DB query failed:', error);
    throw error;
  }

  const rows = (data as MemoryRow[]) ?? [];

  // Group by category
  const groups = new Map<MemoryCategory, MemoryRow[]>();
  for (const cat of CATEGORY_ORDER) {
    groups.set(cat, []);
  }

  for (const row of rows) {
    const category = mapNamespaceToCategory(row.namespace, row.memory_type);
    if (!category) continue;
    groups.get(category)!.push(row);
  }

  // Build markdown with deduplication and budget
  const lines: string[] = ['# Memory', ''];
  let totalChars = lines.join('\n').length;

  for (const category of CATEGORY_ORDER) {
    const items = groups.get(category) ?? [];
    if (items.length === 0) continue;

    const header = `## ${category}`;
    const headerLen = header.length + 1; // +1 for newline

    if (totalChars + headerLen > MAX_TOTAL_CHARS) break;

    const bulletLines: string[] = [];
    const accepted: string[] = []; // track accepted content for dedup

    for (const item of items) {
      let content = item.content.trim();
      if (content.length > MAX_ENTRY_CHARS) {
        content = content.slice(0, MAX_ENTRY_CHARS - 3) + '...';
      }

      // Dedup: skip if >90% overlap with any already-accepted entry
      const isDuplicate = accepted.some(
        (existing) => computeOverlap(existing, content) >= OVERLAP_THRESHOLD,
      );
      if (isDuplicate) continue;

      const bullet = `- ${content}`;
      const bulletLen = bullet.length + 1;

      if (totalChars + headerLen + bulletLen > MAX_TOTAL_CHARS) break;

      bulletLines.push(bullet);
      accepted.push(content);
      totalChars += bulletLen;
    }

    if (bulletLines.length > 0) {
      totalChars += headerLen;
      lines.push(header);
      lines.push(...bulletLines);
      lines.push('');
    }
  }

  const markdown = lines.join('\n');
  const filePath = join(root, 'memory.md');
  await writeFile(filePath, markdown, 'utf-8');

  console.log(`[renderMemoryMd] Wrote ${filePath} (${markdown.length} chars, ${rows.length} DB rows)`);
  return filePath;
}
```

**Step 4: Run test to verify it passes**

Run: `cd /opt/Klyde/projects/Devai && npx vitest run apps/api/src/memory/renderMemoryMd.test.ts`
Expected: PASS — `mapNamespaceToCategory` and `CATEGORY_ORDER` tests green

**Step 5: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/memory/renderMemoryMd.ts apps/api/src/memory/renderMemoryMd.test.ts
git commit -m "feat(memory): add renderMemoryMd — namespace-to-category renderer with dedup and budget"
```

---

### Task 2: Update `workspaceMdLoader.ts` — load `memory.md` instead of MEMORY.md + daily files

**Files:**
- Modify: `apps/api/src/scanner/workspaceMdLoader.ts` (lines 58-76, `getWorkspaceFileSpecs`)
- Modify: `apps/api/src/scanner/workspaceMdLoader.test.ts`

**Step 1: Write the failing test**

In `apps/api/src/scanner/workspaceMdLoader.test.ts`, add a new test:

```typescript
it('loads memory.md instead of MEMORY.md and daily files in main mode', async () => {
  await writeWorkspaceFile(workspaceRoot, 'AGENTS.md', '# AGENTS');
  await writeWorkspaceFile(workspaceRoot, 'SOUL.md', '# SOUL');
  await writeWorkspaceFile(workspaceRoot, 'USER.md', '# USER');
  await writeWorkspaceFile(workspaceRoot, 'memory.md', '# Memory\n\n## User\n- Jörn');
  // Old files should be ignored even if present
  await writeWorkspaceFile(workspaceRoot, 'MEMORY.md', 'old long term memory');
  const today = new Date();
  await writeWorkspaceFile(workspaceRoot, `memory/${formatDateStamp(today)}.md`, 'old daily memory');

  const context = await loadWorkspaceMdContext({ mode: 'main', workspaceRoot });

  expect(context.files.some((f) => f.role === 'Structured Memory')).toBe(true);
  expect(context.combined).toContain('# Memory');
  expect(context.combined).toContain('Jörn');
  // Old files not loaded
  expect(context.files.some((f) => f.role === 'Long-Term Memory')).toBe(false);
  expect(context.files.some((f) => f.role === 'Memory Today')).toBe(false);
  expect(context.combined).not.toContain('old long term memory');
  expect(context.combined).not.toContain('old daily memory');
});
```

**Step 2: Run test to verify it fails**

Run: `cd /opt/Klyde/projects/Devai && npx vitest run apps/api/src/scanner/workspaceMdLoader.test.ts`
Expected: FAIL — `Structured Memory` role not found, old files still loaded

**Step 3: Modify `workspaceMdLoader.ts`**

In `getWorkspaceFileSpecs()` (lines 58-76), replace the daily file + MEMORY.md specs with a single `memory.md` entry:

**Replace** lines 58-76:

```typescript
function getWorkspaceFileSpecs(mode: WorkspaceLoadMode): WorkspaceFileSpec[] {
  const specs: WorkspaceFileSpec[] = [
    { role: 'AGENTS', relativePath: 'AGENTS.md', required: true },
    { role: 'SOUL', relativePath: 'SOUL.md', required: true },
    { role: 'USER', relativePath: 'USER.md', required: true },
  ];

  if (mode === 'main') {
    specs.push({ role: 'Structured Memory', relativePath: 'memory.md', required: false });
  }

  return specs;
}
```

This removes:
- `Memory Today` (daily file for today)
- `Memory Yesterday` (daily file for yesterday)
- `Long-Term Memory` (MEMORY.md)

And replaces them with `Structured Memory` (`memory.md`) — only in `main` mode.

The `formatDateStamp` helper function is now unused. Remove it (lines 54-56).

**Step 4: Update the existing test**

The existing test `'loads MEMORY.md only in main mode'` needs to be rewritten to test the new `memory.md` behavior. Replace it:

```typescript
it('loads memory.md only in main mode', async () => {
  await writeWorkspaceFile(workspaceRoot, 'AGENTS.md', '# AGENTS');
  await writeWorkspaceFile(workspaceRoot, 'SOUL.md', '# SOUL');
  await writeWorkspaceFile(workspaceRoot, 'USER.md', '# USER');
  await writeWorkspaceFile(workspaceRoot, 'memory.md', '# Memory\n\n## User\n- Jörn');

  const mainContext = await loadWorkspaceMdContext({ mode: 'main', workspaceRoot });
  const sharedContext = await loadWorkspaceMdContext({ mode: 'shared', workspaceRoot });

  expect(mainContext.diagnostics.mode).toBe('main');
  expect(sharedContext.diagnostics.mode).toBe('shared');
  expect(mainContext.files.some((file) => file.role === 'Structured Memory')).toBe(true);
  expect(sharedContext.files.some((file) => file.role === 'Structured Memory')).toBe(false);
  expect(mainContext.combined).toContain('# Memory');
  expect(sharedContext.combined).not.toContain('# Memory');
});
```

Remove the `formatDateStamp` helper function from the test file — no longer needed.

**Step 5: Run tests to verify**

Run: `cd /opt/Klyde/projects/Devai && npx vitest run apps/api/src/scanner/workspaceMdLoader.test.ts`
Expected: PASS — all tests green

**Step 6: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/scanner/workspaceMdLoader.ts apps/api/src/scanner/workspaceMdLoader.test.ts
git commit -m "refactor(memory): load memory.md instead of MEMORY.md and daily files"
```

---

### Task 3: Remove `memory_retrieval`, `memory_quality`, `recent_focus` context blocks from `systemContext.ts`

**Files:**
- Modify: `apps/api/src/agents/systemContext.ts` (lines 168-201, 239-310)
- Modify: `apps/api/src/agents/systemContext.test.ts`

**Step 1: Modify `systemContext.ts`**

**a) Remove warm functions for memory and recent focus.** Delete:
- `warmMemoryBlockForSession()` (lines 168-190) — the per-message vector search injection
- `warmRecentFocusBlockForSession()` (lines 192-202) — the recent topics injection

**b) Remove their context block entries from `buildContextBlocks()`.** In the `primaryCandidates` array (lines 239-310), delete the three block objects with kind:
- `recent_focus`
- `memory_quality`
- `memory_retrieval`

**c) Remove the calls from `warmSystemContextForSession()`.** In lines 402-413, remove:
```typescript
await warmRecentFocusBlockForSession(sessionId);
if (userMessage) {
  await warmMemoryBlockForSession(sessionId, userMessage);
}
```

So `warmSystemContextForSession` becomes:
```typescript
export async function warmSystemContextForSession(
  sessionId: string,
  projectRoot: string | null,
): Promise<void> {
  await getWorkspaceMdBlockForSession(sessionId);
  await refreshGlobalContextBlockForSession(sessionId);
}
```

Note: The `userMessage` parameter is removed from the function signature.

**d) Remove unused imports.** Remove from the import section:
- `formatMemoryQualityBlock, retrieveRelevantMemories` from `'../memory/service.js'`
- `buildRecentFocusBlock, syncManualEdits` from `'../memory/recentFocusRenderer.js'`

**e) Remove unused helper variable.** The `memoryNamespaces` variable (line 233) is no longer used. Remove it and the `toStringArray` helper if it has no other callers.

**Step 2: Update callers of `warmSystemContextForSession`**

Search for all callers passing `userMessage` — they need to drop the third argument:

```bash
cd /opt/Klyde/projects/Devai && grep -rn 'warmSystemContextForSession' apps/api/src/
```

Update each callsite to remove the `userMessage` parameter.

**Step 3: Update `systemContext.test.ts`**

The test `'injects provenance-tagged blocks and exposes a context profile'` asserts `memory_behavior_policy` is present. This block is still present (it's a static policy block). Verify the test still passes.

If any test asserts `memory_retrieval` or `memory_quality` or `recent_focus` kinds exist, remove those assertions.

**Step 4: Run tests**

Run: `cd /opt/Klyde/projects/Devai && npx vitest run apps/api/src/agents/systemContext.test.ts`
Expected: PASS

Run: `cd /opt/Klyde/projects/Devai && npx vitest run`
Expected: All tests green

**Step 5: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/agents/systemContext.ts apps/api/src/agents/systemContext.test.ts
git commit -m "refactor(memory): remove memory_retrieval, memory_quality, recent_focus context blocks"
```

---

### Task 4: Wire `renderMemoryMd()` into `workspaceMemory.ts` — trigger after `rememberNote()`

**Files:**
- Modify: `apps/api/src/memory/workspaceMemory.ts` (lines 155-176, `rememberNote()`)

**Step 1: Modify `rememberNote()`**

After the daily/long-term write, fire-and-forget `renderMemoryMd()` to regenerate the structured file:

```typescript
import { renderMemoryMd } from './renderMemoryMd.js';

export async function rememberNote(
  content: string,
  options: {
    date?: string;
    workspaceRoot?: string | null;
    source?: string;
    sessionId?: string;
    promoteToLongTerm?: boolean;
  } = {}
): Promise<{
  daily: MemoryAppendResult;
  longTerm?: { workspaceRoot: string; filePath: string; entry: string };
}> {
  const daily = await appendDailyMemoryEntry(content, options);
  let longTerm: { workspaceRoot: string; filePath: string; entry: string } | undefined;

  if (options.promoteToLongTerm) {
    longTerm = await appendLongTermMemoryEntry(content, { workspaceRoot: options.workspaceRoot });
  }

  // Fire-and-forget: regenerate memory.md from DB
  renderMemoryMd(options.workspaceRoot ?? undefined).catch((err) =>
    console.error('[workspaceMemory] renderMemoryMd fire-and-forget failed:', err),
  );

  return { daily, longTerm };
}
```

**Step 2: Run existing tests**

Run: `cd /opt/Klyde/projects/Devai && npx vitest run apps/api/src/memory/workspaceMemory.test.ts`
Expected: PASS — existing tests unaffected (renderMemoryMd is fire-and-forget, tests mock fs)

**Step 3: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/memory/workspaceMemory.ts
git commit -m "feat(memory): trigger renderMemoryMd after rememberNote"
```

---

### Task 5: Wire `renderMemoryMd()` into extraction pipeline — trigger after session-end extraction

**Files:**
- Modify: `apps/api/src/memory/extraction.ts` (lines 202-230, `runExtractionPipeline()`)

**Step 1: Modify `runExtractionPipeline()`**

After `deduplicateAndStore()` completes, fire-and-forget `renderMemoryMd()`:

```typescript
import { renderMemoryMd } from './renderMemoryMd.js';

// ... inside runExtractionPipeline, after deduplicateAndStore:

  // Phase 2: Deduplicate and store
  const storeResult = await deduplicateAndStore(candidates, sessionId);

  // Phase 3: Re-render memory.md from updated DB state
  if (storeResult.added > 0 || storeResult.updated > 0) {
    renderMemoryMd().catch((err) =>
      console.error('[extraction] renderMemoryMd fire-and-forget failed:', err),
    );
  }
```

Only trigger if something actually changed (added > 0 or updated > 0).

**Step 2: Run tests**

Run: `cd /opt/Klyde/projects/Devai && npx vitest run apps/api/src/memory/`
Expected: PASS

**Step 3: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/memory/extraction.ts
git commit -m "feat(memory): trigger renderMemoryMd after extraction pipeline"
```

---

### Task 6: Wire `renderMemoryMd()` into decay job — trigger after daily decay

**Files:**
- Modify: `apps/api/src/services/systemReliability.ts` (lines 151-159)

**Step 1: Modify `memoryDecayJob()`**

After `runDecay()`, call `renderMemoryMd()` since strength changes may affect ordering:

```typescript
import { renderMemoryMd } from '../memory/renderMemoryMd.js';

export async function memoryDecayJob(): Promise<string> {
  const result = await runDecay();

  // Re-render memory.md — strength changes may affect ordering/inclusion
  await renderMemoryMd();

  return `Memory decay: ${result.decayed} decayed, ${result.pruned} pruned`;
}
```

Note: `await` (not fire-and-forget) because this runs in a maintenance job where we want to ensure completion.

**Step 2: Run tests**

Run: `cd /opt/Klyde/projects/Devai && npx vitest run`
Expected: PASS

**Step 3: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/services/systemReliability.ts
git commit -m "feat(memory): trigger renderMemoryMd after daily decay job"
```

---

### Task 7: Sharpen extraction prompt — reduce noise

**Files:**
- Modify: `apps/api/src/memory/extraction.ts` (lines 12-31, `EXTRACTION_PROMPT`)

**Step 1: Update the extraction prompt**

Add explicit noise filters to the `EXTRACTION_PROMPT` const. Append these rules to the existing rules list:

```
- Extrahiere NICHT: fehlgeschlagene Operationen ohne bleibenden Wert ("file not found", Tool-Fehler)
- Extrahiere NICHT: reine Statusmeldungen ("task created", "commit pushed") — das ist Git-History
- Extrahiere NICHT: Identitätsaussagen ("Ich bin Chapo") — das lebt in SOUL.md
- Extrahiere NICHT: Duplikate von Systemprompt-Inhalten (Team-Rollen, Tool-Listen)
- Extrahiere NICHT: temporäre Debug-Informationen oder Log-Ausgaben
```

**Step 2: Run tests**

Run: `cd /opt/Klyde/projects/Devai && npx vitest run apps/api/src/memory/`
Expected: PASS (extraction tests mock the LLM, prompt change doesn't break them)

**Step 3: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/memory/extraction.ts
git commit -m "refactor(memory): sharpen extraction prompt to reduce noise"
```

---

### Task 8: Delete obsolete files and clean up imports

**Files:**
- Delete: `apps/api/src/memory/recentFocusRenderer.ts`
- Delete: `workspace/MEMORY.md`
- Delete: `workspace/memory/RECENT_FOCUS.md`
- Modify: Any files importing from `recentFocusRenderer.ts`

**Step 1: Find all imports of recentFocusRenderer**

```bash
cd /opt/Klyde/projects/Devai && grep -rn 'recentFocusRenderer' apps/api/src/
```

Expected callers (from Task 3, already removed):
- `apps/api/src/agents/systemContext.ts` — `buildRecentFocusBlock, syncManualEdits` (already removed in Task 3)

Any remaining callers must be updated to remove the import.

**Step 2: Delete the files**

```bash
rm apps/api/src/memory/recentFocusRenderer.ts
rm workspace/MEMORY.md
rm -f workspace/memory/RECENT_FOCUS.md
```

**Step 3: Check for `MEMORY.md` references in code**

```bash
grep -rn 'MEMORY.md' apps/api/src/
```

- `workspaceMemory.ts` references `MEMORY.md` in `appendLongTermMemoryEntry()` (line 139) and `collectMemoryFiles()` (line 218). These functions are still used by the `memory_remember` tool for daily file writes. The daily file write can stay as an archive mechanism, but the `appendLongTermMemoryEntry()` and `MEMORY.md` creation logic should be removed since we no longer load MEMORY.md.

Remove from `workspaceMemory.ts`:
- `appendLongTermMemoryEntry()` function (lines 128-153)
- The `longTerm` branch in `rememberNote()` — `promoteToLongTerm` is no longer needed
- The `includeLongTerm` option in `searchWorkspaceMemory()` and `collectMemoryFiles()` — simplify to only search daily files
- The `buildLongTermEntry()` helper (lines 65-72)

Update `rememberNote()` return type — remove `longTerm` field.

Update `apps/api/src/tools/memory.ts` — remove `promoteToLongTerm` option and `longTermPath` from response.

**Step 4: Run full test suite**

Run: `cd /opt/Klyde/projects/Devai && npx vitest run`
Expected: PASS

**Step 5: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add -A
git commit -m "cleanup(memory): delete MEMORY.md, RECENT_FOCUS.md, recentFocusRenderer, remove long-term append"
```

---

### Task 9: Update `memory_remember` tool to also store in DB

**Files:**
- Modify: `apps/api/src/tools/memory.ts`

Currently `memoryRemember()` only writes to workspace files via `rememberNote()`. It should ALSO store the memory in Supabase so it appears in the rendered `memory.md`.

**Step 1: Check if DB storage already happens**

The extraction pipeline (`runExtractionPipeline`) stores memories in Supabase after session end. But when the user explicitly says "remember X", we need immediate DB storage too.

Check if `rememberNote()` or the tool already calls `insertMemory()`. Based on the code read — it does NOT. Only `deduplicateAndStore()` (called from extraction pipeline) writes to DB.

**Step 2: Add DB storage to `memoryRemember()`**

In `apps/api/src/tools/memory.ts`:

```typescript
import { rememberNote } from '../memory/workspaceMemory.js';
import { generateEmbedding } from '../memory/embeddings.js';
import { insertMemory } from '../memory/memoryStore.js';
import { renderMemoryMd } from '../memory/renderMemoryMd.js';

export async function memoryRemember(
  content: string,
  options?: { sessionId?: string; source?: string }
): Promise<{
  saved: true;
  dailyPath: string;
}> {
  const result = await rememberNote(content, {
    sessionId: options?.sessionId,
    source: options?.source || 'tool.memory_remember',
  });

  // Also store in Supabase for structured memory.md rendering
  try {
    const embedding = await generateEmbedding(content);
    await insertMemory({
      content,
      embedding,
      memory_type: 'semantic',
      namespace: 'devai/user',
      priority: 'high',
      source: 'user_stated',
      session_id: options?.sessionId,
    });

    // Re-render memory.md immediately
    await renderMemoryMd();
  } catch (err) {
    console.error('[memoryRemember] DB storage failed (workspace file saved):', err);
  }

  return {
    saved: true,
    dailyPath: result.daily.filePath,
  };
}
```

**Step 3: Run tests**

Run: `cd /opt/Klyde/projects/Devai && npx vitest run`
Expected: PASS

**Step 4: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/tools/memory.ts
git commit -m "feat(memory): store memory_remember entries in Supabase for structured rendering"
```

---

### Task 10: Update `service.ts` — `retrieveRelevantMemories` only for `memory_search` tool

**Files:**
- Modify: `apps/api/src/memory/service.ts`

**Step 1: Clean up**

After Task 3 removed the `warmMemoryBlockForSession` caller, `retrieveRelevantMemories()` is only called from the `memory_search` tool (on-demand vector search). Verify this:

```bash
grep -rn 'retrieveRelevantMemories' apps/api/src/
```

If no other callers remain besides the test, the function stays but the following can be removed:
- `formatMemoriesBlock()` — was only used to build the context injection block
- `formatMemoryQualityBlock()` — was only used for context injection
- `buildMemoryQualitySignals()` — was only used for context injection
- `MemoryQualitySignals` interface export
- `SECTION_HEADERS` mapping
- `augmentQueryWithRecentTopics()` — recent focus augmentation no longer needed
- `toPercent()` helper

Keep:
- `retrieveRelevantMemories()` — but simplify: return raw memories instead of formatted block
- `buildMemorySearchNamespaces()` — still useful
- `buildRetrievalThresholds()` — still useful
- `triggerSessionEndExtraction()` — still needed for session-end pipeline

**Step 2: Simplify the function**

```typescript
export async function retrieveRelevantMemories(
  query: string,
  projectName?: string,
): Promise<StoredMemory[]> {
  const namespaces = buildMemorySearchNamespaces(projectName);
  const thresholds = buildRetrievalThresholds();
  const limit = 10;
  const minimumHitsBeforeStop = Math.min(limit, Math.max(1, config.memoryMinHitsBeforeStop));
  const mergedById = new Map<string, StoredMemory>();

  for (const threshold of thresholds) {
    const retrieved = await searchMemories(query, namespaces, limit, threshold);
    for (const memory of retrieved) {
      mergedById.set(memory.id, memory);
    }

    const mergedRanked = rankMemories(Array.from(mergedById.values())).slice(0, limit);
    if (mergedRanked.length >= minimumHitsBeforeStop) break;
  }

  return rankMemories(Array.from(mergedById.values())).slice(0, limit);
}
```

**Step 3: Update callers**

Update `memory_search` tool or any code that previously used `result.block` to use the raw array.

**Step 4: Update `service.test.ts`**

Update the test to match the simplified return type (array of `StoredMemory` instead of `{ block, memoryIds, quality }`).

**Step 5: Run tests**

Run: `cd /opt/Klyde/projects/Devai && npx vitest run`
Expected: PASS

**Step 6: Commit**

```bash
cd /opt/Klyde/projects/Devai
git add apps/api/src/memory/service.ts apps/api/src/memory/service.test.ts
git commit -m "refactor(memory): simplify retrieveRelevantMemories to return raw results"
```

---

### Task 11: Full integration test — run suite, verify new session context

**Step 1: Run full test suite**

```bash
cd /opt/Klyde/projects/Devai && npx vitest run
```

Expected: All tests green.

**Step 2: Push to dev**

```bash
cd /opt/Klyde/projects/Devai && git push origin dev
```

**Step 3: Start a new DevAI session**

Wait for Mutagen sync (~500ms), then start a new session via Telegram or Web-UI.

**Step 4: Check PM2 logs for context profile**

```bash
ssh root@46.225.162.103 "pm2 logs devai-api-dev --lines 50 --nostream" 2>/dev/null | grep "assembled profile"
```

Verify:
- `workspace_policy` block present (contains `memory.md` content)
- `memory_behavior_policy` block present
- NO `memory_retrieval` block
- NO `memory_quality` block
- NO `recent_focus` block
- Token count decreased from ~1,960 to ~1,200-1,400

**Step 5: Verify `memory.md` content**

```bash
cat /opt/Devai/workspace/memory.md
```

Should show categorized memories with `## User`, `## Projekte`, `## Workflows`, `## Erkenntnisse` sections.

**Step 6: Test `memory_remember`**

In the session, ask CHAPO to remember something. Verify:
1. Daily file written
2. Supabase entry created
3. `memory.md` re-rendered with the new entry

---

## Summary of files changed

| Step | File | Action |
|------|------|--------|
| T1 | `apps/api/src/memory/renderMemoryMd.ts` | **Create** — core renderer |
| T1 | `apps/api/src/memory/renderMemoryMd.test.ts` | **Create** — unit tests |
| T2 | `apps/api/src/scanner/workspaceMdLoader.ts` | **Modify** — load memory.md |
| T2 | `apps/api/src/scanner/workspaceMdLoader.test.ts` | **Modify** — update tests |
| T3 | `apps/api/src/agents/systemContext.ts` | **Modify** — remove 3 context blocks + warm functions |
| T3 | `apps/api/src/agents/systemContext.test.ts` | **Modify** — update assertions |
| T4 | `apps/api/src/memory/workspaceMemory.ts` | **Modify** — trigger renderMemoryMd |
| T5 | `apps/api/src/memory/extraction.ts` | **Modify** — trigger renderMemoryMd after extraction |
| T6 | `apps/api/src/services/systemReliability.ts` | **Modify** — trigger renderMemoryMd after decay |
| T7 | `apps/api/src/memory/extraction.ts` | **Modify** — sharpen extraction prompt |
| T8 | `apps/api/src/memory/recentFocusRenderer.ts` | **Delete** |
| T8 | `workspace/MEMORY.md` | **Delete** |
| T8 | `workspace/memory/RECENT_FOCUS.md` | **Delete** |
| T8 | `apps/api/src/memory/workspaceMemory.ts` | **Modify** — remove long-term append |
| T8 | `apps/api/src/tools/memory.ts` | **Modify** — remove promoteToLongTerm |
| T9 | `apps/api/src/tools/memory.ts` | **Modify** — add DB storage + immediate re-render |
| T10 | `apps/api/src/memory/service.ts` | **Modify** — simplify, remove formatting functions |
| T10 | `apps/api/src/memory/service.test.ts` | **Modify** — update tests |
