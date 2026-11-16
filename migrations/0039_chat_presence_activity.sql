CREATE TABLE IF NOT EXISTS chat_activity (
  user_id TEXT PRIMARY KEY,
  active_at INTEGER,
  activity TEXT,
  activity_since INTEGER NOT NULL
);
