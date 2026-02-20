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

create index if not exists idx_memories_embedding
  on devai_memories using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists idx_memories_namespace on devai_memories (namespace);
create index if not exists idx_memories_valid on devai_memories (is_valid) where is_valid = true;
create index if not exists idx_memories_type on devai_memories (memory_type);

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
