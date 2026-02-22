# Short-Term Memory: Recent Focus Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a short-term memory layer that continuously tracks what topics/files are being worked on across sessions, with fast decay (0.9^days), ambient context injection, and a human-readable RECENT_FOCUS.md.

**Architecture:** New `devai_recent_topics` Supabase table stores topic names, file paths, directories, and strength scores. A lightweight LLM tagger runs fire-and-forget after each CHAPO loop iteration. At session start, active topics are injected into the system prompt. At session end, RECENT_FOCUS.md is rendered from DB state.

**Tech Stack:** TypeScript (ESM), Supabase (PostgreSQL), GLM-4.7-Flash via ZAI provider, existing `llmRouter` + `getSupabase()` patterns.

---

### Task 1: Create the `devai_recent_topics` table in Supabase

**Files:**
- Create: `apps/api/src/db/migrations/create_recent_topics.sql` (reference only — executed via Supabase)

**Step 1: Create the table via Supabase SQL**

Run this SQL in Supabase (via the supabase client or dashboard):

```sql
CREATE TABLE IF NOT EXISTS devai_recent_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic TEXT NOT NULL,
  parent_topic TEXT,
  file_paths TEXT[] DEFAULT '{}',
  directories TEXT[] DEFAULT '{}',
  strength FLOAT DEFAULT 1.0,
  touch_count INT DEFAULT 1,
  session_count INT DEFAULT 1,
  first_seen_at TIMESTAMPTZ DEFAULT now(),
  last_touched_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recent_topics_active ON devai_recent_topics (is_active, strength DESC);
CREATE INDEX IF NOT EXISTS idx_recent_topics_topic ON devai_recent_topics (topic);
```

**Step 2: Verify table exists**

```bash
cd /opt/Klyde/projects/Devai
node -e "
const { createClient } = require('@supabase/supabase-js');
// use env vars or config to connect
// SELECT count(*) FROM devai_recent_topics
"
```

Expected: Table exists with 0 rows.

**Step 3: Add table verification to db/index.ts**

In `apps/api/src/db/index.ts`, after the existing `verifyPgvector()` call in `initDb()`, add verification for the new table:

```typescript
// Inside initDb(), after verifyPgvector()
await verifyRecentTopics();
```

Add the function:

```typescript
async function verifyRecentTopics(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('devai_recent_topics').select('id').limit(0);
  if (error) {
    console.warn('[db] devai_recent_topics table not found — recent focus system disabled:', error.message);
  } else {
    console.info('[db] devai_recent_topics table verified — recent focus system ready');
  }
}
```

**Step 4: Commit**

```bash
git add apps/api/src/db/index.ts
git commit -m "feat: add devai_recent_topics table + verification"
```

---

### Task 2: Create the Recent Focus Store (`recentFocus.ts`)

**Files:**
- Create: `apps/api/src/memory/recentFocus.ts`

**Step 1: Create the types and store module**

Create `apps/api/src/memory/recentFocus.ts`:

