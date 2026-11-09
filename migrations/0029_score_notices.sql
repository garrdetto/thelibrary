CREATE TABLE IF NOT EXISTS score_notices (
  user_id TEXT NOT NULL,
  game TEXT NOT NULL,
  detail TEXT,
  by_username TEXT NOT NULL,
  place INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, game)
);
CREATE INDEX IF NOT EXISTS score_notices_user_idx ON score_notices (user_id, created_at);
