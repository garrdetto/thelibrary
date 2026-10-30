CREATE TABLE IF NOT EXISTS chat_reads (
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  thread_key TEXT NOT NULL,
  last_read_id INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, thread_key)
);
CREATE INDEX IF NOT EXISTS chat_reads_thread_idx ON chat_reads (thread_key, updated_at);