```typescript
import { getSupabase } from '../db/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecentTopic {
  id: string;
  topic: string;
  parent_topic: string | null;
  file_paths: string[];
  directories: string[];
  strength: number;
  touch_count: number;
  session_count: number;
  first_seen_at: string;
  last_touched_at: string;
  is_active: boolean;
}

interface TopicUpsertInput {
  topic: string;
  filePaths: string[];
  directories: string[];
  sessionId?: string;
}

// ---------------------------------------------------------------------------
// 1. getActiveTopics — fetch all active topics ordered by strength
// ---------------------------------------------------------------------------

export async function getActiveTopics(): Promise<RecentTopic[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('devai_recent_topics')
      .select('*')
      .eq('is_active', true)
      .order('strength', { ascending: false });

    if (error) {
      console.error('[recentFocus] getActiveTopics failed:', error);
      return [];
    }
    return (data as RecentTopic[]) ?? [];
  } catch (err) {
    console.error('[recentFocus] getActiveTopics failed:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 2. findTopicByName — exact match lookup
// ---------------------------------------------------------------------------

export async function findTopicByName(topic: string): Promise<RecentTopic | null> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('devai_recent_topics')
      .select('*')
      .eq('topic', topic.toLowerCase())
      .eq('is_active', true)
      .single();

    if (error || !data) return null;
    return data as RecentTopic;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 3. upsertTopic — insert or update a topic with merged file paths
// ---------------------------------------------------------------------------

export async function upsertTopic(input: TopicUpsertInput): Promise<void> {
  const normalizedTopic = input.topic.toLowerCase().trim();
  const existing = await findTopicByName(normalizedTopic);

  try {
    const supabase = getSupabase();

    if (existing) {
      // Merge file paths and directories (deduplicated)
      const mergedPaths = [...new Set([...existing.file_paths, ...input.filePaths])];
      const mergedDirs = [...new Set([...existing.directories, ...input.directories])];

      const { error } = await supabase
        .from('devai_recent_topics')
        .update({
          file_paths: mergedPaths,
          directories: mergedDirs,
          strength: 1.0,
          touch_count: existing.touch_count + 1,
          last_touched_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (error) {
        console.error('[recentFocus] upsertTopic update failed:', error);
      }
    } else {
      // Check for parent topic (adaptive granularity)
      const parts = normalizedTopic.split('/');
      let parentTopic: string | null = null;
      if (parts.length === 2) {
        const potentialParent = await findTopicByName(parts[0]);
        if (potentialParent && potentialParent.session_count >= 3) {
          parentTopic = parts[0];
        }
      }

      const { error } = await supabase
        .from('devai_recent_topics')
        .insert({
          topic: normalizedTopic,
          parent_topic: parentTopic,
          file_paths: input.filePaths,
          directories: input.directories,
          strength: 1.0,
          touch_count: 1,
          session_count: 1,
          first_seen_at: new Date().toISOString(),
          last_touched_at: new Date().toISOString(),
        });

      if (error) {
        console.error('[recentFocus] upsertTopic insert failed:', error);
      }
    }
  } catch (err) {
    console.error('[recentFocus] upsertTopic failed:', err);
  }
}

// ---------------------------------------------------------------------------
// 4. incrementSessionCount — called once per session per topic
// ---------------------------------------------------------------------------

export async function incrementSessionCount(topicName: string): Promise<void> {
  const existing = await findTopicByName(topicName);
  if (!existing) return;

  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('devai_recent_topics')
      .update({
        session_count: existing.session_count + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);

    if (error) {
      console.error('[recentFocus] incrementSessionCount failed:', error);
    }
  } catch (err) {
    console.error('[recentFocus] incrementSessionCount failed:', err);
  }
}

// ---------------------------------------------------------------------------
// 5. runRecentTopicDecay — 0.9^days decay with pruning
// ---------------------------------------------------------------------------

interface RecentDecayResult {
  decayed: number;
  pruned: number;
}

export async function runRecentTopicDecay(): Promise<RecentDecayResult> {
  const result: RecentDecayResult = { decayed: 0, pruned: 0 };

  try {
    const supabase = getSupabase();

    const { data: topics, error } = await supabase
      .from('devai_recent_topics')
      .select('id, strength, last_touched_at')
      .eq('is_active', true);

    if (error || !topics || topics.length === 0) return result;

    const now = Date.now();

    for (const topic of topics as Array<{
      id: string;
      strength: number;
      last_touched_at: string;
    }>) {
      const lastTouched = new Date(topic.last_touched_at).getTime();
      const daysSince = (now - lastTouched) / (1000 * 60 * 60 * 24);

      if (daysSince <= 0) continue;

      const newStrength = topic.strength * Math.pow(0.9, daysSince);

      if (newStrength < 0.05) {
        const { error: delError } = await supabase
          .from('devai_recent_topics')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('id', topic.id);

        if (!delError) result.pruned++;
        continue;
      }

      if (Math.abs(newStrength - topic.strength) > 0.001) {
        const { error: updateError } = await supabase
          .from('devai_recent_topics')
          .update({ strength: newStrength, updated_at: new Date().toISOString() })
          .eq('id', topic.id);

        if (!updateError) result.decayed++;
      }
    }

    return result;
  } catch (err) {
    console.error('[recentFocus] runRecentTopicDecay failed:', err);
    return result;
  }
}

// ---------------------------------------------------------------------------
// 6. deactivateTopic — mark a topic as inactive (for manual edit sync)
// ---------------------------------------------------------------------------

export async function deactivateTopic(topicName: string): Promise<void> {
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('devai_recent_topics')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('topic', topicName.toLowerCase())
      .eq('is_active', true);

    if (error) {
      console.error('[recentFocus] deactivateTopic failed:', error);
    }
  } catch (err) {
    console.error('[recentFocus] deactivateTopic failed:', err);
  }
}
```

