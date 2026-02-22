-- Short-term memory: recent focus topics
-- Tracks what topics/files have been worked on across sessions with fast decay (0.9^days)

CREATE TABLE IF NOT EXISTS devai_recent_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic TEXT NOT NULL,
  parent_topic TEXT,
  file_paths TEXT[] DEFAULT '{}',
  directories TEXT[] DEFAULT '{}',
  strength FLOAT DEFAULT 1.0,
  touch_count INT DEFAULT 1,
  session_count INT DEFAULT 1,
  first_seen_at TIMESTAMPTZ DEFAULT now(),
  last_touched_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recent_topics_active ON devai_recent_topics (is_active, strength DESC);
CREATE INDEX IF NOT EXISTS idx_recent_topics_topic ON devai_recent_topics (topic);
