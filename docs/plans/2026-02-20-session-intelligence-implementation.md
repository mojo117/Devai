# Session Intelligence & Memory System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add vector-based long-term memory via Supabase pgvector, context compaction at 160k tokens, and automatic learning extraction — so DevAI builds project knowledge over time.

**Architecture:** Three-layer memory (working → session summary → long-term vector). Compaction at 160k triggers summarization + memory extraction in one LLM call. Session-end extraction catches short conversations. Hierarchical namespaces scope memories per-project and globally. Retrieval injects relevant memories into system prompt before each CHAPO loop.

**Tech Stack:** Supabase pgvector, OpenAI text-embedding-3-small (512d), HNSW index, existing ConversationManager + ChapoLoop

---

### Task 1: Supabase Migration — Create devai_memories Table

**Files:**
- Create: `apps/api/src/db/migrations/001_devai_memories.sql`
- Modify: `apps/api/src/db/index.ts:6-24`

**Step 1: Write the migration SQL file**

```sql
-- apps/api/src/db/migrations/001_devai_memories.sql
-- Enable pgvector extension
create extension if not exists vector;

create table if not exists devai_memories (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  embedding vector(512),
  memory_type text not null check (memory_type in ('semantic', 'episodic', 'procedural')),
  namespace text not null,
  priority text not null default 'medium' check (priority in ('highest', 'high', 'medium', 'low')),
  source text check (source in ('user_stated', 'error_resolution', 'pattern', 'discovery', 'compaction')),
  strength float not null default 1.0,
  access_count int not null default 0,
  last_accessed_at timestamptz not null default now(),
  session_id text,
  is_valid boolean not null default true,
  superseded_by uuid references devai_memories(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- HNSW index for cosine similarity (handles frequent writes well)
create index if not exists idx_memories_embedding
  on devai_memories using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Filtering indexes
create index if not exists idx_memories_namespace on devai_memories (namespace);
create index if not exists idx_memories_valid on devai_memories (is_valid) where is_valid = true;
create index if not exists idx_memories_type on devai_memories (memory_type);

-- Similarity search RPC function
create or replace function match_memories(
  query_embedding vector(512),
  match_namespace text,
  match_count int default 15,
  similarity_threshold float default 0.7
) returns table (
  id uuid,
  content text,
  similarity float,
  memory_type text,
  namespace text,
  strength float,
  priority text
) language plpgsql as $$
begin
  return query
    select
      m.id,
      m.content,
      1 - (m.embedding <=> query_embedding) as similarity,
      m.memory_type,
      m.namespace,
      m.strength,
      m.priority
    from devai_memories m
    where m.is_valid = true
      and m.strength > 0.05
      and m.namespace like match_namespace || '%'
      and 1 - (m.embedding <=> query_embedding) > similarity_threshold
    order by m.embedding <=> query_embedding
    limit match_count;
end; $$;
```

**Step 2: Run the migration against Supabase**

Run the SQL via Supabase dashboard or CLI. The migration file is for documentation — Supabase doesn't auto-run migration files, so execute manually:

```bash
# From Clawd server where Supabase runs, or via Supabase SQL editor
```

**Step 3: Add migration runner to db/index.ts**

Modify `apps/api/src/db/index.ts` — add a check after `ensureDefaultUser()` that logs pgvector readiness:

```typescript
// After line 23 in db/index.ts, after ensureDefaultUser():
await verifyPgvector();
```

Add function:

```typescript
async function verifyPgvector(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('devai_memories').select('id').limit(0);
  if (error) {
    console.warn('[db] devai_memories table not found — memory system disabled:', error.message);
  } else {
    console.info('[db] devai_memories table verified — memory system ready');
  }
}
```

**Step 4: Commit**

```bash
git add apps/api/src/db/migrations/001_devai_memories.sql apps/api/src/db/index.ts
git commit -m "feat: add devai_memories table with pgvector for long-term memory"
```

---

### Task 2: Embeddings Service

**Files:**
- Create: `apps/api/src/memory/embeddings.ts`

**Step 1: Write the embeddings service**

```typescript
// apps/api/src/memory/embeddings.ts
import OpenAI from 'openai';
import { config } from '../config.js';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 512;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    if (!config.openaiApiKey) {
      throw new Error('OPENAI_API_KEY required for embeddings');
    }
    client = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return client;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await getClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.slice(0, 8000), // text-embedding-3-small max is 8191 tokens
    dimensions: EMBEDDING_DIMENSIONS,
  });
  return response.data[0].embedding;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const truncated = texts.map((t) => t.slice(0, 8000));
  const response = await getClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: truncated,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  return response.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}
```

**Step 2: Commit**

```bash
git add apps/api/src/memory/embeddings.ts
git commit -m "feat: add OpenAI embeddings service for memory vectors"
```

