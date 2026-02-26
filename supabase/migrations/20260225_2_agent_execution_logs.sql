-- Agent execution telemetry (delegations, tool calls, etc.)
CREATE TABLE IF NOT EXISTS agent_execution_logs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent TEXT NOT NULL
    CHECK (agent IN ('chapo', 'devo', 'caio', 'scout')),
  delegated_from TEXT
    CHECK (delegated_from IS NULL OR delegated_from IN ('chapo', 'devo', 'caio')),
  phase TEXT NOT NULL
    CHECK (phase IN ('start', 'success', 'failure', 'escalated')),
  duration_ms INTEGER,
  iterations INTEGER DEFAULT 0,
  tokens_used INTEGER,
  tool_count INTEGER DEFAULT 0,
  model TEXT,
  provider TEXT,
  delegation_objective TEXT,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_execution_logs_session_id
  ON agent_execution_logs(session_id);

CREATE INDEX IF NOT EXISTS idx_agent_execution_logs_agent
  ON agent_execution_logs(agent);

CREATE INDEX IF NOT EXISTS idx_agent_execution_logs_created_at
  ON agent_execution_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_execution_logs_phase
  ON agent_execution_logs(phase);
