'use strict';
const express = require('express');
const inquiry = require('../../lib/inquiry');
const staff = require('../../lib/staff');
const mailer = require('../../lib/mailer');
const accesslog = require('../../lib/accesslog');
const settings = require('../../lib/settings');
const roles = require('../../lib/roles');
const usersLib = require('../../lib/users');

/** The customer usernames this account may see, or null for an administrator. */
function scopeFor(actor) {
  if (roles.isAdmin(actor)) return null;
  return roles.ownedAccounts(actor, usersLib.q.list.all()).map((u) => u.username);
}

/** Guards one inquiry against the viewer's book of business. */
function mayView(actor, row) {
  const scope = scopeFor(actor);
  if (scope === null) return true;
  return scope.some((n) => n.toLowerCase() === String(row.username || '').toLowerCase());
}

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
  const usernames = scopeFor(req.user);
  const { total } = inquiry.list({ status, q: term, usernames }, { limit: 1, offset: 0 });
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), pages);
  const { rows } = inquiry.list({ status, q: term, usernames }, {
    limit: PER_PAGE,
    offset: (page - 1) * PER_PAGE,
  });

  // Headline counts follow the same scope, so a rep's tiles match their list.
  const counts = {};
  ['new', 'handled', 'closed'].forEach((st) => {
    counts[st] = inquiry.list({ status: st, usernames }, { limit: 1, offset: 0 }).total;
  });
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
  if (!mayView(req.user, row)) {
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: 'This inquiry belongs to another sales representative.',
    });
  }
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
  if (!mayView(req.user, row)) {
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: 'This inquiry belongs to another sales representative.',
    });
  }
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
  if (!mayView(req.user, row)) {
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: 'This inquiry belongs to another sales representative.',
    });
  }
  inquiry.q.remove.run(row.id); // items go with it via ON DELETE CASCADE
  res.redirect('/admin/inquiries?ok=' + encodeURIComponent('已删除询盘 #' + row.id));
});

module.exports = router;
