# Session Intelligence & Long-Term Memory System

> Design document for DevAI's memory layer — context compaction, vector memory via Supabase, and project self-awareness.

## Motivation

DevAI currently uses a 180k token sliding window that drops old messages when context fills up. This means:
- Learnings from past sessions are lost
- Long conversations lose early context without summarization
- The system has no "muscle memory" — every session starts from zero
- Project knowledge must be re-explained each time

Inspired by OpenClaw's memory architecture and industry best practices (Mem0, LangGraph, AWS AgentCore), this design adds a three-layer memory system that lets DevAI learn from experience.

## Architecture: Three Memory Layers

### Layer 1 — Working Memory (exists)

The current conversation context. Messages, tool calls, results. Sliding window at **180k tokens** (up from 120k to match GLM's 200k context, leaving 20k headroom for system prompt + response).

### Layer 2 — Session Summary (new)

When working memory approaches **160k tokens**, a compaction step fires. One LLM call produces two outputs:
- A compressed summary (~3-5k tokens) replacing the old messages
- Memory candidates promoted to Layer 3

### Layer 3 — Long-Term Memory (new)

A Supabase `pgvector` table with hierarchical namespaces. Stores three types:
- **Semantic** — facts and knowledge ("TaskForge task-api uses JWT auth")
- **Episodic** — what worked/failed ("deploying with --force requires manual activation")
- **Procedural** — patterns and workflows ("to fix a 503 on Appwrite: check imports first, then deployment status")

## Memory Extraction

### Triggers

Memory extraction fires at **two points**:

**1. Compaction (mid-conversation)** — when context hits 160k tokens, the compaction+extraction LLM call handles both summarization and learning extraction in one pass.

**2. Session End (short conversations)** — when a chat session closes (disconnect, timeout, new chat started), a background post-session extraction reviews the full conversation and extracts learnings asynchronously. Does not block the user.

### Priority Levels

1. **Highest — User-stated** ("remember this", corrections mid-task) — always stored, no filtering, never decay
2. **High — Error-to-resolution pairs** (something failed, then got fixed)
3. **Medium — Successful patterns** (multi-step tool chains that completed cleanly)
4. **Low — Discovered facts** (project structure, file locations, config details)

### What Gets Stored

- Successful multi-step tool chains (the "how" of doing something)
- Corrections the user made ("no, that path is X not Y")
- Errors encountered and how they were resolved
- Architectural facts discovered about a project
- Tool argument patterns that worked

### What Gets Filtered Out

- Casual conversation, greetings
- Intermediate reasoning that led nowhere
- Verbose tool output (file contents, log dumps)
- Information already in project docs or SOUL.md

### Extraction Prompt

The extraction LLM is asked: *"What from this conversation would help you do a better job next time?"* — with explicit instructions to weight user corrections highest.

## Two-Phase Deduplication Pipeline

Runs on every extraction (both triggers):

### Phase 1 — Extract

One LLM call reviews the conversation or compacted chunk. Produces candidate memories as structured objects:

```json
{
  "content": "Appwrite functions need manual deployment activation via REST API PATCH after push --force",
  "type": "procedural",
  "namespace": "devai/project/taskforge/deployment",
  "source": "error_resolution"
}
```

### Phase 2 — Deduplicate

Each candidate gets vector-searched against existing memories (cosine threshold 0.8). A second LLM call per match decides:

- **ADD** — genuinely new knowledge
- **UPDATE** — refines or extends an existing memory (old one gets `superseded_by` pointing to new)
- **DELETE** — contradicts an outdated memory (old one marked `is_valid = false`)
- **NOOP** — already known, no action

Phase 2 runs asynchronously — does not block conversation flow.

## Namespace Hierarchy

Memories are scoped via slash-separated hierarchical namespaces:

```
devai/global/patterns          → "Appwrite needs manual deployment activation"
devai/global/tools             → "grep is faster than multiple file_read calls for searching"
devai/project/taskforge/arch   → "task-api uses JWT, api-project-access uses tfapi_ keys"
devai/project/taskforge/fixes  → "InputFile must be imported from node-appwrite/file"
devai/project/devai/arch       → "agents are in apps/api/src/agents/, prompts in prompts/"
devai/user/preferences         → "User prefers TypeScript, never use any type"
```

When working on a project, retrieval searches:
- `devai/global/*` (always)
- `devai/project/<current-project>/*` (project-specific)
- `devai/user/*` (always)

No cross-project contamination, but universal lessons are always available.

## Retrieval Flow

When a new message arrives, before the CHAPO decision loop:

1. **Build query** — combine user message + current project context
2. **Scoped vector search** — search Supabase with namespace filtering, `is_valid = true AND strength > 0.05`, top 15 results above 0.7 similarity
3. **Rank and budget** — sort by `similarity * strength`, pack into a **2k token budget**
4. **Inject into system prompt** — added as `## Relevant Memories` section after SOUL.md, grouped by type:

```
## Relevant Memories

### Project Knowledge (TaskForge)
- task-api uses JWT auth, api-project-access uses tfapi_ keys
- InputFile must be imported from node-appwrite/file, not main package

### Patterns
- After appwrite push --force, activate deployment via REST API PATCH

### Past Fixes
- 503 with ~0.012s duration = broken import in _shared/appwrite-client.js
```

5. **Access reinforcement** — every injected memory gets `access_count++` and `last_accessed_at` updated

## Context Compaction

### Trigger

Context exceeds 160k tokens.

### Process

One LLM call receives the oldest ~60k tokens and produces:

**Summary (~3-5k tokens)** preserving:
- Key decisions made and why
- Tool calls that succeeded/failed and their outcomes
- Unresolved questions or pending tasks
- Current state of work (what's done, what's next)

**Summary discards:**
- Full file contents from read calls
- Verbose bash/tool output
- Repeated failed attempts (keeps only the final working version)

### Result

- Old ~60k tokens replaced by ~3-5k summary
- Context drops from ~160k back to ~100-105k
- Memory candidates enter the async dedup pipeline
- A `[Context compacted]` marker in conversation so CHAPO knows

### Progressive Compression

If compaction triggers multiple times in a very long session, each summary builds on the previous — the LLM gets the prior summary plus the next chunk, producing a merged summary.

## Memory Decay

**Ebbinghaus-based formula:**

```
strength *= 0.95 ^ days_since_last_access
```

- Memories accessed frequently stay strong (reinforced on retrieval)
- Unused memories decay toward zero
- Pruning threshold: `strength < 0.05` → mark `is_valid = false`
- **Exception:** `priority = 'highest'` (user-stated) memories never decay — only invalidated by explicit contradiction

**Runs as:** daily cron job or Supabase scheduled function.

## Supabase Schema

```sql
create extension if not exists vector;

create table devai_memories (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  embedding vector(512),
  memory_type text not null,        -- 'semantic', 'episodic', 'procedural'
  namespace text not null,           -- 'devai/global/patterns'
  priority text default 'medium',    -- 'highest', 'high', 'medium', 'low'
  source text,                       -- 'user_stated', 'error_resolution', 'pattern', 'discovery'
  strength float default 1.0,
  access_count int default 0,
  last_accessed_at timestamptz default now(),
  session_id text,
  is_valid boolean default true,
  superseded_by uuid references devai_memories(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- HNSW index for cosine similarity (handles frequent writes well)
create index on devai_memories
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Filtering indexes
create index on devai_memories (namespace);
create index on devai_memories (is_valid) where is_valid = true;
```

### Similarity Search Function

```sql
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

### Decay Job (daily)

```sql
update devai_memories
set strength = strength * power(0.95, extract(day from now() - last_accessed_at))
where is_valid = true;

update devai_memories
set is_valid = false
where strength < 0.05 and priority != 'highest';
```

### Embedding Model

OpenAI `text-embedding-3-small` at **512 dimensions** — best cost/performance ratio per Supabase benchmarks. Native dimension reduction via API `dimensions` parameter.

## Integration Points

### What Changes

| File | Change |
|------|--------|
| `apps/api/src/agents/router.ts` | Add memory retrieval call before `processRequest` |
| `apps/api/src/memory/service.ts` | **New** — Memory Service (retrieve, extract, deduplicate, decay) |
| `apps/api/src/memory/compaction.ts` | **New** — compaction logic with dual output |
| `apps/api/src/memory/embeddings.ts` | **New** — OpenAI embedding wrapper |
| `apps/api/src/prompts/chapo.ts` | Add `## Relevant Memories` section to system prompt template |
| `apps/api/src/websocket/` | Hook session close event for post-session extraction |
| Supabase | Migration: `devai_memories` table + indexes + RPC function |
| `.env` | Add `OPENAI_EMBEDDING_MODEL`, memory thresholds |

### What Does NOT Change

- Agent definitions (CHAPO, DEVO, SCOUT, CAIO) — they just get better context
- Tool registry and executor — untouched
- Approval workflows — untouched
- Frontend — no UI changes for v1

### Flow Diagram

```
User message arrives
  │
  ▼
Memory Service: retrieve relevant memories
  │
  ▼
System prompt assembly:
  SOUL.md + Project Context + Relevant Memories + Agent Definitions
  │
  ▼
Token check: is context > 160k?
  ├─ yes → Compaction (summarize + extract), then continue
  └─ no  → Continue
  │
  ▼
CHAPO Decision Loop (unchanged)
  → delegates to DEVO / SCOUT / CAIO as normal
  │
  ▼
Response delivered to user
  │
  ▼
Session ends? (disconnect / timeout / new chat)
  ├─ yes → Post-session extraction (async background job)
  └─ no  → Wait for next message
```

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Vector DB | Supabase pgvector | Already in stack, no new infrastructure |
| Embedding model | text-embedding-3-small @ 512d | Best QPS/recall ratio per Supabase benchmarks |
| Index type | HNSW | Handles frequent writes better than IVFFlat |
| Distance metric | Cosine | Industry standard for text embeddings |
| Retrieval threshold | 0.7 similarity | Balances relevance vs recall |
| Dedup threshold | 0.8 similarity | Prevents near-duplicate storage |
| Memory budget | 2k tokens in prompt | Enough to be useful, doesn't crowd conversation |
| Decay formula | 0.95^days | Gentle decay, ~35 days to reach 0.17 strength |
| Prune threshold | 0.05 strength | ~58 unused days before pruning |
| Compaction trigger | 160k tokens | 80% of 200k context, leaves room for system prompt |
| Sliding window | 180k tokens | Matches GLM 200k context with 20k headroom |

## References

- [Mem0 Paper](https://arxiv.org/abs/2504.19413) — two-phase memory pipeline
- [LangGraph Memory](https://docs.langchain.com/oss/python/langchain/long-term-memory) — namespace hierarchy
- [Supabase pgvector](https://supabase.com/blog/fewer-dimensions-are-better-pgvector) — 512d benchmarks
- [Google ADK Compaction](https://google.github.io/adk-docs/context/compaction/) — sliding window summarization
- [FadeMem](https://arxiv.org/html/2601.18642) — Ebbinghaus decay for AI memory
- OpenClaw architecture analysis (internal, 2026-02-20)