---

### Task 3: Memory Store — CRUD Operations

**Files:**
- Create: `apps/api/src/memory/memoryStore.ts`
- Create: `apps/api/src/memory/types.ts`

**Step 1: Write memory types**

```typescript
// apps/api/src/memory/types.ts

export type MemoryType = 'semantic' | 'episodic' | 'procedural';
export type MemoryPriority = 'highest' | 'high' | 'medium' | 'low';
export type MemorySource = 'user_stated' | 'error_resolution' | 'pattern' | 'discovery' | 'compaction';

export interface MemoryCandidate {
  content: string;
  type: MemoryType;
  namespace: string;
  source: MemorySource;
  priority?: MemoryPriority;
}

export interface StoredMemory {
  id: string;
  content: string;
  similarity: number;
  memory_type: MemoryType;
  namespace: string;
  strength: number;
  priority: MemoryPriority;
}

export interface MemoryInsert {
  content: string;
  embedding: number[];
  memory_type: MemoryType;
  namespace: string;
  priority: MemoryPriority;
  source: MemorySource;
  session_id?: string;
}
```

**Step 2: Write memory store**

```typescript
// apps/api/src/memory/memoryStore.ts

import { getSupabase } from '../db/index.js';
import { generateEmbedding } from './embeddings.js';
import type { StoredMemory, MemoryInsert } from './types.js';

/**
 * Search memories by vector similarity within given namespaces.
 */
export async function searchMemories(
  query: string,
  namespaces: string[],
  limit = 15,
  threshold = 0.7
): Promise<StoredMemory[]> {
  const embedding = await generateEmbedding(query);
  const allResults: StoredMemory[] = [];

  for (const ns of namespaces) {
    const { data, error } = await getSupabase().rpc('match_memories', {
      query_embedding: JSON.stringify(embedding),
      match_namespace: ns,
      match_count: limit,
      similarity_threshold: threshold,
    });

    if (error) {
      console.error(`[memoryStore] search failed for namespace ${ns}:`, error.message);
      continue;
    }
    if (data) {
      allResults.push(...(data as StoredMemory[]));
    }
  }

  // Sort by similarity * strength descending, deduplicate by id
  const seen = new Set<string>();
  return allResults
    .filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    })
    .sort((a, b) => (b.similarity * b.strength) - (a.similarity * a.strength))
    .slice(0, limit);
}

/**
 * Reinforce accessed memories (increment access_count, update last_accessed_at).
 */
export async function reinforceMemories(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  for (const id of ids) {
    const { error } = await getSupabase()
      .from('devai_memories')
      .update({
        access_count: getSupabase().rpc('increment_access', { row_id: id }), // handled below
        last_accessed_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      // Fallback: raw SQL increment
      await getSupabase().rpc('increment_memory_access', { memory_id: id }).catch(() => {});
    }
  }
}

/**
 * Simple increment — we'll use a direct update since Supabase JS doesn't have atomic increment.
 */
export async function reinforceMemory(id: string): Promise<void> {
  const { data } = await getSupabase()
    .from('devai_memories')
    .select('access_count')
    .eq('id', id)
    .single();

  if (data) {
    await getSupabase()
      .from('devai_memories')
      .update({
        access_count: (data.access_count ?? 0) + 1,
        last_accessed_at: new Date().toISOString(),
      })
      .eq('id', id);
  }
}

/**
 * Insert a new memory with its embedding.
 */
export async function insertMemory(memory: MemoryInsert): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from('devai_memories')
    .insert({
      content: memory.content,
      embedding: JSON.stringify(memory.embedding),
      memory_type: memory.memory_type,
      namespace: memory.namespace,
      priority: memory.priority,
      source: memory.source,
      session_id: memory.session_id,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[memoryStore] insert failed:', error.message);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Find near-duplicate memories for deduplication (cosine > 0.8).
 */
export async function findSimilarMemories(
  content: string,
  namespace: string
): Promise<StoredMemory[]> {
  const embedding = await generateEmbedding(content);
  const { data, error } = await getSupabase().rpc('match_memories', {
    query_embedding: JSON.stringify(embedding),
    match_namespace: namespace,
    match_count: 5,
    similarity_threshold: 0.8,
  });

  if (error) {
    console.error('[memoryStore] findSimilar failed:', error.message);
    return [];
  }
  return (data as StoredMemory[]) || [];
}

/**
 * Supersede an old memory with a new one (soft invalidation).
 */
export async function supersedeMemory(oldId: string, newId: string): Promise<void> {
  await getSupabase()
    .from('devai_memories')
    .update({
      is_valid: false,
      superseded_by: newId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', oldId);
}

/**
 * Invalidate a memory (mark as not valid).
 */
export async function invalidateMemory(id: string): Promise<void> {
  await getSupabase()
    .from('devai_memories')
    .update({
      is_valid: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
}

/**
 * Run decay on all valid memories. Call daily.
 */
export async function runDecay(): Promise<{ decayed: number; pruned: number }> {
  // Decay: strength *= 0.95 ^ days_since_last_access
  const { data: memories, error } = await getSupabase()
    .from('devai_memories')
    .select('id, strength, last_accessed_at, priority')
    .eq('is_valid', true);

  if (error || !memories) {
    console.error('[memoryStore] decay query failed:', error?.message);
    return { decayed: 0, pruned: 0 };
  }

  let decayed = 0;
  let pruned = 0;
  const now = Date.now();

  for (const mem of memories) {
    const lastAccess = new Date(mem.last_accessed_at).getTime();
    const daysSince = (now - lastAccess) / (1000 * 60 * 60 * 24);
    if (daysSince < 1) continue; // Skip if accessed today

    const newStrength = mem.strength * Math.pow(0.95, daysSince);

    if (newStrength < 0.05 && mem.priority !== 'highest') {
      await invalidateMemory(mem.id);
      pruned++;
    } else {
      await getSupabase()
        .from('devai_memories')
        .update({ strength: newStrength, updated_at: new Date().toISOString() })
        .eq('id', mem.id);
      decayed++;
    }
  }

  console.info(`[memoryStore] decay complete: ${decayed} decayed, ${pruned} pruned`);
  return { decayed, pruned };
}
```

