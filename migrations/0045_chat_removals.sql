CREATE TABLE IF NOT EXISTS chat_removals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_key TEXT NOT NULL,
  message_id INTEGER,
  up_to INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_removals_time_idx ON chat_removals (created_at);
