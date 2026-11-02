CREATE TABLE IF NOT EXISTS maplestreet_items (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  room TEXT NOT NULL,
  func TEXT NOT NULL,
  indoor INTEGER NOT NULL,
  solid INTEGER NOT NULL,
  scale_x REAL NOT NULL,
  scale_y REAL NOT NULL,
  scale_z REAL NOT NULL,
  yaw INTEGER NOT NULL,
  width INTEGER NOT NULL,
  depth INTEGER NOT NULL,
  height REAL NOT NULL,
  model_type TEXT NOT NULL,
  model_bytes INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS maplestreet_items_created_idx ON maplestreet_items (created_at);
