CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  pin_hash TEXT,
  pin_salt TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  pages TEXT NOT NULL DEFAULT '[]',
  settings TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS login_failures (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tickets (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pool_preferences (
  user_id TEXT PRIMARY KEY,
  appearance TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pool_practice_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  mode TEXT NOT NULL,
  milliseconds INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pool_practice_mode_time_idx ON pool_practice_records (mode, milliseconds, created_at);

CREATE TABLE IF NOT EXISTS racing_profiles (
  user_id TEXT PRIMARY KEY,
  scheme TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS racing_laps (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  milliseconds INTEGER NOT NULL,
  mode TEXT NOT NULL,
  track TEXT NOT NULL DEFAULT 'circuit',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS racing_laps_track_mode_idx ON racing_laps (track, mode, milliseconds);

CREATE TABLE IF NOT EXISTS creations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  content TEXT NOT NULL,
  messages TEXT NOT NULL DEFAULT '[]',
  settings TEXT,
  image_mime TEXT,
  parent_id TEXT,
  tuning TEXT NOT NULL DEFAULT '[]',
  research TEXT,
  style_prompt TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS creations_user_date_idx ON creations (user_id, created_at);

CREATE TABLE IF NOT EXISTS lyric_corrections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  original TEXT NOT NULL,
  replacement TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS lyric_corrections_user_idx ON lyric_corrections (user_id, created_at);

CREATE TABLE IF NOT EXISTS lyric_presets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  settings TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS lyric_presets_user_idx ON lyric_presets (user_id, updated_at);