**Step 2: Commit**

```bash
git add apps/api/src/memory/recentFocus.ts
git commit -m "feat: add recent focus store with CRUD, decay, and upsert logic"
```

---

### Task 3: Create the Topic Tagger (`topicTagger.ts`)

**Files:**
- Create: `apps/api/src/memory/topicTagger.ts`

**Step 1: Create the tagger module**

Create `apps/api/src/memory/topicTagger.ts`:

```typescript
import { llmRouter } from '../llm/router.js';
import type { LLMProvider } from '../llm/types.js';
import { upsertTopic, getActiveTopics, incrementSessionCount } from './recentFocus.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TagResult {
  topic: string;
  file_paths: string[];
  directories: string[];
}

interface TagContext {
  userMessage: string;
  toolCalls: string[];
  assistantResponse: string;
  filePaths: string[];
}

// ---------------------------------------------------------------------------
// Debounce state (per session)
// ---------------------------------------------------------------------------

const lastTagBySession = new Map<string, { topic: string; filePaths: string[] }>();
const sessionTopicsThisSession = new Map<string, Set<string>>();

// ---------------------------------------------------------------------------
// Tagging prompt — kept minimal for low token cost
// ---------------------------------------------------------------------------

const TAG_PROMPT = `You are a topic tagger. Given a user message, tool calls, and an assistant response, identify the current work topic.

Return a JSON object:
{
  "topic": "short/topic-name",
  "file_paths": ["/path/to/file.ts"],
  "directories": ["/path/to/dir/"]
}

