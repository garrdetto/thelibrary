CREATE TABLE IF NOT EXISTS songmaker_songs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  style TEXT NOT NULL,
  lyrics TEXT NOT NULL,
  length TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS songmaker_songs_user ON songmaker_songs (user_id, created_at);
