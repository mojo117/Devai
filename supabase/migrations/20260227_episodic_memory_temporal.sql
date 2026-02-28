-- Episodic memory: temporal indexes + source constraint extension + time-range RPC

-- 1. Temporal index for time-based retrieval
CREATE INDEX IF NOT EXISTS idx_memories_created_at
  ON devai_memories (created_at DESC)
  WHERE is_valid = true;

-- 2. Composite index for namespace + time queries
CREATE INDEX IF NOT EXISTS idx_memories_namespace_created
  ON devai_memories (namespace, created_at DESC)
  WHERE is_valid = true;

-- 3. Extend source CHECK constraint for new episodic sources
ALTER TABLE devai_memories DROP CONSTRAINT IF EXISTS devai_memories_source_check;
ALTER TABLE devai_memories ADD CONSTRAINT devai_memories_source_check
  CHECK (source IN (
    'user_stated', 'error_resolution', 'pattern', 'discovery', 'compaction',
    'episodic_turn', 'episodic_tool', 'topic_promotion'
  ));

-- 4. RPC function for temporal retrieval
CREATE OR REPLACE FUNCTION get_memories_by_timerange(
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  row_limit INT DEFAULT 20
) RETURNS TABLE (
  id UUID,
  content TEXT,
  memory_type TEXT,
  namespace TEXT,
  strength FLOAT,
  priority TEXT,
  created_at TIMESTAMPTZ,
  session_id TEXT
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
    SELECT m.id, m.content, m.memory_type, m.namespace,
           m.strength, m.priority, m.created_at, m.session_id
    FROM devai_memories m
    WHERE m.is_valid = true
      AND m.created_at >= start_date
      AND m.created_at < end_date
    ORDER BY m.created_at DESC
    LIMIT row_limit;
END; $$;