Rules:
- topic should be a short domain name, max 2 levels deep (e.g. "memory", "memory/extraction", "auth", "UI/sidebar")
- Use lowercase, separated by /
- Prefer reusing these existing topics when they fit: EXISTING_TOPICS
- Only propose a sub-topic (e.g. "memory/extraction") if the work is clearly more specific than the parent
- file_paths: actual file paths mentioned or accessed
- directories: parent directories of accessed files
- Return ONLY the JSON object, nothing else`;

// ---------------------------------------------------------------------------
// tagCurrentWork — fire-and-forget LLM call to identify the topic
// ---------------------------------------------------------------------------

export async function tagCurrentWork(
  sessionId: string,
  context: TagContext,
  provider: LLMProvider = 'zai',
): Promise<void> {
  try {
    // Fetch existing topics for adaptive granularity context
    const activeTopics = await getActiveTopics();
    const existingTopicNames = activeTopics.map((t) => t.topic);

    const prompt = TAG_PROMPT.replace(
      'EXISTING_TOPICS',
      existingTopicNames.length > 0 ? existingTopicNames.join(', ') : '(none yet)',
    );

    const inputSummary = [
      `User: ${context.userMessage.slice(0, 200)}`,
      context.toolCalls.length > 0 ? `Tools: ${context.toolCalls.join(', ')}` : '',
      `Files: ${context.filePaths.join(', ') || 'none'}`,
      `Assistant: ${context.assistantResponse.slice(0, 200)}`,
    ]
      .filter(Boolean)
      .join('\n');

    const response = await llmRouter.generateWithFallback(provider, {
      model: 'glm-4.7-flash',
      systemPrompt: prompt,
      messages: [{ role: 'user', content: inputSummary }],
      maxTokens: 150,
    });

    const raw = response.content.trim();

    // Parse JSON from response (may be wrapped in code block)
    let jsonString = raw;
    const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch) {
      jsonString = codeBlockMatch[1].trim();
    }

    const parsed: unknown = JSON.parse(jsonString);
    if (!parsed || typeof parsed !== 'object') return;

    const result = parsed as Record<string, unknown>;
    const tag: TagResult = {
      topic: typeof result.topic === 'string' ? result.topic : '',
      file_paths: Array.isArray(result.file_paths) ? result.file_paths.filter((p): p is string => typeof p === 'string') : [],
      directories: Array.isArray(result.directories) ? result.directories.filter((d): d is string => typeof d === 'string') : [],
    };

    if (!tag.topic) return;

    // Debounce: skip if same topic and same files as last tag
    const lastTag = lastTagBySession.get(sessionId);
    if (
      lastTag &&
      lastTag.topic === tag.topic &&
      JSON.stringify(lastTag.filePaths.sort()) === JSON.stringify(tag.file_paths.sort())
    ) {
      return;
    }

    // Update debounce state
    lastTagBySession.set(sessionId, { topic: tag.topic, filePaths: tag.file_paths });

    // Upsert topic in DB
    await upsertTopic({
      topic: tag.topic,
      filePaths: tag.file_paths,
      directories: tag.directories,
    });

    // Track session-level topic counts for session_count increment
    if (!sessionTopicsThisSession.has(sessionId)) {
      sessionTopicsThisSession.set(sessionId, new Set());
    }
    const sessionTopics = sessionTopicsThisSession.get(sessionId)!;
    if (!sessionTopics.has(tag.topic)) {
      sessionTopics.add(tag.topic);
      await incrementSessionCount(tag.topic);
    }

    console.log(`[topicTagger] Tagged session ${sessionId}: ${tag.topic}`);
  } catch (err) {
    // Fire-and-forget — log but don't crash
    console.error('[topicTagger] tagCurrentWork failed:', err);
  }
}

// ---------------------------------------------------------------------------
// cleanupSession — remove debounce state when session ends
// ---------------------------------------------------------------------------

export function cleanupSession(sessionId: string): void {
  lastTagBySession.delete(sessionId);
  sessionTopicsThisSession.delete(sessionId);
}
```

**Step 2: Commit**

```bash
git add apps/api/src/memory/topicTagger.ts
git commit -m "feat: add topic tagger with debounce and adaptive granularity"
```

---

### Task 4: Create the RECENT_FOCUS.md Renderer (`recentFocusRenderer.ts`)

**Files:**
- Create: `apps/api/src/memory/recentFocusRenderer.ts`

**Step 1: Create the renderer module**

Create `apps/api/src/memory/recentFocusRenderer.ts`:

