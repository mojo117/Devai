-- Actions table for persistent action storage
-- This table stores pending, approved, and executed actions

CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  tool_args JSONB NOT NULL DEFAULT '{}',
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  preview JSONB,
  result JSONB,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMP WITH TIME ZONE,
  rejected_at TIMESTAMP WITH TIME ZONE,
  executed_at TIMESTAMP WITH TIME ZONE
);

-- Index for fast pending actions lookup
CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status);

-- Index for session-based queries
CREATE INDEX IF NOT EXISTS idx_actions_session ON actions(session_id);

-- Index for created_at for cleanup queries
CREATE INDEX IF NOT EXISTS idx_actions_created_at ON actions(created_at);

-- Enable Row Level Security (optional, for multi-tenant setups)
-- ALTER TABLE actions ENABLE ROW LEVEL SECURITY;
