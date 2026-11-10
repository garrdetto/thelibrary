CREATE TABLE IF NOT EXISTS rackreel_lobbies (
  code TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL,
  host TEXT NOT NULL,
  players INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rackreel_lobbies_updated ON rackreel_lobbies (updated_at);
