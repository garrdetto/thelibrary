CREATE TABLE IF NOT EXISTS park_scores (
  user_id TEXT NOT NULL,
  scenario TEXT NOT NULL,
  username TEXT NOT NULL,
  value INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, scenario)
);
CREATE INDEX IF NOT EXISTS park_scores_scenario_value_idx ON park_scores (scenario, value);
