CREATE TABLE IF NOT EXISTS bushleague_ratings (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 1200,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bushleague_ratings_rating_idx ON bushleague_ratings (rating DESC);
CREATE TABLE IF NOT EXISTS bushleague_matches (
  id TEXT PRIMARY KEY,
  away_user TEXT,
  home_user TEXT,
  away_team TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_score INTEGER NOT NULL,
  home_score INTEGER NOT NULL,
  winner_side INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ranked INTEGER NOT NULL,
  innings INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bushleague_matches_created_idx ON bushleague_matches (created_at);