**Step 3: Commit**

```bash
git add apps/api/src/memory/types.ts apps/api/src/memory/memoryStore.ts
git commit -m "feat: add memory store with vector search, dedup, decay"
```

---

### Task 4: Memory Extraction Pipeline

**Files:**
- Create: `apps/api/src/memory/extraction.ts`

**Step 1: Write the two-phase extraction pipeline**

This is the core intelligence — an LLM call extracts candidates from conversation, then deduplicates against existing memories.

```typescript
// apps/api/src/memory/extraction.ts

import { llmRouter } from '../llm/router.js';
import { generateEmbedding } from './embeddings.js';
import { findSimilarMemories, insertMemory, supersedeMemory, invalidateMemory } from './memoryStore.js';
import type { MemoryCandidate, MemorySource, MemoryType, MemoryPriority } from './types.js';
import type { LLMProvider } from '../llm/types.js';

const EXTRACTION_PROMPT = `Du bist ein Memory-Extraktionssystem. Analysiere die folgende Konversation und extrahiere wertvolle Learnings.

Extrahiere NUR Dinge, die beim naechsten Mal helfen wuerden:
- Korrekturen die der User gemacht hat (HOECHSTE Prioritaet)
- Fehler und wie sie geloest wurden
- Erfolgreiche Muster (Multi-Step Tool-Chains die funktioniert haben)
- Architektur-Fakten ueber Projekte
- Tool-Argument-Muster die funktioniert haben

NICHT extrahieren:
- Smalltalk, Begruessung
- Zwischenschritte die ins Leere gefuehrt haben
- Ausfuehrliche Tool-Ausgaben (Dateiinhalte, Log-Dumps)
- Informationen die bereits in Projektdokumentation stehen

Antworte als JSON-Array. Jedes Element hat:
- content: Der Lerninhalt (knapp, faktisch, max 200 Zeichen)
- type: "semantic" (Fakten), "episodic" (was funktioniert/fehlgeschlagen hat), "procedural" (Workflows/Patterns)
- namespace: Hierarchischer Pfad, z.B. "devai/project/taskforge/deployment" oder "devai/global/patterns"
- source: "user_stated" | "error_resolution" | "pattern" | "discovery"
- priority: "highest" (User-Korrektur), "high" (Error→Fix), "medium" (Pattern), "low" (Fakt)

Wenn nichts Wertvolles zu extrahieren ist, antworte mit leerem Array: []

