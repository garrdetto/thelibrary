CREATE TABLE IF NOT EXISTS music_tracks (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  bytes INTEGER NOT NULL,
  duration REAL NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS music_tracks_position ON music_tracks (position, created_at);
