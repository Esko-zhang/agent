'use strict';
const express = require('express');
const productlog = require('../../lib/productlog');
const accesslog = require('../../lib/accesslog');
const settings = require('../../lib/settings');
const roles = require('../../lib/roles');

/**
 * 产品变更记录 — administrators only. The section table keeps sales out, and
 * this router refuses to render for anyone else even if it is ever remounted:
 * the whole point of the page is reviewing what the sales accounts changed.
 */
const router = express.Router();
const PER_PAGE = 50;
const EXPORT_CAP = 20000;

router.use((req, res, next) => {
  if (!roles.isAdmin(req.user)) {
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: '只有管理员可以查看产品变更记录。',
    });
  }
  return next();
});

function readFilter(query, tz) {
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  return {
    product: String(query.product || '').trim().slice(0, 200),
    actor: String(query.actor || '').trim().slice(0, 64),
    action: productlog.ACTION_KEYS.includes(query.action) ? query.action : '',
    q: String(query.q || '').trim().slice(0, 80),
    from: isDate(query.from) ? query.from : '',
    to: isDate(query.to) ? query.to : '',
    tzOffsetMinutes: accesslog.tzOffsetMinutes(tz),
  };
}

router.get('/', (req, res) => {
  const tz = settings.get('log_timezone') || 'UTC';
  const filter = readFilter(req.query, tz);

  const total = productlog.count(filter);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), pages);
  const rows = productlog.list(filter, { limit: PER_PAGE, offset: (page - 1) * PER_PAGE });

  res.render('admin/changes', {
    nav: 'changes',
    rows,
    total,
    page,
    pages,
    filter,
    tz,
    actions: productlog.ACTIONS,
    actionLabels: productlog.ACTION_LABELS,
    actors: productlog.q.actors.all(),
    names: productlog.q.names.all(),
    stats: productlog.stats(),
    roleLabels: roles.ROLE_LABELS,
    parseDetail: productlog.parseDetail,
    fmt: (t) => accesslog.formatTime(t, tz),
  });
});

/**
 * Spreadsheets treat a leading =, +, - or @ as a formula, so values are
 * prefixed with an apostrophe before being quoted.
 */
function csvCell(value) {
  let v = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
  return '"' + v.replace(/"/g, '""') + '"';
}

router.get('/export.csv', (req, res) => {
  const tz = settings.get('log_timezone') || 'UTC';
  const filter = readFilter(req.query, tz);
  const rows = productlog.listAll(filter, EXPORT_CAP);

  const header = ['时间 (' + tz + ')', '产品', '分类', '操作', '操作人', '角色', '说明', '字段明细'];
  const lines = [header.map(csvCell).join(',')];

  for (const r of rows) {
    const detail = productlog
      .parseDetail(r.detail)
      .map((d) => `${d.label}: ${d.from} → ${d.to}`)
      .join(' | ');
    lines.push(
      [
        accesslog.formatTime(r.occurred_at, tz),
        r.product_name,
        r.category,
        productlog.ACTION_LABELS[r.action] || r.action,
        r.actor_name,
        roles.ROLE_LABELS[r.actor_role] || r.actor_role,
        r.summary,
        detail,
      ]
        .map(csvCell)
        .join(',')
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="product-changes-${stamp}.csv"`);
  // BOM so Excel opens the Chinese headers as UTF-8.
  res.send('﻿' + lines.join('\r\n') + '\r\n');
});

module.exports = router;
