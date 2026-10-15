PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  display_name  TEXT    NOT NULL DEFAULT '',
  role          TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT    NOT NULL CHECK (category IN ('oem', 'extract', 'additive')),
  name_en     TEXT    NOT NULL,
  image_path  TEXT,
  dosage_form TEXT    NOT NULL DEFAULT '',
  spec        TEXT    NOT NULL DEFAULT '',
  tags        TEXT    NOT NULL DEFAULT '',
  content     TEXT    NOT NULL DEFAULT '',
  ratio       TEXT    NOT NULL DEFAULT '',
  cas_no      TEXT    NOT NULL DEFAULT '',
  remark      TEXT    NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_category
  ON products (category, is_active, sort_order, id);

CREATE TABLE IF NOT EXISTS staff (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  title      TEXT    NOT NULL DEFAULT '',
  photo_path TEXT,
  phone      TEXT    NOT NULL DEFAULT '',
  whatsapp   TEXT    NOT NULL DEFAULT '',
  email      TEXT    NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_staff_active ON staff (is_active, sort_order, id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- Who reached the site, from which IP, and when. Logins (success and failure)
-- are always recorded; page views are recorded for signed-in visitors.
CREATE TABLE IF NOT EXISTS access_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT    NOT NULL DEFAULT (datetime('now')),   -- UTC
  user_id     INTEGER,                                      -- NULL for a failed login
  username    TEXT    NOT NULL DEFAULT '',                  -- copied in, survives account deletion
  role        TEXT    NOT NULL DEFAULT '',
  event       TEXT    NOT NULL,                             -- see EVENTS in src/lib/accesslog.js
  path        TEXT    NOT NULL DEFAULT '',
  ip          TEXT    NOT NULL DEFAULT '',
  user_agent  TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_access_log_time ON access_log (occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_access_log_user ON access_log (username, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_log_event ON access_log (event, occurred_at DESC);