Konversation:
`;

interface ExtractionResult {
  added: number;
  updated: number;
  skipped: number;
}

type DeduplicationDecision = 'ADD' | 'UPDATE' | 'DELETE' | 'NOOP';

/**
 * Phase 1: Extract memory candidates from conversation text.
 */
export async function extractMemoryCandidates(
  conversationText: string,
  provider: LLMProvider = 'zai'
): Promise<MemoryCandidate[]> {
  try {
    const response = await llmRouter.generateWithFallback(provider, {
      model: 'glm-4.7-flash',
      messages: [{ role: 'user', content: `${EXTRACTION_PROMPT}\n${conversationText}` }],
      systemPrompt: 'Du bist ein praezises Memory-Extraktionssystem. Antworte NUR mit validem JSON.',
      tools: [],
      toolsEnabled: false,
    });

    const content = response.content.trim();
    // Extract JSON array from response (may be wrapped in markdown code block)
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item: Record<string, unknown>) =>
        typeof item.content === 'string' &&
        typeof item.type === 'string' &&
        typeof item.namespace === 'string'
      )
      .map((item: Record<string, unknown>) => ({
        content: String(item.content).slice(0, 500),
        type: item.type as MemoryType,
        namespace: String(item.namespace),
        source: (item.source as MemorySource) || 'discovery',
        priority: (item.priority as MemoryPriority) || 'medium',
      }));
  } catch (err) {
    console.error('[extraction] Phase 1 failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Phase 2: Deduplicate candidates against existing memories.
 * For each candidate: ADD, UPDATE (supersede), DELETE (invalidate old), or NOOP (skip).
 */
export async function deduplicateAndStore(
  candidates: MemoryCandidate[],
  sessionId?: string
): Promise<ExtractionResult> {
  const result: ExtractionResult = { added: 0, updated: 0, skipped: 0 };

  for (const candidate of candidates) {
    try {
      const similar = await findSimilarMemories(candidate.content, candidate.namespace);

      if (similar.length === 0) {
        // No duplicates — ADD
        const embedding = await generateEmbedding(candidate.content);
        await insertMemory({
          content: candidate.content,
          embedding,
          memory_type: candidate.type,
          namespace: candidate.namespace,
          priority: candidate.priority || 'medium',
          source: candidate.source,
          session_id: sessionId,
        });
        result.added++;
        continue;
      }

      // Check the most similar existing memory
      const bestMatch = similar[0];

      if (bestMatch.similarity > 0.95) {
        // Near-identical — NOOP
        result.skipped++;
        continue;
      }

      // Similarity between 0.8 and 0.95 — UPDATE (supersede the old one)
      const embedding = await generateEmbedding(candidate.content);
      const newId = await insertMemory({
        content: candidate.content,
        embedding,
        memory_type: candidate.type,
        namespace: candidate.namespace,
        priority: candidate.priority || 'medium',
        source: candidate.source,
        session_id: sessionId,
      });

      if (newId) {
        await supersedeMemory(bestMatch.id, newId);
        result.updated++;
      }
    } catch (err) {
      console.error('[extraction] dedup failed for candidate:', candidate.content.slice(0, 60), err);
      result.skipped++;
    }
  }

  console.info(`[extraction] Phase 2 complete: +${result.added} added, ~${result.updated} updated, ${result.skipped} skipped`);
  return result;
}

/**
 * Full extraction pipeline: extract candidates → deduplicate → store.
 * Runs asynchronously — call with fire-and-forget.
 */
export async function runExtractionPipeline(
  conversationText: string,
  sessionId?: string,
  provider: LLMProvider = 'zai'
): Promise<ExtractionResult> {
  const candidates = await extractMemoryCandidates(conversationText, provider);
  if (candidates.length === 0) {
    return { added: 0, updated: 0, skipped: 0 };
  }
  return deduplicateAndStore(candidates, sessionId);
}
```

**Step 2: Commit**

```bash
git add apps/api/src/memory/extraction.ts
git commit -m "feat: add two-phase memory extraction pipeline (extract + dedup)"
```

---

### Task 5: Context Compaction

**Files:**
- Create: `apps/api/src/memory/compaction.ts`

**Step 1: Write the compaction service**

```typescript
// apps/api/src/memory/compaction.ts

import { llmRouter } from '../llm/router.js';
import { runExtractionPipeline } from './extraction.js';
import type { LLMMessage, LLMProvider } from '../llm/types.js';

const COMPACTION_PROMPT = `Du bist ein Context-Compaction-System. Deine Aufgabe hat zwei Teile:

TEIL 1 — ZUSAMMENFASSUNG (3-5k Zeichen):
Fasse die alten Nachrichten zusammen. Bewahre:
- Getroffene Entscheidungen und warum
- Tool-Aufrufe die erfolgreich/fehlgeschlagen sind und deren Ergebnisse
- Offene Fragen oder haengende Aufgaben
- Aktueller Stand der Arbeit (was ist fertig, was kommt als naechstes)

Entferne:
- Komplette Dateiinhalte aus Read-Aufrufen
- Ausfuehrliche Bash/Tool-Ausgaben
- Wiederholte fehlgeschlagene Versuche (nur den finalen erfolgreichen behalten)

TEIL 2 — MEMORY-KANDIDATEN:
Extrahiere wertvolle Learnings als JSON-Array (gleiche Regeln wie Memory-Extraktion).

Antworte in diesem exakten Format:

