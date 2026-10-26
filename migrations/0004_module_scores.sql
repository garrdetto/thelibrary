CREATE TABLE IF NOT EXISTS module_scores (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  module TEXT NOT NULL,
  value INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS module_scores_module_value_idx ON module_scores (module, value);
CREATE INDEX IF NOT EXISTS module_scores_user_idx ON module_scores (module, user_id);
