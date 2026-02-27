-- Remove legacy agent names (devo, caio, scout) from CHECK constraints
-- DevAI now uses single-agent architecture (chapo only)

ALTER TABLE agent_execution_logs DROP CONSTRAINT IF EXISTS agent_execution_logs_agent_check;
ALTER TABLE agent_execution_logs ADD CONSTRAINT agent_execution_logs_agent_check
  CHECK (agent IN ('chapo', 'chapo-sub', 'system'));

ALTER TABLE agent_execution_logs DROP CONSTRAINT IF EXISTS agent_execution_logs_delegated_from_check;
ALTER TABLE agent_execution_logs ADD CONSTRAINT agent_execution_logs_delegated_from_check
  CHECK (delegated_from IS NULL OR delegated_from IN ('chapo'));