---SUMMARY---
[Deine Zusammenfassung hier]
---MEMORIES---
[JSON-Array der Memory-Kandidaten, oder leeres Array []]
`;

export interface CompactionResult {
  summary: string;
  droppedTokens: number;
  summaryTokens: number;
}

/**
 * Compact old messages into a summary + extract memories.
 * Returns the summary to replace old messages in conversation.
 */
export async function compactMessages(
  messages: LLMMessage[],
  sessionId: string,
  provider: LLMProvider = 'zai'
): Promise<CompactionResult> {
  // Estimate tokens of messages to compact
  const fullText = messages.map((m) => `[${m.role}]: ${m.content}`).join('\n\n');
  const droppedTokens = Math.ceil(fullText.length / 4);

  try {
    const response = await llmRouter.generateWithFallback(provider, {
      model: 'glm-4.7-flash', // Use fast model for compaction
      messages: [{ role: 'user', content: `${COMPACTION_PROMPT}\n\nNachrichten zum Kompaktieren:\n\n${fullText}` }],
      systemPrompt: 'Du bist ein praezises Kompaktierungs-System.',
      tools: [],
      toolsEnabled: false,
    });

    const content = response.content;

    // Parse the two sections
    const summaryMatch = content.match(/---SUMMARY---([\s\S]*?)---MEMORIES---/);
    const memoriesMatch = content.match(/---MEMORIES---([\s\S]*?)$/);

    const summary = summaryMatch?.[1]?.trim() || content.slice(0, 5000);
    const summaryTokens = Math.ceil(summary.length / 4);

    // Fire-and-forget memory extraction from the memories section
    if (memoriesMatch?.[1]) {
      const memoriesJson = memoriesMatch[1].trim();
      // Run extraction pipeline async — don't block compaction
      runExtractionPipeline(
        fullText, // Pass full text for context, extraction prompt will filter
        sessionId,
        provider
      ).catch((err) => {
        console.error('[compaction] async extraction failed:', err);
      });
    }

    console.info(`[compaction] Compacted ${droppedTokens} tokens → ${summaryTokens} tokens for session ${sessionId}`);

    return { summary, droppedTokens, summaryTokens };
  } catch (err) {
    console.error('[compaction] failed:', err instanceof Error ? err.message : err);
    // Fallback: just truncate old messages
    return {
      summary: '[Context wurde kompaktiert. Fruehere Nachrichten wurden zusammengefasst.]',
      droppedTokens,
      summaryTokens: 50,
    };
  }
}
```

**Step 2: Commit**

```bash
git add apps/api/src/memory/compaction.ts
git commit -m "feat: add context compaction with dual output (summary + memories)"
```

---

### Task 6: Memory Retrieval Service

**Files:**
- Create: `apps/api/src/memory/service.ts`

**Step 1: Write the main memory service**

This is the entry point that the rest of the system calls. It handles retrieval, formatting, and wiring the extraction triggers.

```typescript
// apps/api/src/memory/service.ts

import { searchMemories, reinforceMemory } from './memoryStore.js';
import { runExtractionPipeline } from './extraction.js';
import type { StoredMemory } from './types.js';
import type { LLMProvider } from '../llm/types.js';

const MEMORY_TOKEN_BUDGET = 2000; // ~8000 chars
const CHARS_PER_TOKEN = 4;
const MAX_MEMORY_CHARS = MEMORY_TOKEN_BUDGET * CHARS_PER_TOKEN;

/**
 * Retrieve relevant memories for a given query and project context.
 * Returns a formatted string ready for system prompt injection.
 */
export async function retrieveRelevantMemories(
  query: string,
  projectName?: string
): Promise<{ block: string; memoryIds: string[] }> {
  // Build namespace search scopes
  const namespaces = ['devai/global/', 'devai/user/'];
  if (projectName) {
    namespaces.push(`devai/project/${projectName}/`);
  }

  try {
    const memories = await searchMemories(query, namespaces);
    if (memories.length === 0) {
      return { block: '', memoryIds: [] };
    }

    // Budget-constrained formatting
    const formatted = formatMemoriesBlock(memories);

    // Reinforce accessed memories (fire-and-forget)
    const ids = memories.map((m) => m.id);
    Promise.all(ids.map((id) => reinforceMemory(id))).catch(() => {});

    return { block: formatted.block, memoryIds: ids };
  } catch (err) {
    console.error('[memoryService] retrieval failed:', err instanceof Error ? err.message : err);
    return { block: '', memoryIds: [] };
  }
}

interface FormattedBlock {
  block: string;
  included: number;
  dropped: number;
}

function formatMemoriesBlock(memories: StoredMemory[]): FormattedBlock {
  // Group by type
  const semantic = memories.filter((m) => m.memory_type === 'semantic');
  const episodic = memories.filter((m) => m.memory_type === 'episodic');
  const procedural = memories.filter((m) => m.memory_type === 'procedural');

  const lines: string[] = ['\n## Relevant Memories\n'];
  let totalChars = lines[0].length;
  let included = 0;
  let dropped = 0;

  const addSection = (title: string, items: StoredMemory[]) => {
    if (items.length === 0) return;
    const header = `### ${title}\n`;
    if (totalChars + header.length > MAX_MEMORY_CHARS) {
      dropped += items.length;
      return;
    }
    lines.push(header);
    totalChars += header.length;

    for (const item of items) {
      const line = `- ${item.content}\n`;
      if (totalChars + line.length > MAX_MEMORY_CHARS) {
        dropped++;
        continue;
      }
      lines.push(line);
      totalChars += line.length;
      included++;
    }
  };

  addSection('Project Knowledge', semantic);
  addSection('Past Experiences', episodic);
  addSection('Patterns & Workflows', procedural);

  if (included === 0) {
    return { block: '', included: 0, dropped };
  }

  return { block: lines.join(''), included, dropped };
}

