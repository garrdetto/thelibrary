CREATE TABLE IF NOT EXISTS park_saves (
  user_id TEXT NOT NULL,
  slot INTEGER NOT NULL,
  name TEXT NOT NULL,
  scenario TEXT NOT NULL,
  summary TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, slot)
);