```typescript
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { getActiveTopics, upsertTopic, deactivateTopic, type RecentTopic } from './recentFocus.js';
import { resolveWorkspaceRoot, ensureWorkspaceMemoryStructure } from './workspaceMemory.js';

const RECENT_FOCUS_FILENAME = 'RECENT_FOCUS.md';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimeAgo(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

function strengthLabel(strength: number): string {
  if (strength >= 0.8) return '';
  if (strength >= 0.4) return ', fading';
  return ', weak';
}

function formatTopicLine(topic: RecentTopic): string {
  const timeAgo = formatTimeAgo(topic.last_touched_at);
  const label = strengthLabel(topic.strength);
  const fileNames = topic.file_paths.map((p) => p.split('/').pop()).join(', ');
  const dirLine = topic.directories.length > 0 ? topic.directories[0] : '';

  const parts = [
    `- **${topic.topic}** | ${topic.session_count} session${topic.session_count !== 1 ? 's' : ''} | last: ${timeAgo} | strength: ${topic.strength.toFixed(2)}${label}`,
  ];

  if (fileNames) parts.push(`  files: ${fileNames}`);
  if (dirLine) parts.push(`  dirs: ${dirLine}`);

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// renderRecentFocusMd — generate RECENT_FOCUS.md from DB state
// ---------------------------------------------------------------------------

export async function renderRecentFocusMd(workspaceRoot?: string | null): Promise<string> {
  const root = await resolveWorkspaceRoot(workspaceRoot);
  await ensureWorkspaceMemoryStructure(workspaceRoot);

  const topics = await getActiveTopics();

  if (topics.length === 0) {
    const content = [
      '# Recent Focus',
      '> Auto-generated. Manual edits are respected — removals and additions sync back.',
      `> Last updated: ${new Date().toISOString()}`,
      '',
      'No recent topics tracked yet.',
      '',
    ].join('\n');

    const filePath = join(root, 'memory', RECENT_FOCUS_FILENAME);
    await writeFile(filePath, content, 'utf-8');
    return filePath;
  }

  const active = topics.filter((t) => t.strength >= 0.4);
  const fading = topics.filter((t) => t.strength < 0.4 && t.strength >= 0.05);

  const lines: string[] = [
    '# Recent Focus',
    '> Auto-generated. Manual edits are respected — removals and additions sync back.',
    `> Last updated: ${new Date().toISOString()}`,
    '',
  ];

  if (active.length > 0) {
    lines.push('## Active');
    for (const topic of active) {
      lines.push(formatTopicLine(topic));
      lines.push('');
    }
  }

  if (fading.length > 0) {
    lines.push('## Fading');
    for (const topic of fading) {
      lines.push(formatTopicLine(topic));
      lines.push('');
    }
  }

  const content = lines.join('\n');
  const filePath = join(root, 'memory', RECENT_FOCUS_FILENAME);
  await writeFile(filePath, content, 'utf-8');

  console.log(`[recentFocusRenderer] Rendered ${topics.length} topics to ${filePath}`);
  return filePath;
}

// ---------------------------------------------------------------------------
// syncManualEdits — diff RECENT_FOCUS.md against DB and reconcile
// ---------------------------------------------------------------------------

export async function syncManualEdits(workspaceRoot?: string | null): Promise<void> {
  try {
    const root = await resolveWorkspaceRoot(workspaceRoot);
    const filePath = join(root, 'memory', RECENT_FOCUS_FILENAME);

    let fileContent: string;
    try {
      fileContent = await readFile(filePath, 'utf-8');
    } catch {
      // File doesn't exist yet — nothing to sync
      return;
    }

    // Parse topic names from the file (lines matching "- **topicname**")
    const topicPattern = /^- \*\*([^*]+)\*\*/gm;
    const fileTopics = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = topicPattern.exec(fileContent)) !== null) {
      fileTopics.add(match[1].toLowerCase().trim());
    }

    // Get DB topics
    const dbTopics = await getActiveTopics();
    const dbTopicNames = new Set(dbTopics.map((t) => t.topic));

    // Topics in DB but not in file → user removed them → deactivate
    for (const dbTopic of dbTopicNames) {
      if (!fileTopics.has(dbTopic)) {
        await deactivateTopic(dbTopic);
        console.log(`[recentFocusRenderer] Synced removal: "${dbTopic}" deactivated`);
      }
    }

    // Topics in file but not in DB → user added them → insert
    for (const fileTopic of fileTopics) {
      if (!dbTopicNames.has(fileTopic)) {
        await upsertTopic({
          topic: fileTopic,
          filePaths: [],
          directories: [],
        });
        console.log(`[recentFocusRenderer] Synced addition: "${fileTopic}" inserted`);
      }
    }
  } catch (err) {
    console.error('[recentFocusRenderer] syncManualEdits failed:', err);
  }
}

// ---------------------------------------------------------------------------
// buildRecentFocusBlock — format active topics for system prompt injection
// ---------------------------------------------------------------------------

const RECENT_FOCUS_TOKEN_BUDGET = 800;
const CHARS_PER_TOKEN = 4;
const MAX_RECENT_FOCUS_CHARS = RECENT_FOCUS_TOKEN_BUDGET * CHARS_PER_TOKEN;

export async function buildRecentFocusBlock(): Promise<string> {
  const topics = await getActiveTopics();

  if (topics.length === 0) return '';

  const lines: string[] = [
    '## Recent Focus (cross-session awareness)',
    '',
    "You've been actively working on:",
  ];

  let totalChars = lines.join('\n').length;

  for (const topic of topics) {
    const timeAgo = formatTimeAgo(topic.last_touched_at);
    const label = strengthLabel(topic.strength);
    const fileNames = topic.file_paths.map((p) => p.split('/').pop()).filter(Boolean).join(', ');
    const dir = topic.directories.length > 0 ? ` @ ${topic.directories[0]}` : '';

    const line = `- **${topic.topic}** (${topic.session_count} session${topic.session_count !== 1 ? 's' : ''}, last touched ${timeAgo}${label})${fileNames ? ` — ${fileNames}` : ''}${dir}`;

    if (totalChars + line.length + 1 > MAX_RECENT_FOCUS_CHARS) break;

    lines.push(line);
    totalChars += line.length + 1;
  }

  if (lines.length <= 3) return ''; // Only header, no topics fit

  return lines.join('\n');
}
```

