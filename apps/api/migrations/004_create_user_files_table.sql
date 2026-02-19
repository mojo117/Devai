-- User files table for uploaded document storage and AI context injection.
-- Files are stored in Supabase Storage; this table tracks metadata + parsed content.

CREATE TABLE IF NOT EXISTS user_files (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  parsed_content TEXT,
  parse_status TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_user_files_expires ON user_files(expires_at);
