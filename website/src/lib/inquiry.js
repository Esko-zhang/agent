'use strict';
const { db } = require('../db');
const { serialize, deserialize } = require('./session');
const config = require('../config');

const COOKIE_NAME = 'durlevel_rfq';
const MAX_ITEMS = 50;

/**
 * The inquiry basket lives in a signed cookie rather than a table: it is
 * short-lived, per-browser, and must survive without a round trip on every
 * product page. Signing keeps a visitor from injecting arbitrary ids.
 */
function readBasket(req) {
  const data = deserialize(req.cookies?.[COOKIE_NAME]);
  const ids = Array.isArray(data?.ids) ? data.ids : [];
  return ids.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, MAX_ITEMS);
}

function writeBasket(res, ids) {
  const unique = [...new Set(ids)].slice(0, MAX_ITEMS);
  if (!unique.length) return clearBasket(res);
  // The basket is a convenience, not a session: a week is plenty.
  const payload = { ids: unique, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 };
  res.cookie(COOKIE_NAME, serialize(payload), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
  return unique;
}

function clearBasket(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
  });
  return [];
}

const q = {
  insert: db.prepare(
    `INSERT INTO inquiries (user_id, username, company, contact_name, email, phone,
                            country, message, ip)
     VALUES (@user_id, @username, @company, @contact_name, @email, @phone,
             @country, @message, @ip)`
  ),
  insertItem: db.prepare(
    `INSERT INTO inquiry_items (inquiry_id, product_id, name_en, category, quantity, note)
     VALUES (@inquiry_id, @product_id, @name_en, @category, @quantity, @note)`
  ),
  byId: db.prepare('SELECT * FROM inquiries WHERE id = ?'),
  items: db.prepare('SELECT * FROM inquiry_items WHERE inquiry_id = ? ORDER BY id'),
  setStatus: db.prepare(
    "UPDATE inquiries SET status = @status, assigned_to = @assigned_to, admin_note = @admin_note," +
      " updated_at = datetime('now') WHERE id = @id"
  ),
  remove: db.prepare('DELETE FROM inquiries WHERE id = ?'),
  countByStatus: db.prepare('SELECT status, COUNT(*) AS n FROM inquiries GROUP BY status'),
  newCount: db.prepare("SELECT COUNT(*) AS n FROM inquiries WHERE status = 'new'"),
};

/**
 * The same account's most recent inquiry, if it landed within `seconds`.
 *
 * A double-click, or a back-then-resubmit, sends the basket cookie twice
 * before the response that clears it has been applied — two identical
 * inquiries, two notification mails, and a rep following up on both.
 */
const recentByUser = db.prepare(
  `SELECT * FROM inquiries
   WHERE user_id = ? AND created_at >= datetime('now', ?)
   ORDER BY id DESC LIMIT 1`
);

function recentDuplicate(userId, fingerprint, seconds = 90) {
  if (!userId) return null;
  const row = recentByUser.get(userId, `-${Math.max(1, seconds)} seconds`);
  if (!row) return null;
  return fingerprintOf(row, q.items.all(row.id)) === fingerprint ? row : null;
}

/** What makes two submissions "the same one twice": who, what, and the note. */
function fingerprintOf(header, items) {
  return JSON.stringify([
    String(header.email || '').toLowerCase(),
    String(header.company || ''),
    String(header.message || ''),
    items
      .map((i) => `${i.product_id}|${i.quantity || ''}|${i.note || ''}`)
      .sort(),
  ]);
}

/** Writes the inquiry and its lines in one transaction. */
const create = db.transaction((header, items) => {
  const info = q.insert.run(header);
  const id = info.lastInsertRowid;
  for (const it of items) q.insertItem.run({ ...it, inquiry_id: id });
  return id;
});

/**
 * `usernames` scopes the inbox to one sales account's own customers. null
 * means no scoping (an administrator); an empty array means "nothing", which
 * is correct for a rep with no customers yet.
 */
function list({ status = '', q: term = '', usernames = null } = {}, { limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (usernames) {
    if (!usernames.length) return { rows: [], total: 0 };
    where.push(`username IN (${usernames.map(() => '?').join(',')}) COLLATE NOCASE`);
    params.push(...usernames);
  }
  if (status && ['new', 'handled', 'closed'].includes(status)) {
    where.push('status = ?');
    params.push(status);
  }
  if (term) {
    const like = '%' + String(term).replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    where.push(
      "(username LIKE ? ESCAPE '\\' OR company LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\'" +
        " OR contact_name LIKE ? ESCAPE '\\')"
    );
    params.push(like, like, like, like);
  }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db
    .prepare(
      `SELECT i.*, (SELECT COUNT(*) FROM inquiry_items t WHERE t.inquiry_id = i.id) AS item_count
       FROM inquiries i ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM inquiries ${clause}`).get(...params).n;
  return { rows, total };
}

module.exports = {
  recentDuplicate,
  fingerprintOf,
  COOKIE_NAME,
  MAX_ITEMS,
  readBasket,
  writeBasket,
  clearBasket,
  q,
  create,
  list,
};