**Step 2: Commit**

```bash
git add apps/api/src/memory/recentFocusRenderer.ts
git commit -m "feat: add RECENT_FOCUS.md renderer with manual edit sync and context block builder"
```

---

### Task 5: Update memory index exports

**Files:**
- Modify: `apps/api/src/memory/index.ts`

**Step 1: Add exports for new modules**

In `apps/api/src/memory/index.ts`, add:

```typescript
export { getActiveTopics, upsertTopic, runRecentTopicDecay } from './recentFocus.js';
export { tagCurrentWork, cleanupSession } from './topicTagger.js';
export { renderRecentFocusMd, syncManualEdits, buildRecentFocusBlock } from './recentFocusRenderer.js';
```

**Step 2: Commit**

```bash
git add apps/api/src/memory/index.ts
git commit -m "feat: export recent focus modules from memory index"
```

---

### Task 6: Integrate Recent Focus into system context

**Files:**
- Modify: `apps/api/src/agents/systemContext.ts:130-202`

**Step 1: Add import**

At the top of `apps/api/src/agents/systemContext.ts`, add:

```typescript
import { buildRecentFocusBlock, syncManualEdits } from '../memory/recentFocusRenderer.js';
```

**Step 2: Add warmRecentFocusBlockForSession function**

After the `warmMemoryBlockForSession` function (line ~150), add:

```typescript
export async function warmRecentFocusBlockForSession(sessionId: string): Promise<string> {
  try {
    // Sync manual edits from RECENT_FOCUS.md before reading
    await syncManualEdits();

    const block = await buildRecentFocusBlock();
    stateManager.setGatheredInfo(sessionId, 'recentFocusBlock', block);
    return block;
  } catch {
    stateManager.setGatheredInfo(sessionId, 'recentFocusBlock', '');
    return '';
  }
}
```

**Step 3: Update getCombinedSystemContextBlock to include recentFocusBlock**

In `getCombinedSystemContextBlock` (line ~152), add the recentFocusBlock between `globalContextBlock` and `memoryQualityBlock`:

Change the blocks array from:

```typescript
const blocks = [
  info.devaiMdBlock || '',
  info.claudeMdBlock || '',
  info.workspaceMdBlock || '',
  info.globalContextBlock || '',
  info.memoryQualityBlock || '',
  info.memoryBlock || '',
  schedulerErrorBlock,
  platformBlock,
]
```

To:

```typescript
const blocks = [
  info.devaiMdBlock || '',
  info.claudeMdBlock || '',
  info.workspaceMdBlock || '',
  info.globalContextBlock || '',
  info.recentFocusBlock || '',
  info.memoryQualityBlock || '',
  info.memoryBlock || '',
  schedulerErrorBlock,
  platformBlock,
]
```

**Step 4: Update warmSystemContextForSession to call warmRecentFocusBlockForSession**

