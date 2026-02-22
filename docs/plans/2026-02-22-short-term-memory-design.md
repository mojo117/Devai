# Short-Term Memory: Recent Focus Awareness

## Problem

Devai has two memory layers today:
- **Working memory** — full conversation, lost when session ends
- **Long-term memory** — vector-embedded facts with decay (0.95^days), persistent

What's missing: a **recency-aware layer** that tracks *what you've been working on* (topics, domains, file paths) across sessions for days/weeks. When starting a new session, Devai doesn't know "you've been deep in the memory system for the past 3 days" — it starts cold every time.

## Solution

A short-term memory layer that:
- **Continuously tags topics** during each CHAPO loop iteration
- **Tracks file paths and directories** associated with each topic
- **Decays faster** than long-term memory (0.9^days, ~4 week lifespan)
- **Injects ambient context** into system prompt at session start
- **Persists as both** database records and a human-readable `RECENT_FOCUS.md`

## Data Model

### New table: `devai_recent_topics`

```sql
CREATE TABLE devai_recent_topics (
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

CREATE INDEX idx_recent_topics_active ON devai_recent_topics (is_active, strength DESC);
CREATE INDEX idx_recent_topics_topic ON devai_recent_topics (topic);
```

Key differences from `devai_memories`:
- No vector embeddings — topics matched by name, not semantics
- Faster decay (0.9^days vs 0.95^days)
- Tracks file paths and directories as arrays
- `touch_count` = intensity within sessions, `session_count` = breadth across sessions

## Topic Tagging During CHAPO Loop

### Hook point

After each CHAPO iteration (LLM call + tool execution), a lightweight tagging step fires:

```
User message → CHAPO decides action → Tools execute → [TAG TOPIC] → Next iteration
```

### Tagging mechanism

A small LLM call (GLM-4.7-Flash) analyzes:
- Current user message
- Tool calls just executed (file reads, writes, bash commands)
- Assistant's response

Returns:
```json
{
  "topic": "memory/extraction",
  "file_paths": ["/apps/api/src/memory/extraction.ts"],
  "directories": ["/apps/api/src/memory/"]
}
```

### Non-blocking and debounced

- Runs **async / fire-and-forget** — doesn't slow down main loop
- **Debounced** — only writes to DB when topic or files actually changed from last tag
- ~200 tokens input, ~50 tokens output per tag call
- ~5-10 tags per session, 3-5 actual DB writes after debounce

### Database update logic

1. **Fuzzy match** existing topics — if topic exists, bump `touch_count`, merge new file paths, reset `last_touched_at`
2. **No match** — insert new topic row
3. **Adaptive split** — if a broad topic has `session_count >= 3` and current tag is more specific, create child with `parent_topic` set

## Adaptive Topic Granularity

### Evolution phases

**Phase 1 (sessions 1-2):** Broad tagging — `memory`, `auth`, `UI`

**Phase 2 (session 3+):** The tagging prompt receives existing topics as context. When work is clearly more specific than an existing broad topic, it proposes sub-topics: `memory/extraction`, `memory/retrieval`

**Phase 3:** Both parent and child coexist. Brief touches tag the parent, deep work tags the child.

### Constraints

- Max depth: 2 levels (`memory/extraction`, never `memory/extraction/dedup`)
- Only splits when parent has 3+ sessions
- Prefers reusing existing topic names over creating new ones

## Decay & Lifecycle

### Daily decay job

Extends existing `systemReliability.ts` scheduler:

```
For each active topic:
  new_strength = strength × (0.9 ^ days_since_last_touched)
  if new_strength < 0.05 → set is_active = false
```

### Timeline

| Time since last touch | Strength | Status |
|---|---|---|
| Same day | 1.0 | Fresh |
| 2 days | 0.81 | Strong |
| 1 week | 0.48 | Fading |
| 2 weeks | 0.23 | Weak |
| 3 weeks | 0.11 | Almost gone |
| ~4 weeks | < 0.05 | Pruned |

### Reinforcement

Returning to a topic: `strength` resets to 1.0, `touch_count++`, `session_count++`, `last_touched_at` updates.

