CREATE TABLE IF NOT EXISTS takeflight_standings (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  xp INTEGER NOT NULL,
  rating REAL,
  seconds REAL NOT NULL,
  airline TEXT,
  airline_earned INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS takeflight_standings_xp ON takeflight_standings (xp);
CREATE INDEX IF NOT EXISTS takeflight_standings_airline ON takeflight_standings (airline, airline_earned);

CREATE TABLE IF NOT EXISTS takeflight_flights (
  user_id TEXT NOT NULL,
  flight TEXT NOT NULL,
  username TEXT NOT NULL,
  aircraft TEXT NOT NULL,
  airport TEXT NOT NULL,
  landing_airport TEXT,
  total REAL NOT NULL,
  landing_score REAL,
  landing_sink REAL,
  seconds REAL NOT NULL,
  week INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, flight)
);
CREATE INDEX IF NOT EXISTS takeflight_flights_week ON takeflight_flights (week, total);
CREATE INDEX IF NOT EXISTS takeflight_flights_landing ON takeflight_flights (landing_airport, landing_score);
CREATE INDEX IF NOT EXISTS takeflight_flights_user ON takeflight_flights (user_id, updated_at);

CREATE TABLE IF NOT EXISTS takeflight_rate (
  key TEXT PRIMARY KEY,
  bucket INTEGER NOT NULL,
  count INTEGER NOT NULL
);