In `warmSystemContextForSession` (line ~189), add the recentFocusBlock warming:

```typescript
export async function warmSystemContextForSession(
  sessionId: string,
  projectRoot: string | null,
  userMessage?: string
): Promise<void> {
  await getDevaiMdBlockForSession(sessionId);
  await getClaudeMdBlockForSession(sessionId, projectRoot);
  await getWorkspaceMdBlockForSession(sessionId);
  await refreshGlobalContextBlockForSession(sessionId);
  await warmRecentFocusBlockForSession(sessionId);  // NEW
  if (userMessage) {
    await warmMemoryBlockForSession(sessionId, userMessage);
  }
}
```

**Step 5: Increase memory token budget**

In `apps/api/src/memory/service.ts`, change the `MEMORY_TOKEN_BUDGET` constant (line 12):

From:
```typescript
const MEMORY_TOKEN_BUDGET = 2000;
```

To:
```typescript
const MEMORY_TOKEN_BUDGET = 3000;
```

**Step 6: Commit**

```bash
git add apps/api/src/agents/systemContext.ts apps/api/src/memory/service.ts
git commit -m "feat: inject Recent Focus block into system context, increase memory budget"
```

---

### Task 7: Hook topic tagging into CHAPO loop

**Files:**
- Modify: `apps/api/src/agents/chapo-loop.ts:349-377`

**Step 1: Add import**

At the top of `apps/api/src/agents/chapo-loop.ts`, add:

```typescript
import { tagCurrentWork } from '../memory/topicTagger.js';
```

**Step 2: Add fire-and-forget tagging after tool execution**

In the `runLoop` method, after the tool results are fed back to LLM (around line 374, after the `toolResults` message is added to conversation), add:

After this block:
```typescript
// Feed tool results back to LLM for the next iteration
this.conversation.addMessage({
  role: 'user',
  content: '',
  toolResults,
});
```

Add:
```typescript
// Fire-and-forget: tag current work topic for recent focus
const toolNames = response.toolCalls.map((tc) => tc.name);
const filePaths = this.extractFilePaths(response.toolCalls);
tagCurrentWork(this.sessionId, {
  userMessage: getTextContent(userMessage).slice(0, 300),
  toolCalls: toolNames,
  assistantResponse: (response.content || '').slice(0, 300),
  filePaths,
}).catch((err) => console.error('[chapo-loop] topic tagging failed:', err));
```

**Step 3: Add extractFilePaths helper method to ChapoLoop class**

Add this private method to the `ChapoLoop` class:

```typescript
private extractFilePaths(toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>): string[] {
  const paths: string[] = [];
  for (const tc of toolCalls) {
    const args = tc.arguments;
    // Common patterns for file paths in tool arguments
    if (typeof args.path === 'string') paths.push(args.path);
    if (typeof args.file_path === 'string') paths.push(args.file_path);
    if (typeof args.filePath === 'string') paths.push(args.filePath);
    if (typeof args.target === 'string' && args.target.includes('/')) paths.push(args.target);
  }
  return [...new Set(paths)];
}
```

**Step 4: Commit**

```bash
git add apps/api/src/agents/chapo-loop.ts
git commit -m "feat: hook topic tagging into CHAPO loop after tool execution"
```

---

### Task 8: Hook session end rendering into chatGateway

**Files:**
- Modify: `apps/api/src/websocket/chatGateway.ts:37-57`

**Step 1: Add imports**

At the top of `chatGateway.ts`, add:

```typescript
import { renderRecentFocusMd } from '../memory/recentFocusRenderer.js';
import { cleanupSession } from '../memory/topicTagger.js';
```

**Step 2: Add RECENT_FOCUS.md rendering to session end**

In `unregisterChatClient`, after the existing memory extraction block (inside the `if (session.clients.size === 0)` block, after the `triggerSessionEndExtraction` call), add:

```typescript
// Render RECENT_FOCUS.md from current DB state
renderRecentFocusMd().catch((err) => {
  console.error('[ChatGW] RECENT_FOCUS.md render failed:', err);
});

// Cleanup tagger debounce state
cleanupSession(sessionId);
```

