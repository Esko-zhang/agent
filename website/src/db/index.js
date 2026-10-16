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

/** Create any missing tables, then apply schema changes. Safe to run repeatedly. */
function migrate() {
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  migrateUserRoles();
}

// Run before anything else: the lib modules prepare their statements at import
// time, which fails if the tables are not there yet (e.g. a brand-new install).
migrate();

module.exports = { db, migrate };
