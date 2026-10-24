-- 使用者與學習資料
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER PRIMARY KEY,
  srs TEXT NOT NULL DEFAULT '{}',
  day_done TEXT NOT NULL DEFAULT '{}',
  cur_day INTEGER NOT NULL DEFAULT 1,
  part_stats TEXT NOT NULL DEFAULT '{}',
  exams TEXT NOT NULL DEFAULT '[]',
  wrong TEXT NOT NULL DEFAULT '{}',
  streak TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  admin_reply TEXT,
  replied_at TEXT,
  replied_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);
