-- Agent state persistence (multi-agent router)
-- Stores ConversationState as JSONB keyed by session_id.

CREATE TABLE IF NOT EXISTS agent_states (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_states_updated_at ON agent_states(updated_at DESC);