/**
 * Trigger post-session memory extraction (fire-and-forget).
 * Called when a session ends or user disconnects.
 */
export function triggerSessionEndExtraction(
  conversationText: string,
  sessionId: string,
  provider: LLMProvider = 'zai'
): void {
  // Run async — don't block anything
  runExtractionPipeline(conversationText, sessionId, provider).catch((err) => {
    console.error('[memoryService] post-session extraction failed:', err);
  });
}
```

**Step 2: Commit**

```bash
git add apps/api/src/memory/service.ts
git commit -m "feat: add memory retrieval service with budget-constrained formatting"
```

---

### Task 7: Integrate Memory Retrieval Into System Context

**Files:**
- Modify: `apps/api/src/agents/systemContext.ts:129-155`
- Modify: `apps/api/src/agents/systemContext.ts:157-162`

**Step 1: Add memory retrieval to warmSystemContextForSession**

In `apps/api/src/agents/systemContext.ts`, add import at top (after line 8):

```typescript
import { retrieveRelevantMemories } from '../memory/service.js';
```

**Step 2: Add memory warming function**

Add after `refreshGlobalContextBlockForSession` (after line 127):

```typescript
export async function warmMemoryBlockForSession(sessionId: string, userMessage: string): Promise<string> {
  const state = stateManager.getState(sessionId);
  const projectRoot = (state?.taskContext.gatheredInfo['projectRoot'] as string) || null;

  // Extract project name from path (e.g., "/opt/Klyde/projects/taskforge" → "taskforge")
  let projectName: string | undefined;
  if (projectRoot) {
    const parts = projectRoot.split('/').filter(Boolean);
    projectName = parts[parts.length - 1]?.toLowerCase();
  }

  try {
    const { block } = await retrieveRelevantMemories(userMessage, projectName);
    stateManager.setGatheredInfo(sessionId, 'memoryBlock', block);
    return block;
  } catch {
    return '';
  }
}
```

**Step 3: Include memory block in getCombinedSystemContextBlock**

Modify `getCombinedSystemContextBlock` (line 129-155) — add the memory block to the blocks array. After line 146 (`(info.globalContextBlock as string) || '',`), add:

```typescript
    (info.memoryBlock as string) || '',
```

**Step 4: Update warmSystemContextForSession to accept userMessage**

Modify the function signature at line 157 to:

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
  if (userMessage) {
    await warmMemoryBlockForSession(sessionId, userMessage);
  }
}
```

**Step 5: Commit**

```bash
git add apps/api/src/agents/systemContext.ts
git commit -m "feat: integrate memory retrieval into system context assembly"
```

---

### Task 8: Wire Memory Into ChapoLoop

**Files:**
- Modify: `apps/api/src/agents/chapo-loop.ts:113` (token limit)
- Modify: `apps/api/src/agents/chapo-loop.ts:117-119` (pass userMessage to warm)
- Modify: `apps/api/src/agents/chapo-loop.ts:116-135` (add compaction check)
- Modify: `apps/api/src/config.ts:69-70` (update default token limit)

**Step 1: Update token limit in config**

In `apps/api/src/config.ts` line 127, change:

```typescript
    looperMaxConversationTokens: parseInt(process.env.LOOPER_MAX_CONVERSATION_TOKENS || "180000", 10),
```

**Step 2: Update ConversationManager instantiation**

In `apps/api/src/agents/chapo-loop.ts` line 113, use config value:

```typescript
    this.conversation = new ConversationManager(config.maxConversationTokens);
```

Wait — the config is already passed through `config.maxIterations` etc. Let me check. The ChapoLoop constructor receives `config: ChapoLoopConfig` but the token limit is hardcoded at line 113. Change line 113:

```typescript
    this.conversation = new ConversationManager(180_000);
```

**Step 3: Pass userMessage to warmSystemContextForSession**

In `chapo-loop.ts` line 119, change:

