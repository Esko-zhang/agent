'use strict';
const express = require('express');
const inquiry = require('../../lib/inquiry');
const staff = require('../../lib/staff');
const mailer = require('../../lib/mailer');
const accesslog = require('../../lib/accesslog');
const settings = require('../../lib/settings');

const router = express.Router();
const PER_PAGE = 30;

const STATUSES = [
  { key: 'new', zh: '待处理' },
  { key: 'handled', zh: '已跟进' },
  { key: 'closed', zh: '已关闭' },
];

router.get('/', (req, res) => {
  const status = String(req.query.status || '');
  const term = String(req.query.q || '').trim().slice(0, 80);
  const { total } = inquiry.list({ status, q: term }, { limit: 1, offset: 0 });
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), pages);
  const { rows } = inquiry.list({ status, q: term }, {
    limit: PER_PAGE,
    offset: (page - 1) * PER_PAGE,
  });

  const counts = Object.fromEntries(inquiry.q.countByStatus.all().map((r) => [r.status, r.n]));
  const tz = settings.get('log_timezone') || 'UTC';

  res.render('admin/inquiries', {
    nav: 'inquiries',
    rows,
    total,
    page,
    pages,
    status,
    term,
    counts,
    statuses: STATUSES,
    mailStatus: mailer.status(),
    fmt: (t) => accesslog.formatTime(t, tz),
  });
});

router.get('/:id', (req, res, next) => {
  const row = inquiry.q.byId.get(req.params.id);
  if (!row) return next();
  const tz = settings.get('log_timezone') || 'UTC';
  res.render('admin/inquiry-detail', {
    nav: 'inquiries',
    inquiry: row,
    items: inquiry.q.items.all(row.id),
    team: staff.q.listAll.all(),
    statuses: STATUSES,
    fmt: (t) => accesslog.formatTime(t, tz),
  });
});

router.post('/:id', (req, res, next) => {
  const row = inquiry.q.byId.get(req.params.id);
  if (!row) return next();
  const status = STATUSES.some((s) => s.key === req.body.status) ? req.body.status : row.status;
  const assigned = Number.parseInt(req.body.assigned_to, 10);
  inquiry.q.setStatus.run({
    id: row.id,
    status,
    assigned_to: Number.isInteger(assigned) && assigned > 0 ? assigned : null,
    admin_note: String(req.body.admin_note || '').trim().slice(0, 2000),
  });
  res.redirect(`/admin/inquiries/${row.id}?ok=` + encodeURIComponent('已保存'));
});

router.post('/:id/delete', (req, res, next) => {
  const row = inquiry.q.byId.get(req.params.id);
  if (!row) return next();
  inquiry.q.remove.run(row.id); // items go with it via ON DELETE CASCADE
  res.redirect('/admin/inquiries?ok=' + encodeURIComponent('已删除询盘 #' + row.id));
});

module.exports = router;
