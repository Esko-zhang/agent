PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  display_name  TEXT    NOT NULL DEFAULT '',
  -- admin: the whole backend, including creating sales accounts
  -- sales: inquiries, customer intent, and creating customer accounts
  -- user:  the catalogue only, no backend
  role          TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'sales', 'user')),
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

-- Spec sheets attached to a product (TDS / COA / MSDS). The files live outside
-- the public directory and are served only to signed-in visitors.
CREATE TABLE IF NOT EXISTS product_docs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label       TEXT    NOT NULL DEFAULT '',   -- TDS / COA / MSDS / …
  filename    TEXT    NOT NULL,              -- stored name, random
  original    TEXT    NOT NULL DEFAULT '',   -- name the admin uploaded
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_product_docs_product ON product_docs (product_id, id);

-- Quote requests raised from the catalogue.
CREATE TABLE IF NOT EXISTS inquiries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER,
  username      TEXT    NOT NULL DEFAULT '',
  company       TEXT    NOT NULL DEFAULT '',
  contact_name  TEXT    NOT NULL DEFAULT '',
  email         TEXT    NOT NULL DEFAULT '',
  phone         TEXT    NOT NULL DEFAULT '',
  country       TEXT    NOT NULL DEFAULT '',
  message       TEXT    NOT NULL DEFAULT '',
  status        TEXT    NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'handled', 'closed')),
  assigned_to   INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  admin_note    TEXT    NOT NULL DEFAULT '',
  ip            TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inquiries_user ON inquiries (username, created_at DESC);

-- One line per product on an inquiry. Product details are copied in so the
-- record still reads correctly after a product is renamed or removed.
CREATE TABLE IF NOT EXISTS inquiry_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_id  INTEGER NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  product_id  INTEGER,
  name_en     TEXT    NOT NULL DEFAULT '',
  category    TEXT    NOT NULL DEFAULT '',
  quantity    TEXT    NOT NULL DEFAULT '',
  note        TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_inquiry_items_inquiry ON inquiry_items (inquiry_id, id);
CREATE INDEX IF NOT EXISTS idx_inquiry_items_product ON inquiry_items (product_id);
