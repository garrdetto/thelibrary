CREATE TABLE IF NOT EXISTS world_edit_revisions (
  id TEXT PRIMARY KEY,
  world TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  author TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  ops INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  kept INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS world_edit_revisions_world_created ON world_edit_revisions (world, created_at);
CREATE TABLE IF NOT EXISTS world_edit_state (
  world TEXT PRIMARY KEY,
  draft_id TEXT,
  published_id TEXT,
  published_at INTEGER,
  updated_at INTEGER NOT NULL
);
