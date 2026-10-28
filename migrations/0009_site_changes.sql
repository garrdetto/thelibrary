CREATE TABLE IF NOT EXISTS site_changes (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'change',
  request TEXT NOT NULL,
  target TEXT,
  auto_merge INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  progress TEXT,
  reply TEXT,
  cost_usd REAL,
  billing TEXT,
  commit_sha TEXT,
  pr_url TEXT,
  run_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS site_changes_thread_idx ON site_changes (thread_id, created_at);
CREATE INDEX IF NOT EXISTS site_changes_created_idx ON site_changes (created_at);

CREATE TABLE IF NOT EXISTS site_change_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
