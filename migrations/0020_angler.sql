CREATE TABLE IF NOT EXISTS angler_profiles (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS angler_sessions (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS angler_catches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  lake TEXT NOT NULL,
  spot TEXT NOT NULL,
  species TEXT NOT NULL,
  weight INTEGER NOT NULL,
  length INTEGER NOT NULL,
  tier TEXT NOT NULL,
  landed INTEGER NOT NULL,
  rig TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS angler_catches_species_weight_idx ON angler_catches (species, landed, weight DESC);
CREATE INDEX IF NOT EXISTS angler_catches_user_idx ON angler_catches (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS angler_catches_lake_species_idx ON angler_catches (lake, species, landed, weight DESC);
