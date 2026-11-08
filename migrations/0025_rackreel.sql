CREATE TABLE IF NOT EXISTS rackreel_profiles (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
