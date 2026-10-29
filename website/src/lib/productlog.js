'use strict';
const { db } = require('../db');
const config = require('../config');

/**
 * 产品变更记录 — who changed which product, when, and what exactly changed.
 *
 * It exists because the catalogue is now edited by more than one person: a
 * sales account can draft and edit products, an administrator reviews and
 * publishes them. When a spec looks wrong three weeks later, the question is
 * always "who changed this, and what did it say before" — so every write
 * records a field-level diff, and the record outlives the product it
 * describes.
 *
 * Reading it is administrators only (see SECTIONS in lib/roles.js).
 */

const ACTIONS = [
  { key: 'create', zh: '新增产品' },
  { key: 'update', zh: '修改产品' },
  { key: 'publish', zh: '上架' },
  { key: 'unpublish', zh: '下架' },
  { key: 'delete', zh: '删除产品' },
  { key: 'import', zh: '批量导入' },
  { key: 'reorder', zh: '重新编号' },
  { key: 'category', zh: '品类变更' },
  { key: 'doc_add', zh: '上传文档' },
  { key: 'doc_remove', zh: '删除文档' },
];
const ACTION_KEYS = ACTIONS.map((a) => a.key);
const ACTION_LABELS = Object.fromEntries(ACTIONS.map((a) => [a.key, a.zh]));

/** Columns worth reporting a change on, in the order they read best. */
const TRACKED = [
  { field: 'name_en', label: '产品英文名字' },
  { field: 'name_zh', label: '中文品名' },
  { field: 'category', label: '所属分类' },
  ...Object.entries(config.FIELD_LABELS).map(([field, l]) => ({ field, label: l.zh })),
  { field: 'sort_order', label: '排序值' },
  { field: 'image_path', label: '产品图片' },
  { field: 'is_active', label: '上架状态' },
];

const categories = require('./categories');

const q = {
  insert: db.prepare(
    `INSERT INTO product_changes (product_id, product_name, category, action,
                                  actor_id, actor_name, actor_role, summary, detail)
     VALUES (@product_id, @product_name, @category, @action,
             @actor_id, @actor_name, @actor_role, @summary, @detail)`
  ),
  forProduct: db.prepare(
    `SELECT * FROM product_changes WHERE product_id = ?
     ORDER BY occurred_at DESC, id DESC LIMIT ?`
  ),
  // Products a sales account touched that are still unpublished: the admin's
  // review queue.
  pendingReview: db.prepare(
    `SELECT COUNT(*) AS n FROM products p
     WHERE p.is_active = 0 AND EXISTS (
       SELECT 1 FROM product_changes c
       WHERE c.product_id = p.id AND c.actor_role = 'sales'
     )`
  ),
  actors: db.prepare(
    `SELECT actor_name AS name, actor_role AS role, COUNT(*) AS n
     FROM product_changes WHERE actor_name <> ''
     GROUP BY actor_name, actor_role ORDER BY n DESC, name`
  ),
  names: db.prepare(
    `SELECT product_name AS name, COUNT(*) AS n FROM product_changes
     WHERE product_name <> '' GROUP BY product_name ORDER BY name COLLATE NOCASE`
  ),
};

/** Renders a stored value the way the log should read it. */
function show(field, value) {
  if (field === 'is_active') return value ? '上架' : '下架';
  if (field === 'category') return value ? categories.nameOf(value) : '（空）';
  const v = value == null ? '' : String(value);
  if (!v) return '（空）';
  return v.length > 60 ? v.slice(0, 60) + '…' : v;
}

/**
 * Field-level differences between two product rows. Only the tracked columns
 * are compared, and both sides are normalised to strings first so that 0 and
 * '0' are not reported as a change.
 */
function diff(before, after) {
  const out = [];
  if (!before || !after) return out;
  for (const { field, label } of TRACKED) {
    const a = before[field] == null ? '' : String(before[field]);
    const b = after[field] == null ? '' : String(after[field]);
    if (a === b) continue;
    out.push({ field, label, from: show(field, before[field]), to: show(field, after[field]) });
  }
  return out;
}

function summarise(action, changes) {
  if (action === 'update') {
    if (!changes.length) return '没有字段变化';
    const head = changes.slice(0, 3).map((c) => `${c.label}：${c.from} → ${c.to}`);
    return head.join('；') + (changes.length > 3 ? ` 等 ${changes.length} 项` : '');
  }
  return ACTION_LABELS[action] || action;
}