**Step 3: Commit**

```bash
git add apps/api/src/websocket/chatGateway.ts
git commit -m "feat: render RECENT_FOCUS.md and cleanup tagger on session end"
```

---

### Task 9: Add recent topic decay to systemReliability scheduler

**Files:**
- Modify: `apps/api/src/services/systemReliability.ts:9,150-153`

**Step 1: Add import**

At the top of `systemReliability.ts`, add:

```typescript
import { runRecentTopicDecay } from '../memory/recentFocus.js';
```

**Step 2: Add the decay job function**

After the existing `memoryDecayJob` function (line ~153), add:

```typescript
export async function recentTopicDecayJob(): Promise<string> {
  const result = await runRecentTopicDecay();
  return `Recent topic decay: ${result.decayed} decayed, ${result.pruned} pruned`;
}
```

**Step 3: Register the job in the scheduler**

Find where `memoryDecayJob` is registered in the scheduler (search for it in the codebase — likely in `schedulerService.ts` or similar). Register `recentTopicDecayJob` alongside it with the same daily schedule.

Run:
```bash
grep -rn "memoryDecayJob" /opt/Klyde/projects/Devai/apps/api/src/ --include="*.ts"
```

Then add the new job registration in the same file/pattern.

**Step 4: Commit**

```bash
git add apps/api/src/services/systemReliability.ts
# Also add the scheduler registration file if modified
git commit -m "feat: add recent topic decay job to daily scheduler"
```

---

### Task 10: Augment long-term memory retrieval with recent focus

**Files:**
- Modify: `apps/api/src/memory/service.ts:116-168`

**Step 1: Add import**

At the top of `service.ts`, add:

```typescript
import { getActiveTopics } from './recentFocus.js';
```

**Step 2: Augment the search query with active topics**

In `retrieveRelevantMemories` (line 116), before the search loop, add topic-aware query augmentation:

After `const mergedById = new Map<string, StoredMemory>();` (line 125), add:

```typescript
// Augment query with recent focus context for better relevance
let augmentedQuery = query;
try {
  const recentTopics = await getActiveTopics();
  const topTopics = recentTopics.slice(0, 3).map((t) => t.topic);
  if (topTopics.length > 0) {
    augmentedQuery = `${query} (context: ${topTopics.join(', ')})`;
  }
} catch {
  // Non-critical — proceed with original query
}
```

Then change the `searchMemories` call inside the threshold loop (line 128) to use `augmentedQuery` instead of `query`:

From:
```typescript
const retrieved = await searchMemories(query, namespaces, limit, threshold);
```

To:
```typescript
const retrieved = await searchMemories(augmentedQuery, namespaces, limit, threshold);
```

**Step 3: Commit**

```bash
git add apps/api/src/memory/service.ts
git commit -m "feat: augment memory retrieval with recent focus topics"
```

---

### Task 11: End-to-end verification

**Step 1: Check that imports resolve**

```bash
cd /opt/Klyde/projects/Devai
npx tsc --noEmit 2>&1 | head -50
```

Expected: No errors in the new files.

**Step 2: Verify the table exists**

```bash
# Quick check via the API
node -e "
import('./apps/api/src/db/index.js').then(async (db) => {
  await db.initDb();
  const supabase = db.getSupabase();
  const { data, error } = await supabase.from('devai_recent_topics').select('id').limit(1);
  console.log('Table check:', error ? 'FAILED: ' + error.message : 'OK (' + (data?.length ?? 0) + ' rows)');
  process.exit(0);
});
"
```

**Step 3: Manual smoke test**

Start a Devai session, send a message, check:
1. Console logs show `[topicTagger] Tagged session ...`
2. After session ends, `workspace/memory/RECENT_FOCUS.md` exists
3. Next session start, console shows the Recent Focus block being injected

**Step 4: Final commit if needed**

```bash
git add -A
git commit -m "feat: short-term memory system — recent focus awareness across sessions"
```
