CREATE TABLE IF NOT EXISTS bridge_progress (
  user_id TEXT NOT NULL,
  level INTEGER NOT NULL,
  cost INTEGER NOT NULL,
  stars INTEGER NOT NULL,
  design TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, level)
);