### Relationship to long-term memory

Short-term topics don't replace long-term memories. Short-term tracks *attention*, long-term tracks *knowledge*. A pruned short-term topic doesn't delete anything.

## Context Injection at Session Start

### System context assembly order

```
[DEVAI.md]
[CLAUDE.md]
[Workspace files]
[Global context]
[Recent Focus block]        ← NEW
[Memory Quality Signals]
[Retrieved Memories block]
[Memory Behavior block]
```

### Injected block format

```
## Recent Focus (last 7 days)

You've been actively working on:
- **memory/extraction** (4 sessions, last touched 6h ago) — extraction.ts, service.ts @ /apps/api/src/memory/
- **memory/retrieval** (2 sessions, last touched 2d ago, fading) — memoryStore.ts @ /apps/api/src/memory/
- **deployment** (1 session, last touched 5d ago, weak) — systemReliability.ts @ /apps/api/src/services/
```

### Token budget

- **Recent Focus block**: up to 800 tokens
- **Long-term memory block**: increased from 2000 to 3000 tokens
- **Total memory/context budget**: ~3800 tokens (up from 2000)

### Two-source assembly

1. **Fast path**: Read `workspace/memory/RECENT_FOCUS.md`
2. **Rich path**: Query `devai_recent_topics WHERE is_active = true ORDER BY strength DESC`
3. **Merge**: DB is source of truth, markdown is cache + fallback

## RECENT_FOCUS.md Rendering

### Write triggers

- **Session end** — websocket disconnect (same hook as memory extraction)
- **Topic change** — when a new topic is tagged different from the last one

### File format

```markdown
# Recent Focus
> Auto-generated. Manual edits are respected — removals and additions sync back.
> Last updated: 2026-02-22T14:30:00Z

## Active
- **memory/extraction** | 4 sessions | last: 6h ago | strength: 0.95
  files: extraction.ts, service.ts
  dirs: /apps/api/src/memory/

- **memory/retrieval** | 2 sessions | last: 2d ago | strength: 0.81
  files: memoryStore.ts
  dirs: /apps/api/src/memory/

## Fading
- **deployment** | 1 session | last: 5d ago | strength: 0.48
  files: systemReliability.ts
  dirs: /apps/api/src/services/
```

### Manual edit sync

At session start, diff file contents against DB state:
- **Topic removed from file** → mark `is_active = false` in DB
- **Topic added to file** → insert into DB with `strength: 1.0`
- **File paths edited** → update arrays in DB

### Location

`workspace/memory/RECENT_FOCUS.md` — alongside existing `MEMORY.md` and daily files.

## Integration with Long-Term Memory Retrieval

### Recency-boosted retrieval

Active short-term topics augment memory search:

1. **Query augmentation**: search query gets context from active topics
   - Original: `"how does deduplication work"`
   - Augmented: `"how does deduplication work (context: memory/extraction system)"`

2. **File-path awareness**: when Devai needs to find a file, recent topics provide known paths before searching the whole codebase

### Independence

- Doesn't change how long-term memories are stored or extracted
- Doesn't alter long-term decay rates
- Doesn't duplicate data between systems

## Files to Create/Modify

### New files
- `apps/api/src/memory/recentFocus.ts` — topic store (DB CRUD, decay, sync)
- `apps/api/src/memory/topicTagger.ts` — LLM tagging logic + debounce
- `apps/api/src/memory/recentFocusRenderer.ts` — RECENT_FOCUS.md rendering + manual edit sync
- `db/migrations/XXX_devai_recent_topics.sql` — table + indexes

### Modified files
- `apps/api/src/agents/chapo-loop.ts` — hook tagging after tool execution
- `apps/api/src/agents/systemContext.ts` — add Recent Focus block, increase token budgets
- `apps/api/src/memory/service.ts` — augment retrieval with recent topic context
- `apps/api/src/memory/index.ts` — export new modules
- `apps/api/src/services/systemReliability.ts` — add short-term decay job
- `apps/api/src/websocket/chatGateway.ts` — trigger RECENT_FOCUS.md render on disconnect
