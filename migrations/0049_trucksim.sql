CREATE TABLE IF NOT EXISTS trucksim_profiles (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trucksim_lots (
  lot_index INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  seen_at INTEGER NOT NULL
);
