'use strict';
const { db } = require('../db');
const { ALL_PRODUCT_FIELDS } = require('../config');

/**
 * Product categories, as rows rather than as code.
 *
 * The catalogue launched with three fixed categories compiled into the app,
 * which meant adding a fourth needed a deploy. They are now a table an
 * administrator edits in 品类管理: add, rename, reorder, hide, remove.
 *
 * Two things deliberately stay fixed:
 *   - `key`, the slug products store and the public page uses as its anchor.
 *     Renaming a category changes its labels, never its key, so existing
 *     products keep pointing at it and old links keep working.
 *   - the palette of attribute columns (剂型 / 规格 / 含量 / 比例 / CAS号 …),
 *     which are real columns on `products`. A category chooses which of them
 *     to show; inventing a brand-new attribute still needs a migration.
 */

const q = {
  all: db.prepare('SELECT * FROM categories ORDER BY sort_order, id'),
  active: db.prepare('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order, id'),
  byId: db.prepare('SELECT * FROM categories WHERE id = ?'),
  byKey: db.prepare('SELECT * FROM categories WHERE key = ?'),
  insert: db.prepare(
    `INSERT INTO categories (key, zh, en, title, fields, sort_order, is_active)
     VALUES (@key, @zh, @en, @title, @fields, @sort_order, @is_active)`
  ),
  update: db.prepare(
    `UPDATE categories SET zh = @zh, en = @en, title = @title, fields = @fields,
            sort_order = @sort_order, is_active = @is_active
     WHERE id = @id`
  ),
  remove: db.prepare('DELETE FROM categories WHERE id = ?'),
  maxSort: db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories'),
  countProducts: db.prepare('SELECT COUNT(*) AS n FROM products WHERE category = ?'),
};

/** Turns a stored row into what the routes and views expect. */
function shape(row) {
  if (!row) return null;
  const fields = String(row.fields || '')
    .split(',')
    .map((f) => f.trim())
    .filter((f) => ALL_PRODUCT_FIELDS.includes(f));
  return {
    ...row,
    fields,
    // The anchor the public page links to, kept equal to the key.
    anchor: row.key,
    // The heading above the section; falls back to the English name.
    title: row.title || row.en,
    is_active: !!row.is_active,
  };
}

const all = () => q.all.all().map(shape);
const active = () => q.active.all().map(shape);
const byKey = (key) => shape(q.byKey.get(String(key || '')));
const byId = (id) => shape(q.byId.get(id));
const keys = () => q.all.all().map((r) => r.key);
const activeKeys = () => q.active.all().map((r) => r.key);
const countProducts = (key) => q.countProducts.get(String(key || '')).n;

/** Chinese name for a key, for the change log and flash messages. */
function nameOf(key) {
  const row = q.byKey.get(String(key || ''));
  return row ? row.zh : String(key || '');
}

/**
 * A key has to survive in URLs, anchors and a WHERE clause, so it is reduced
 * to lowercase ASCII. A Chinese-only name leaves nothing behind, in which case
 * the caller is asked for a key explicitly rather than given a random one.
 */
function slugify(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

/** Normalises the admin form into a row. */
function fromForm(body, { existing = null } = {}) {
  const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const picked = ALL_PRODUCT_FIELDS.filter((f) => {
    const v = body['field_' + f];
    return Array.isArray(v) ? v.length : !!v;
  });
  return {
    key: existing ? existing.key : slugify(body.key || body.en || body.zh),
    zh: text(body.zh, 40),
    en: text(body.en, 60),
    title: text(body.title, 150),
    fields: picked.join(','),
    sort_order: Number.parseInt(body.sort_order, 10) || 0,
    is_active: body.is_active ? 1 : 0,
  };
}

/** A message when the row cannot be stored, else null. */
function validate(row, { existing = null } = {}) {
  if (!row.zh) return '请填写品类名称（中文）。';
  if (!row.en) return '请填写前台英文名称。';
  if (!existing) {
    if (!row.key) {
      return '无法从名称生成英文标识，请手动填写「英文标识」（只能用小写字母、数字和连字符）。';
    }
    if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(row.key)) {
      return '英文标识只能用小写字母、数字和连字符，且至少 2 位。';
    }
    if (q.byKey.get(row.key)) return `英文标识「${row.key}」已被占用，请换一个。`;
  }
  if (!row.fields) return '请至少勾选一个要显示的属性列。';
  return null;
}

function nextSortOrder() {
  return q.maxSort.get().m + 1;
}

const create = (row) => q.insert.run(row);
const update = (id, row) => q.update.run({ ...row, id });
const remove = (id) => q.remove.run(id);

module.exports = {
  q,
  all,
  active,
  byKey,
  byId,
  keys,
  activeKeys,
  countProducts,
  nameOf,
  slugify,
  fromForm,
  validate,
  nextSortOrder,
  create,
  update,
  remove,
};
