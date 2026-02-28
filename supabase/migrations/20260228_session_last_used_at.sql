-- Add last_used_at column for session recency tracking and auto-cleanup
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill existing sessions with created_at
UPDATE sessions SET last_used_at = created_at WHERE last_used_at = NOW();

-- Index for sorting by recency per user
CREATE INDEX IF NOT EXISTS idx_sessions_last_used ON sessions(user_id, last_used_at DESC);