/**
 * Records one change. `before`/`after` are product rows; pass only `after` for
 * a create, only `before` for a delete. `note` replaces the generated summary,
 * which is what the document actions use.
 */
function record(req, { action, product, before = null, after = null, note = '', category = '' }) {
  const actor = req?.user || null;
  const row = product || after || before || { category };
  const changes = action === 'update' ? diff(before, after) : [];
  q.insert.run({
    product_id: row.id || null,
    product_name: row.name_en || '',
    category: row.category || '',
    action,
    actor_id: actor ? actor.id : null,
    actor_name: actor ? actor.display_name || actor.username : '',
    actor_role: actor ? actor.role : '',
    summary: note || summarise(action, changes),
    detail: changes.length ? JSON.stringify(changes) : '',
  });
  return changes;
}

/** An update worth recording: skips the no-op save that changed nothing. */
function recordUpdate(req, before, after) {
  const changes = diff(before, after);
  if (!changes.length) return [];
  // 上架 / 下架 on its own reads better as its own action than as a diff line.
  if (changes.length === 1 && changes[0].field === 'is_active') {
    record(req, {
      action: after.is_active ? 'publish' : 'unpublish',
      product: after,
    });
    return changes;
  }
  record(req, { action: 'update', product: after, before, after });
  return changes;
}

function buildFilter(filter = {}) {
  const where = [];
  const params = [];
  if (filter.product) {
    where.push('product_name = ?');
    params.push(filter.product);
  }
  if (filter.actor) {
    where.push('actor_name = ?');
    params.push(filter.actor);
  }
  if (filter.action && ACTION_KEYS.includes(filter.action)) {
    where.push('action = ?');
    params.push(filter.action);
  }
  // Dates are the viewer's local day, so the window is shifted by their offset
  // before being compared against the UTC column.
  const off = Number(filter.tzOffsetMinutes) || 0;
  if (filter.from) {
    where.push("occurred_at >= datetime(?, ?)");
    params.push(filter.from + ' 00:00:00', `${-off} minutes`);
  }
  if (filter.to) {
    where.push("occurred_at < datetime(?, ?, '+1 day')");
    params.push(filter.to + ' 00:00:00', `${-off} minutes`);
  }
  if (filter.q) {
    const like = '%' + String(filter.q).replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    where.push(
      "(product_name LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\'" +
        " OR actor_name LIKE ? ESCAPE '\\')"
    );
    params.push(like, like, like);
  }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

function list(filter, { limit = 50, offset = 0 } = {}) {
  const { sql, params } = buildFilter(filter);
  return db
    .prepare(
      `SELECT * FROM product_changes ${sql} ORDER BY occurred_at DESC, id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);
}

function count(filter) {
  const { sql, params } = buildFilter(filter);
  return db.prepare(`SELECT COUNT(*) AS n FROM product_changes ${sql}`).get(...params).n;
}

function listAll(filter, cap = 20000) {
  const { sql, params } = buildFilter(filter);
  return db
    .prepare(`SELECT * FROM product_changes ${sql} ORDER BY occurred_at DESC, id DESC LIMIT ?`)
    .all(...params, cap);
}

/** Headline numbers for the page, over the whole history. */
function stats() {
  const since = "datetime('now', '-7 days')";
  const one = (sql, ...p) => db.prepare(sql).get(...p).n;
  return {
    total: one('SELECT COUNT(*) AS n FROM product_changes'),
    week: one(`SELECT COUNT(*) AS n FROM product_changes WHERE occurred_at >= ${since}`),
    bySales: one(
      `SELECT COUNT(*) AS n FROM product_changes WHERE actor_role = 'sales' AND occurred_at >= ${since}`
    ),
    pending: q.pendingReview.get().n,
  };
}

function parseDetail(json) {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

module.exports = {
  ACTIONS,
  ACTION_KEYS,
  ACTION_LABELS,
  q,
  diff,
  record,
  recordUpdate,
  list,
  listAll,
  count,
  stats,
  parseDetail,
  pendingReview: () => q.pendingReview.get().n,
  forProduct: (id, limit = 10) => q.forProduct.all(id, limit),
};
