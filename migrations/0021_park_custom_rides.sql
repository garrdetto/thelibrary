CREATE TABLE IF NOT EXISTS park_custom_rides (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  spec TEXT NOT NULL,
  mesh_version INTEGER NOT NULL DEFAULT 0,
  mesh_bytes INTEGER NOT NULL DEFAULT 0,
  has_thumb INTEGER NOT NULL DEFAULT 0,
  has_source INTEGER NOT NULL DEFAULT 0,
  source_job TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS park_custom_rides_status_idx ON park_custom_rides (status, created_at);
