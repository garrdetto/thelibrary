CREATE TABLE IF NOT EXISTS shorttrack_handling (
  track TEXT PRIMARY KEY,
  tune TEXT NOT NULL,
  updated_by TEXT,
  updated_at INTEGER NOT NULL
);
