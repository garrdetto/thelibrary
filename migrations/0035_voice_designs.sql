CREATE TABLE IF NOT EXISTS voice_designs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  voice_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS voice_designs_user_idx ON voice_designs (user_id, created_at);
