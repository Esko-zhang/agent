'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * SQLite cannot alter a CHECK constraint in place, so widening the role list
 * means rebuilding the table. Nothing references users with a foreign key, so
 * a straight copy is safe. Runs only on databases created before the sales
 * role existed.
 */
function migrateUserRoles() {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get();
  if (!row || row.sql.includes("'sales'")) return;

  console.log('[db] widening users.role to allow the sales role…');
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE users_migrating (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT    NOT NULL UNIQUE,
        password_hash TEXT    NOT NULL,
        display_name  TEXT    NOT NULL DEFAULT '',
        role          TEXT    NOT NULL DEFAULT 'user'
                              CHECK (role IN ('admin', 'sales', 'user')),
        is_active     INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        last_login_at TEXT
      );
      INSERT INTO users_migrating
        (id, username, password_hash, display_name, role, is_active, created_at, last_login_at)
        SELECT id, username, password_hash, display_name, role, is_active, created_at, last_login_at
        FROM users;
      DROP TABLE users;
      ALTER TABLE users_migrating RENAME TO users;
    `);
  })();
  db.pragma('foreign_keys = ON');
  console.log('[db] done.');
}

/**
 * Older installs have products.category pinned to the original three keys by a
 * CHECK constraint. SQLite cannot drop one in place, so the table is rebuilt —
 * the same dance as migrateUserRoles, and equally safe because the rows and
 * their ids are copied across unchanged.
 */
function migrateProductCategories() {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'products'")
    .get();
  if (!row || !row.sql.includes('CHECK (category IN')) return;

  console.log('[db] freeing products.category from the fixed three-category list…');
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE products_migrating (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        category    TEXT    NOT NULL,
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
      INSERT INTO products_migrating
        SELECT id, category, name_en, image_path, dosage_form, spec, tags, content,
               ratio, cas_no, remark, sort_order, is_active, created_at, updated_at
        FROM products;
      DROP TABLE products;
      ALTER TABLE products_migrating RENAME TO products;
      CREATE INDEX IF NOT EXISTS idx_products_category
        ON products (category, is_active, sort_order, id);
    `);
  })();
  db.pragma('foreign_keys = ON');
  console.log('[db] done.');
}

/**
 * First run after the upgrade: the categories table is empty, so it is filled
 * from the three that used to be hardcoded — including whatever section titles
 * the admin had already set, which used to live in `settings`.
 */
function seedCategories() {
  if (db.prepare('SELECT COUNT(*) AS n FROM categories').get().n) return;
  const stored = Object.fromEntries(
    db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value])
  );
  const insert = db.prepare(
    `INSERT INTO categories (key, zh, en, title, fields, sort_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`
  );
  config.CATEGORY_SEED.forEach((c, i) => {
    insert.run(
      c.key,
      c.zh,
      c.en,
      stored[c.settingKey] || c.defaultTitle,
      c.fields.join(','),
      (i + 1) * 1
    );
  });
  console.log(`[db] seeded ${config.CATEGORY_SEED.length} product categories.`);
}

/** Adds a column to an existing table when it is not there yet. */
function addColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  console.log(`[db] adding ${table}.${column}…`);
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/** Create any missing tables, then apply schema changes. Safe to run repeatedly. */
function migrate() {
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  migrateUserRoles();
  migrateProductCategories();
  seedCategories();

  // Country of the visitor's IP, resolved once at write time so history stays
  // put even if the lookup table is updated later.
  addColumn('access_log', 'country', "TEXT NOT NULL DEFAULT ''");

  // Who issued this account, and which contact card a sales account belongs to.
  addColumn('users', 'created_by', 'INTEGER');
  addColumn('users', 'created_by_name', "TEXT NOT NULL DEFAULT ''");
  addColumn('users', 'staff_id', 'INTEGER');

  // Contact details for the 联系方式汇总 directory.
  for (const col of ['company', 'email', 'phone', 'whatsapp', 'country']) {
    addColumn('users', col, "TEXT NOT NULL DEFAULT ''");
  }
}

// Run before anything else: the lib modules prepare their statements at import
// time, which fails if the tables are not there yet (e.g. a brand-new install).
migrate();

module.exports = { db, migrate };
