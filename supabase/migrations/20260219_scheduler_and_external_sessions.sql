-- Scheduled jobs (cron-based automation)
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  instruction TEXT NOT NULL,
  notification_channel TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  one_shot BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled_by_error', 'paused')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  last_result TEXT,
  last_error_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_enabled ON scheduled_jobs(enabled);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_status ON scheduled_jobs(status);

-- External messaging sessions (Telegram, Discord, etc.)
CREATE TABLE IF NOT EXISTS external_sessions (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  external_chat_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  is_default_channel BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_external_sessions_platform ON external_sessions(platform, external_user_id);
CREATE INDEX IF NOT EXISTS idx_external_sessions_session_id ON external_sessions(session_id);
