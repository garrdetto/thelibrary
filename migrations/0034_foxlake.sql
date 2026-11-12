CREATE TABLE IF NOT EXISTS casino_tables (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS casino_machine_state (
  user_id TEXT NOT NULL,
  machine TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, machine)
);
CREATE TABLE IF NOT EXISTS foxlake_world (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
