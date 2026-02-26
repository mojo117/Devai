import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const sql = `
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

CREATE INDEX IF NOT EXISTS idx_agent_execution_logs_session_id ON agent_execution_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_execution_logs_agent ON agent_execution_logs(agent);
CREATE INDEX IF NOT EXISTS idx_agent_execution_logs_created_at ON agent_execution_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_execution_logs_phase ON agent_execution_logs(phase);
`;

// Use RPC to execute raw SQL - we need to call a function that runs the SQL
// Since Supabase REST API doesn't support raw SQL directly, we'll try inserting a test row
// to see if the table exists

const { error: testError } = await supabase
  .from('agent_execution_logs')
  .select('id')
  .limit(1);

if (testError && testError.code === 'PGRST204') {
  console.log('Table does not exist. Please run the migration manually in Supabase SQL Editor:');
  console.log('\n--- SQL ---\n');
  console.log(sql);
  console.log('\n--- END SQL ---\n');
  process.exit(1);
}

if (testError) {
  console.error('Error checking table:', testError);
  process.exit(1);
}

console.log('✅ Table agent_execution_logs already exists!');
