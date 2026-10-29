'use strict';
const { db } = require('../db');
const { ALL_PRODUCT_FIELDS } = require('../config');
const categories = require('./categories');

const q = {
  byId: db.prepare('SELECT * FROM products WHERE id = ?'),
  listAll: db.prepare(
    'SELECT * FROM products ORDER BY category, sort_order, id'
  ),
  listByCategoryAdmin: db.prepare(
    'SELECT * FROM products WHERE category = ? ORDER BY sort_order, id'
  ),
  insert: db.prepare(
    `INSERT INTO products (category, name_en, name_zh, image_path, dosage_form, spec, tags,
                           content, ratio, cas_no, remark, sort_order, is_active)
     VALUES (@category, @name_en, @name_zh, @image_path, @dosage_form, @spec, @tags,
             @content, @ratio, @cas_no, @remark, @sort_order, @is_active)`
  ),
  update: db.prepare(
    `UPDATE products SET category = @category, name_en = @name_en, name_zh = @name_zh,
            image_path = @image_path,
            dosage_form = @dosage_form, spec = @spec, tags = @tags, content = @content,
            ratio = @ratio, cas_no = @cas_no, remark = @remark, sort_order = @sort_order,
            is_active = @is_active, updated_at = datetime('now')
     WHERE id = @id`
  ),
  remove: db.prepare('DELETE FROM products WHERE id = ?'),
  countByCategory: db.prepare('SELECT category, COUNT(*) AS n FROM products GROUP BY category'),
  maxSort: db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM products WHERE category = ?'),
};

/** Columns the catalogue's search box looks at. */
const SEARCHABLE = ['name_en', ...ALL_PRODUCT_FIELDS];

/**
 * The admin list searches one column more: the Chinese name. It is the name
 * the team actually has in mind when hunting for a product, and it is theirs
 * alone — a buyer must not be able to probe for it through the catalogue
 * search, so it stays out of SEARCHABLE above.
 */
const ADMIN_SEARCHABLE = [...SEARCHABLE, 'name_zh'];

/**
 * The SQL and bindings for "any searchable column contains this term", or null
 * for an empty term. % and _ are the wildcards of LIKE and a backslash escapes
 * them, so a CAS number typed with an underscore matches that underscore
 * rather than any character. Shared so the catalogue and the admin list can
 * never drift into matching on different columns.
 */
function searchClause(search, columns = SEARCHABLE) {
  const term = String(search || '').trim();
  if (!term) return null;
  const like = '%' + term.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
  return {
    sql: '(' + columns.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ') + ')',
    params: columns.map(() => like),
    term,
  };
}

/**
 * Public listing: active products of one category, optionally filtered by a
 * search term matched against the name and every attribute column.
 */
function publicList(category, search) {
  const params = [category];
  let sql = 'SELECT * FROM products WHERE category = ? AND is_active = 1';
  const where = searchClause(search);
  if (where) {
    sql += ' AND ' + where.sql;
    params.push(...where.params);
  }
  sql += ' ORDER BY sort_order, id';
  return db.prepare(sql).all(...params);
}

/**
 * Admin listing: the same search over every product, published or not, since
 * an unpublished draft is exactly what someone is usually hunting for. With no
 * category it keeps the grouped order of q.listAll so the page reads the same
 * either way.
 */
function adminList(category, search) {
  const params = [];
  let sql = 'SELECT * FROM products';
  const clauses = [];
  if (category) { clauses.push('category = ?'); params.push(category); }
  const where = searchClause(search, ADMIN_SEARCHABLE);
  if (where) { clauses.push(where.sql); params.push(...where.params); }
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
  sql += category ? ' ORDER BY sort_order, id' : ' ORDER BY category, sort_order, id';
  return db.prepare(sql).all(...params);
}

/**
 * How many products the term matches outside the category being shown. The
 * list says so when it is not zero: searching inside one category and finding
 * nothing otherwise reads as "this product does not exist".
 */
function countOutsideCategory(category, search) {
  const where = searchClause(search, ADMIN_SEARCHABLE);
  if (!where || !category) return 0;
  return db
    .prepare(`SELECT COUNT(*) AS n FROM products WHERE category <> ? AND ${where.sql}`)
    .get(category, ...where.params).n;
}

/**
 * The date this catalogue last changed — the newest `updated_at` among the
 * published products, as a plain YYYY-MM-DD. It fills the revision cell of the
 * title block, which is the one piece of the page a returning buyer can use to
 * tell whether anything is new since they last looked.
 */
function lastPublishedAt() {
  const row = db
    .prepare("SELECT MAX(updated_at) AS t FROM products WHERE is_active = 1")
    .get();
  return row && row.t ? String(row.t).slice(0, 10) : '';
}

/**
 * The product occupying this category + English name, if any. `exceptId` lets
 * an edit ignore the row it is editing. Matched the same way the unique index
 * and the importer match, so all three agree on what "the same product" means.
 */
function findByIdentity(category, nameEn, exceptId = null) {
  const row = db
    .prepare(
      `SELECT * FROM products
       WHERE category = ? AND lower(trim(name_en)) = lower(trim(?))
         AND (? IS NULL OR id <> ?)
       LIMIT 1`
    )
    .get(category, String(nameEn || ''), exceptId, exceptId);
  return row || null;
}

/** Normalises a submitted admin form into a row for insert/update. */
function fromForm(body) {
  const known = categories.keys();
  // A product has to belong to a real category. The old fallback to '' wrote a
  // row nothing could render, and the admin list then threw on every visit.
  if (!known.length) {
    throw new Error('请先在「品类管理」里创建至少一个品类，然后再录入产品。');
  }
  const category = known.includes(body.category) ? body.category : known[0];
  const row = {
    category,
    name_en: String(body.name_en || '').trim(),
    name_zh: String(body.name_zh || '').trim(),
    sort_order: Number.parseInt(body.sort_order, 10) || 0,
    is_active: body.is_active ? 1 : 0,
  };
  for (const f of ALL_PRODUCT_FIELDS) row[f] = String(body[f] || '').trim();
  return row;
}

/**
 * A product and its entry in 产品变更记录 are one fact, so they are written
 * together. They used to be two statements in a row: a failure between them
 * (a full disk, a locked database) left a change with no record of it, or —
 * on delete, where the log was written first — a record of a deletion that
 * never happened.
 *
 * `log` is called inside the transaction and returns whatever the caller
 * wants back; better-sqlite3 turns the nested transaction into a savepoint.
 */
const saveWithLog = db.transaction((write, log) => {
  const result = write();
  log(result);
  return result;
});

/** The next number in a category: 1, 2, 3 … rather than 10, 20, 30. */
function nextSortOrder(category) {
  return q.maxSort.get(category).m + 1;
}

/**
 * Renumbers one category 1, 2, 3 … in the order it is displayed now, so a
 * catalogue that grew gaps (or came from the old step-of-10 numbering) reads
 * cleanly again. The display order itself does not change.
 */
const renumber = db.transaction((category) => {
  const rows = q.listByCategoryAdmin.all(category);
  const stmt = db.prepare('UPDATE products SET sort_order = ? WHERE id = ?');
  rows.forEach((p, i) => stmt.run(i + 1, p.id));
  return rows.length;
});

module.exports = {
  q, publicList, adminList, countOutsideCategory, saveWithLog, findByIdentity,
  lastPublishedAt, fromForm, nextSortOrder, renumber, SEARCHABLE, ADMIN_SEARCHABLE,
};
