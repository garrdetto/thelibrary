CREATE TABLE IF NOT EXISTS hood_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  street INTEGER NOT NULL,
  lot INTEGER NOT NULL,
  kind TEXT NOT NULL,
  by_name TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hood_requests_street_at ON hood_requests (street, at);
