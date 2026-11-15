CREATE TABLE IF NOT EXISTS clipart_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  status TEXT NOT NULL,
  engine TEXT NOT NULL,
  model TEXT NOT NULL,
  preset TEXT NOT NULL,
  source_name TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  mime TEXT NOT NULL DEFAULT '',
  bytes INTEGER NOT NULL DEFAULT 0,
  settings TEXT NOT NULL,
  prompt TEXT NOT NULL,
  error TEXT
);
CREATE INDEX IF NOT EXISTS clipart_jobs_created ON clipart_jobs (created_at);
