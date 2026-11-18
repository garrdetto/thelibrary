CREATE TABLE IF NOT EXISTS gspro_rounds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  round_key TEXT NOT NULL,
  course TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  last_shot_at INTEGER NOT NULL,
  shot_count INTEGER NOT NULL DEFAULT 0,
  players TEXT NOT NULL DEFAULT '[]',
  UNIQUE (user_id, round_key)
);
CREATE INDEX IF NOT EXISTS gspro_rounds_user_idx ON gspro_rounds (user_id, last_shot_at);
CREATE TABLE IF NOT EXISTS gspro_course_shots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  shot_ref TEXT NOT NULL UNIQUE,
  player TEXT NOT NULL,
  hole INTEGER NOT NULL,
  hole_shot INTEGER NOT NULL,
  seen_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS gspro_course_shots_round_idx ON gspro_course_shots (round_id, hole, hole_shot);
CREATE TABLE IF NOT EXISTS gspro_settings (
  user_id TEXT PRIMARY KEY,
  bag TEXT,
  updated_at INTEGER NOT NULL
);
