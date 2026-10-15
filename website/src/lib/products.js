'use strict';
const { db } = require('../db');
const { CATEGORY_KEYS, ALL_PRODUCT_FIELDS } = require('../config');

const q = {
  byId: db.prepare('SELECT * FROM products WHERE id = ?'),
  listAll: db.prepare(
    'SELECT * FROM products ORDER BY category, sort_order, id'
  ),
  listByCategoryAdmin: db.prepare(
    'SELECT * FROM products WHERE category = ? ORDER BY sort_order, id'
  ),
  insert: db.prepare(
    `INSERT INTO products (category, name_en, image_path, dosage_form, spec, tags,
                           content, ratio, cas_no, remark, sort_order, is_active)
     VALUES (@category, @name_en, @image_path, @dosage_form, @spec, @tags,
             @content, @ratio, @cas_no, @remark, @sort_order, @is_active)`
  ),
  update: db.prepare(
    `UPDATE products SET category = @category, name_en = @name_en, image_path = @image_path,
            dosage_form = @dosage_form, spec = @spec, tags = @tags, content = @content,
            ratio = @ratio, cas_no = @cas_no, remark = @remark, sort_order = @sort_order,
            is_active = @is_active, updated_at = datetime('now')
     WHERE id = @id`
  ),
  remove: db.prepare('DELETE FROM products WHERE id = ?'),
  countByCategory: db.prepare('SELECT category, COUNT(*) AS n FROM products GROUP BY category'),
  maxSort: db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM products WHERE category = ?'),
};

/** Columns the free-text search box looks at. */
const SEARCHABLE = ['name_en', ...ALL_PRODUCT_FIELDS];

/**
 * Public listing: active products of one category, optionally filtered by a
 * search term matched against the name and every attribute column.
 */
function publicList(category, search) {
  const params = [category];
  let sql = 'SELECT * FROM products WHERE category = ? AND is_active = 1';
  const term = String(search || '').trim();
  if (term) {
    const like = '%' + term.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    sql += ' AND (' + SEARCHABLE.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ') + ')';
    params.push(...SEARCHABLE.map(() => like));
  }
  sql += ' ORDER BY sort_order, id';
  return db.prepare(sql).all(...params);
}

/** Normalises a submitted admin form into a row for insert/update. */
function fromForm(body) {
  const category = CATEGORY_KEYS.includes(body.category) ? body.category : CATEGORY_KEYS[0];
  const row = {
    category,
    name_en: String(body.name_en || '').trim(),
    sort_order: Number.parseInt(body.sort_order, 10) || 0,
    is_active: body.is_active ? 1 : 0,
  };
  for (const f of ALL_PRODUCT_FIELDS) row[f] = String(body[f] || '').trim();
  return row;
}

function nextSortOrder(category) {
  return q.maxSort.get(category).m + 10;
}

module.exports = { q, publicList, fromForm, nextSortOrder, SEARCHABLE };
