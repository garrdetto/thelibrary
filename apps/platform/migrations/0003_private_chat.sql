ALTER TABLE chat_messages ADD COLUMN thread TEXT;
ALTER TABLE chat_messages ADD COLUMN meta TEXT;
CREATE INDEX IF NOT EXISTS chat_messages_thread_idx ON chat_messages (thread, id);
CREATE TABLE IF NOT EXISTS chat_presence (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  activity TEXT,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_presence_seen_idx ON chat_presence (last_seen);
