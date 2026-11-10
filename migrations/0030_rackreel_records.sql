CREATE TABLE IF NOT EXISTS rackreel_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  category TEXT NOT NULL,
  value REAL NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rackreel_records_category ON rackreel_records (category, value DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS rackreel_records_user ON rackreel_records (category, user_id);
