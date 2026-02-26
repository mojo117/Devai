create table if not exists heartbeat_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null check (status in ('running', 'completed', 'failed', 'noop')),
  findings jsonb,
  actions_taken jsonb,
  tokens_used integer,
  model text,
  error text,
  duration_ms integer
);
