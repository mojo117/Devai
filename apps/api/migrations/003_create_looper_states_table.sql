-- Looper persistence
-- Stores a snapshot of LooperEngine so a "clarify" continuation can resume after API restarts.

CREATE TABLE IF NOT EXISTS looper_states (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'idle',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_looper_states_updated_at ON looper_states(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_looper_states_status ON looper_states(status);