```typescript
    await warmSystemContextForSession(this.sessionId, this.projectRoot, userMessage);
```

**Step 4: Add compaction import and logic**

Add import at top of chapo-loop.ts (after line 22):

```typescript
import { compactMessages } from '../memory/compaction.js';
```

Add a compaction check method to the ChapoLoop class (after the constructor, around line 115):

```typescript
  private async checkAndCompact(): Promise<void> {
    const COMPACTION_THRESHOLD = 160_000;
    const usage = this.conversation.getTokenUsage();

    if (usage < COMPACTION_THRESHOLD) return;

    const messages = this.conversation.getMessages();
    // Compact the oldest ~60% of messages
    const compactCount = Math.floor(messages.length * 0.6);
    if (compactCount < 2) return;

    const toCompact = messages.slice(0, compactCount);
    const toKeep = messages.slice(compactCount);

    const result = await compactMessages(toCompact, this.sessionId);

    // Replace conversation: summary + kept messages
    this.conversation.clear();
    this.conversation.setSystemPrompt(this.conversation.getSystemPrompt());
    this.conversation.addMessage({
      role: 'system',
      content: `[Context compacted — ${result.droppedTokens} tokens summarized]\n\n${result.summary}`,
    });
    for (const msg of toKeep) {
      this.conversation.addMessage(msg);
    }

    this.sendEvent({
      type: 'agent_thinking',
      agent: 'chapo',
      status: `Context kompaktiert: ${result.droppedTokens} → ${result.summaryTokens} Tokens`,
    });
  }
```

**Step 5: Call compaction check in runLoop**

In the runLoop method, before the LLM call (around line 185), add:

```typescript
      // Check if compaction needed before LLM call
      await this.checkAndCompact();
```

**Step 6: Commit**

```bash
git add apps/api/src/agents/chapo-loop.ts apps/api/src/config.ts
git commit -m "feat: wire compaction + memory retrieval into ChapoLoop"
```

---

### Task 9: Session-End Extraction Trigger

**Files:**
- Modify: `apps/api/src/websocket/chatGateway.ts:35-43`
- Modify: `apps/api/src/agents/router.ts:189-195`

**Step 1: Add session-end callback to chatGateway**

In `apps/api/src/websocket/chatGateway.ts`, add import at top:

```typescript
import { triggerSessionEndExtraction } from '../memory/service.js';
import { getMessages } from '../db/queries.js';
```

Modify `unregisterChatClient` (lines 35-43) to trigger extraction when session has no more clients:

```typescript
export function unregisterChatClient(ws: WebSocket, sessionId: string): void {
  const session = chatSessions.get(sessionId);
  if (!session) return;
  session.clients.delete(ws);

  if (session.clients.size === 0) {
    // Session ended — trigger async memory extraction
    getMessages(sessionId).then((messages) => {
      if (messages.length < 3) return; // Skip trivial sessions
      const conversationText = messages
        .map((m) => `[${m.role}]: ${m.content}`)
        .join('\n\n');
      triggerSessionEndExtraction(conversationText, sessionId);
    }).catch((err) => {
      console.error('[ChatGW] session-end extraction failed:', err);
    });

    if (session.events.length === 0) {
      chatSessions.delete(sessionId);
    }
  }

  console.log(`[ChatGW] Client unregistered from session ${sessionId}. Remaining: ${session?.clients.size ?? 0}`);
}
```

**Step 2: Commit**

```bash
git add apps/api/src/websocket/chatGateway.ts
git commit -m "feat: trigger memory extraction on session end"
```

---

### Task 10: Daily Decay Job

**Files:**
- Modify: `apps/api/src/server.ts` (add decay interval)

**Step 1: Add decay cron to server startup**

In `apps/api/src/server.ts`, add import:

```typescript
import { runDecay } from './memory/memoryStore.js';
```

After the `cleanupExpiredUserfiles` interval setup (around line 207), add:

```typescript
  // Run memory decay daily
  const DECAY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
  const runDecayJob = async () => {
    try {
      const result = await runDecay();
      console.info(`[server] memory decay: ${result.decayed} decayed, ${result.pruned} pruned`);
    } catch (err) {
      console.error('[server] memory decay failed:', err);
    }
  };
  // Run once on startup (delayed 30s to let DB init), then every 24h
  setTimeout(runDecayJob, 30_000);
  setInterval(runDecayJob, DECAY_INTERVAL_MS);
```

**Step 2: Commit**

```bash
git add apps/api/src/server.ts
git commit -m "feat: add daily memory decay job on server startup"
```

---

### Task 11: Update ConversationManager for Compaction Support

**Files:**
- Modify: `apps/api/src/agents/conversation-manager.ts`

**Step 1: Add methods needed for compaction**

