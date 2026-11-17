CREATE TABLE IF NOT EXISTS gspro_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  source TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  last_shot_at INTEGER NOT NULL,
  shot_count INTEGER NOT NULL DEFAULT 0,
  closed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS gspro_sessions_user_idx ON gspro_sessions (user_id, last_shot_at);
CREATE TABLE IF NOT EXISTS gspro_shots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  shot_ref TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  club TEXT,
  handed TEXT NOT NULL DEFAULT 'RH',
  ball_speed REAL NOT NULL,
  launch REAL NOT NULL,
  direction REAL NOT NULL,
  total_spin REAL NOT NULL,
  spin_axis REAL NOT NULL,
  carry REAL,
  club_speed REAL,
  attack_angle REAL,
  path REAL,
  face REAL,
  dynamic_loft REAL,
  lie REAL,
  impact_h REAL,
  impact_v REAL,
  excluded INTEGER NOT NULL DEFAULT 0,
  raw TEXT
);
CREATE INDEX IF NOT EXISTS gspro_shots_user_idx ON gspro_shots (user_id, id);
CREATE INDEX IF NOT EXISTS gspro_shots_session_idx ON gspro_shots (session_id, id);
CREATE TABLE IF NOT EXISTS gspro_bridge (
  user_id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  key_hint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  status TEXT
);
