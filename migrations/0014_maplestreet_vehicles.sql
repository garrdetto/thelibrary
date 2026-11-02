CREATE TABLE IF NOT EXISTS maplestreet_vehicles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  spec TEXT NOT NULL,
  model_type TEXT NOT NULL,
  model_bytes INTEGER NOT NULL,
  wheel_type TEXT,
  wheel_bytes INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS maplestreet_vehicles_created_idx ON maplestreet_vehicles (created_at);