The current ConversationManager needs a way to set system prompt after clear. The `clear()` method already exists (line 104), and `setSystemPrompt()` exists (line 27). But `checkAndCompact` in ChapoLoop calls `this.conversation.getSystemPrompt()` after clear — this is fine because clear only clears messages, not systemPrompt.

However, we need to verify the `addMessage` after `clear()` doesn't break the sliding window. Looking at `trimToTokenBudget` (line 116) — it keeps `MIN_KEPT = 4` messages. After compaction we re-add the summary + kept messages, so this should work naturally.

No changes needed to ConversationManager itself — the existing API is sufficient.

**Step 2: Verify by reading through the flow**

The compaction flow in ChapoLoop:
1. `this.conversation.getMessages()` — get all messages
2. Split into toCompact and toKeep
3. `compactMessages(toCompact)` — LLM summarizes
4. `this.conversation.clear()` — wipe messages (systemPrompt preserved)
5. Re-add summary as system message + re-add kept messages
6. Continue loop

This works with the current ConversationManager. Skip this task — no code changes needed.

---

### Task 12: Export Memory Module Index

**Files:**
- Create: `apps/api/src/memory/index.ts`

**Step 1: Write the index barrel export**

```typescript
// apps/api/src/memory/index.ts
export { retrieveRelevantMemories, triggerSessionEndExtraction } from './service.js';
export { runExtractionPipeline } from './extraction.js';
export { compactMessages } from './compaction.js';
export { runDecay, searchMemories } from './memoryStore.js';
export { generateEmbedding } from './embeddings.js';
export type { MemoryCandidate, StoredMemory, MemoryType, MemoryPriority, MemorySource } from './types.js';
```

**Step 2: Commit**

```bash
git add apps/api/src/memory/index.ts
git commit -m "feat: add memory module barrel export"
```

---

### Task 13: Integration Test — End-to-End Memory Flow

**Files:**
- Verify on Clawd server after Mutagen sync

**Step 1: Run the Supabase migration**

Execute the SQL from Task 1 against the DevAI Supabase instance.

**Step 2: Verify Mutagen sync**

Wait for Mutagen to sync the new files to Clawd (~500ms).

**Step 3: Check PM2 process restarts cleanly**

```bash
ssh root@77.42.90.193 "pm2 logs devai-api-dev --lines 20"
```

Look for:
- `[db] devai_memories table verified — memory system ready`
- No import errors

**Step 4: Test memory insertion manually**

Use curl or the DevAI chat to ask something, then check:

```bash
# On Clawd, check if memories were created
ssh root@77.42.90.193 "cd /opt/Devai && node -e \"
  const { createClient } = require('@supabase/supabase-js');
  // ... quick verification query
\""
```

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration fixes for memory system"
```

---

## File Summary

| Action | File | Purpose |
|--------|------|---------|
| Create | `apps/api/src/db/migrations/001_devai_memories.sql` | pgvector table + HNSW index + RPC function |
| Create | `apps/api/src/memory/types.ts` | Shared type definitions |
| Create | `apps/api/src/memory/embeddings.ts` | OpenAI embedding wrapper |
| Create | `apps/api/src/memory/memoryStore.ts` | CRUD + search + decay |
| Create | `apps/api/src/memory/extraction.ts` | Two-phase extraction pipeline |
| Create | `apps/api/src/memory/compaction.ts` | Context compaction with dual output |
| Create | `apps/api/src/memory/service.ts` | Retrieval + formatting + session-end trigger |
| Create | `apps/api/src/memory/index.ts` | Barrel exports |
| Modify | `apps/api/src/db/index.ts` | pgvector readiness check |
| Modify | `apps/api/src/agents/systemContext.ts` | Memory block injection + warm function |
| Modify | `apps/api/src/agents/chapo-loop.ts` | Compaction hook + memory-aware warm call |
| Modify | `apps/api/src/config.ts` | Token limit 120k → 180k |
| Modify | `apps/api/src/websocket/chatGateway.ts` | Session-end extraction trigger |
| Modify | `apps/api/src/server.ts` | Daily decay job |

## Dependency Order

```
Task 1 (DB migration) — no deps, run first
Task 2 (embeddings) — no deps
Task 3 (memoryStore) — depends on Task 1, 2
Task 4 (extraction) — depends on Task 2, 3
Task 5 (compaction) — depends on Task 4
Task 6 (service) — depends on Task 3, 4
Task 7 (systemContext) — depends on Task 6
Task 8 (chapoLoop) — depends on Task 5, 7
Task 9 (session-end) — depends on Task 6
Task 10 (decay job) — depends on Task 3
Task 12 (index) — depends on all create tasks
Task 13 (integration test) — depends on all
```

Tasks 1, 2 can run in parallel. Tasks 9, 10 can run in parallel after Task 6.
