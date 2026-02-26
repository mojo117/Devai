-- Persistent scheduler/internal job telemetry
CREATE TABLE IF NOT EXISTS scheduler_execution_logs (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  job_name TEXT NOT NULL,
  execution_type TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (execution_type IN ('scheduled', 'internal', 'watchdog')),
  phase TEXT NOT NULL
    CHECK (phase IN ('start', 'success', 'failure', 'disabled', 'recovered', 'info')),
  message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduler_execution_logs_created_at
  ON scheduler_execution_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scheduler_execution_logs_job_name
  ON scheduler_execution_logs(job_name);

CREATE INDEX IF NOT EXISTS idx_scheduler_execution_logs_phase
  ON scheduler_execution_logs(phase);
