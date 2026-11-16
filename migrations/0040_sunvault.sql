CREATE TABLE IF NOT EXISTS sunvault_profiles (
  user_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  streak INTEGER NOT NULL DEFAULT 0,
  last_collect TEXT,
  round_win INTEGER NOT NULL DEFAULT 0,
  round_bet INTEGER NOT NULL DEFAULT 0,
  round_forced INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
