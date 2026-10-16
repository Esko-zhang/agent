'use strict';
const express = require('express');
const config = require('../../config');
const categories = require('../../lib/categories');
const productlog = require('../../lib/productlog');
const roles = require('../../lib/roles');

/**
 * 品类管理 — administrators only.
 *
 * A category decides how a whole section of the public catalogue is labelled
 * and which spec columns it shows, so it is not something one rep changes for
 * their own convenience. Deleting one is refused while products still point at
 * it: the products would vanish from the public page with nothing to say why.
 */
const router = express.Router();

router.use((req, res, next) => {
  if (!roles.isAdmin(req.user)) {
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: '只有管理员可以管理产品品类。',
    });
  }
  return next();
});

function view(req, res, status, error, draft = null) {
  const rows = categories.all().map((c) => ({ ...c, productCount: categories.countProducts(c.key) }));
  return res.status(status).render('admin/categories', {
    nav: 'categories',
    rows,
    error,
    draft,
    fieldLabels: config.FIELD_LABELS,
    allFields: config.ALL_PRODUCT_FIELDS,
    nextSort: categories.nextSortOrder(),
  });
}

router.get('/', (req, res) => view(req, res, 200, null));

router.post('/', (req, res) => {
  const row = categories.fromForm(req.body);
  const problem = categories.validate(row);
  if (problem) return view(req, res, 400, problem, req.body);

  categories.create(row);
  productlog.record(req, {
    action: 'category',
    category: row.key,
    note: `新增品类「${row.zh}」（标识 ${row.key}）`,
  });
  res.redirect('/admin/categories?ok=' + encodeURIComponent(`已新增品类「${row.zh}」`));
});

router.post('/:id', (req, res, next) => {
  const existing = categories.byId(req.params.id);
  if (!existing) return next();

  const row = categories.fromForm(req.body, { existing });
  const problem = categories.validate(row, { existing });
  if (problem) return view(req, res, 400, problem);

  categories.update(existing.id, row);

  // Only say what actually changed — a save that changed nothing is noise.
  const changed = [];
  if (existing.zh !== row.zh) changed.push(`名称：${existing.zh} → ${row.zh}`);
  if (existing.en !== row.en) changed.push(`英文名：${existing.en} → ${row.en}`);
  if ((existing.title || '') !== row.title) changed.push('前台标题');
  if (existing.fields.join(',') !== row.fields) changed.push('显示字段');
  if (existing.sort_order !== row.sort_order) changed.push(`排序：${existing.sort_order} → ${row.sort_order}`);
  if (existing.is_active !== !!row.is_active) changed.push(row.is_active ? '改为显示' : '改为隐藏');
  if (changed.length) {
    productlog.record(req, {
      action: 'category',
      category: existing.key,
      note: `修改品类「${row.zh}」：${changed.join('；')}`,
    });
  }
  res.redirect('/admin/categories?ok=' + encodeURIComponent(`已保存品类「${row.zh}」`));
});

router.post('/:id/delete', (req, res, next) => {
  const existing = categories.byId(req.params.id);
  if (!existing) return next();

  const n = categories.countProducts(existing.key);
  if (n) {
    return view(
      req,
      res,
      400,
      `「${existing.zh}」下还有 ${n} 个产品，不能删除。` +
        '请先在「产品管理」里把这些产品改到别的品类，或删除它们；' +
        '只是暂时不想展示的话，把这个品类改成「隐藏」即可。'
    );
  }

  categories.remove(existing.id);
  productlog.record(req, {
    action: 'category',
    category: existing.key,
    note: `删除品类「${existing.zh}」（标识 ${existing.key}）`,
  });
  res.redirect('/admin/categories?ok=' + encodeURIComponent(`已删除品类「${existing.zh}」`));
});

module.exports = router;
