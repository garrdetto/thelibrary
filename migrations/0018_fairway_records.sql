CREATE TABLE IF NOT EXISTS fairway_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  board TEXT NOT NULL CHECK(board IN ('round','pin','match')),
  value INTEGER NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS fairway_records_board_value_idx ON fairway_records (board, value);
CREATE INDEX IF NOT EXISTS fairway_records_board_user_idx ON fairway_records (board, user_id);
