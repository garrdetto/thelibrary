CREATE TABLE IF NOT EXISTS shorttrack_paint_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS shorttrack_paint_requests_user_at ON shorttrack_paint_requests (user_id, at);
