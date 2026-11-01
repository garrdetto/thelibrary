CREATE TABLE IF NOT EXISTS park_scores_by_park (
  park_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  scenario TEXT NOT NULL,
  username TEXT NOT NULL,
  park_name TEXT NOT NULL,
  value INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  saved_at INTEGER,
  snapshot TEXT
);

CREATE INDEX IF NOT EXISTS park_scores_by_park_scenario_value_idx
  ON park_scores_by_park (scenario, value DESC, saved_at DESC);

INSERT OR IGNORE INTO park_scores_by_park
  (park_id, user_id, scenario, username, park_name, value, updated_at, saved_at, snapshot)
SELECT lower(hex(randomblob(16))), user_id, scenario, username, COALESCE(NULLIF(park_name, ''), 'Unnamed park'),
  value, updated_at, COALESCE(saved_at, updated_at), snapshot
FROM park_scores;
