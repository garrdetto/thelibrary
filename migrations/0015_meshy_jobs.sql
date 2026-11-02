CREATE TABLE IF NOT EXISTS meshy_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  task_id TEXT NOT NULL,
  parent_id TEXT,
  prompt TEXT NOT NULL,
  options TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  credits INTEGER NOT NULL DEFAULT 0,
  thumbnail_url TEXT,
  model_bytes INTEGER,
  error TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS meshy_jobs_created_idx ON meshy_jobs (created_at);
