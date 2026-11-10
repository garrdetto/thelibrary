CREATE TABLE IF NOT EXISTS darts_legs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  board TEXT NOT NULL,
  mode TEXT NOT NULL,
  value INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS darts_bests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  board TEXT NOT NULL,
  mode TEXT NOT NULL,
  value INTEGER NOT NULL,
  times INTEGER NOT NULL,
  set_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS darts_bests_board_idx ON darts_bests (board, mode, value);
CREATE TABLE IF NOT EXISTS darts_matches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  board TEXT NOT NULL,
  mode TEXT NOT NULL,
  darts INTEGER NOT NULL,
  total INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS darts_averages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  board TEXT NOT NULL,
  mode TEXT NOT NULL,
  darts INTEGER NOT NULL,
  total INTEGER NOT NULL,
  matches INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS darts_averages_board_idx ON darts_averages (board, mode);
