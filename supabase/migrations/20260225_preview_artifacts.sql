-- Preview artifact pipeline (html/svg/webapp/pdf/scrape)
CREATE TABLE IF NOT EXISTS preview_artifacts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  source_kind TEXT NOT NULL DEFAULT 'inline'
    CHECK (source_kind IN ('inline', 'tool_event', 'manual')),
  artifact_type TEXT NOT NULL
    CHECK (artifact_type IN ('html', 'svg', 'webapp', 'pdf', 'scrape')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'building', 'ready', 'failed')),
  title TEXT,
  language TEXT,
  entrypoint TEXT,
  source_files JSONB,
  workspace_mounts JSONB,
  inline_content TEXT,
  storage_bucket TEXT,
  storage_path TEXT,
  mime_type TEXT,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_preview_artifacts_session_created
  ON preview_artifacts(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_preview_artifacts_status
  ON preview_artifacts(status, updated_at DESC);

