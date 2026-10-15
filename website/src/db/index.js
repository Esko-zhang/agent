'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/** Create any missing tables. Safe to run repeatedly. */
function migrate() {
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
}

// Run before anything else: the lib modules prepare their statements at import
// time, which fails if the tables are not there yet (e.g. a brand-new install).
migrate();

module.exports = { db, migrate };
