'use strict';
const express = require('express');
const contacts = require('../../lib/contacts');
const users = require('../../lib/users');
const geo = require('../../lib/geo');
const roles = require('../../lib/roles');

/**
 * 联系方式汇总 — every account's working contact details in one table.
 *
 * Administrators only. The section table in lib/roles.js keeps a sales account
 * out of here, because the whole point of the page is to see across all reps'
 * customers at once; a rep's own customers are already listed, editable, in
 * 账号管理.
 */
const router = express.Router();
const EXPORT_CAP = 20000;

// Belt and braces: the mount in routes/admin/index.js already guards the
// section, but this page aggregates every rep's customers, so it refuses to
// render for anyone but an administrator even if it is ever remounted.
router.use((req, res, next) => {
  if (!roles.isAdmin(req.user)) {
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: '只有管理员可以查看联系方式汇总。',
    });
  }
  return next();
});

function readFilter(query) {
  const role = roles.ROLE_KEYS.includes(query.role) ? query.role : '';
  const only = ['missing', 'reachable', 'pending'].includes(query.only) ? query.only : '';
  return {
    role,
    only,
    country: /^[A-Za-z]{2}$/.test(String(query.country || ''))
      ? String(query.country).toUpperCase()
      : '',
    q: String(query.q || '').trim().slice(0, 80),
  };
}

router.get('/', (req, res) => {
  const filter = readFilter(req.query);
  // Stats and the country dropdown describe the whole book, not the current
  // filter, so the tiles stay comparable as the admin narrows the table.
  const everyone = contacts.all();
  const rows = everyone.filter((r) => contacts.directoryMatch(r, filter));

  res.render('admin/contacts', {
    nav: 'contacts',
    rows,
    total: everyone.length,
    filter,
    stats: contacts.stats(everyone),
    countries: contacts.countriesOf(everyone),
    pendingCount: everyone.filter((r) => r.hasPending).length,
    roleLabels: roles.ROLE_LABELS,
    allRoles: roles.ROLES,
    sourceLabels: contacts.SOURCE_LABELS,
    geo,
  });
});

/** Carries the current filter back onto a redirect. */
function backTo(query) {
  const p = new URLSearchParams();
  for (const key of ['role', 'country', 'q', 'only']) {
    if (query[key]) p.set(key, String(query[key]).slice(0, 80));
  }
  const s = p.toString();
  return '/admin/contacts' + (s ? '?' + s + '&' : '?');
}

/**
 * Copies what a customer typed on their own inquiries onto the account record,
 * for the fields the account does not have yet. Existing values are never
 * overwritten — a detail an administrator or a rep typed in stays put.
 */
function applyPending(row) {
  const account = users.q.byId.get(row.id);
  if (!account) return false;
  users.setContact(account.id, {
    company: account.company || row.pending.company || '',
    email: account.email || row.pending.email || '',
    phone: account.phone || row.pending.phone || '',
    whatsapp: account.whatsapp || '',
    country: account.country || row.pending.country || '',
  });
  return true;
}

router.post('/:id/backfill', (req, res, next) => {
  const row = contacts.all().find((r) => String(r.id) === String(req.params.id));
  if (!row) return next();
  if (!row.hasPending) {
    return res.redirect(backTo(req.query) + 'ok=' + encodeURIComponent('该账号没有可回填的信息'));
  }
  applyPending(row);
  res.redirect(
    backTo(req.query) + 'ok=' + encodeURIComponent('已回填 ' + row.username + ' 的联系方式')
  );
});

router.post('/backfill', (req, res) => {
  const pending = contacts.all().filter((r) => r.hasPending);
  let n = 0;
  for (const row of pending) if (applyPending(row)) n += 1;
  res.redirect(
    backTo(req.query) + 'ok=' + encodeURIComponent(n ? `已回填 ${n} 个账号的联系方式` : '没有可回填的信息')
  );
});

/**
 * Spreadsheets treat a leading =, +, - or @ as a formula, so values are
 * prefixed with an apostrophe before being quoted. A phone number starting
 * with + is exactly this case.
 */
function csvCell(value) {
  let v = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
  return '"' + v.replace(/"/g, '""') + '"';
}

router.get('/export.csv', (req, res) => {
  const filter = readFilter(req.query);
  const rows = contacts
    .all()
    .filter((r) => contacts.directoryMatch(r, filter))
    .slice(0, EXPORT_CAP);

  const header = [
    '登录账号', '姓名 / 联系人', '公司', '角色', '状态',
    '邮箱', '邮箱来源', '电话', '电话来源', 'WhatsApp', 'WhatsApp来源',
    '国家/地区', '国家代码', '国家来源',
    '所属业务员', '询盘次数', '最近询盘', '最近登录', '创建时间',
  ];
  const lines = [header.map(csvCell).join(',')];

  for (const r of rows) {
    lines.push(
      [
        r.username,
        r.display_name,
        r.company.value,
        roles.ROLE_LABELS[r.role] || r.role,
        r.is_active ? '启用' : '停用',
        r.email.value,
        r.email.sourceLabel,
        r.phone.value,
        r.phone.sourceLabel,
        r.whatsapp.value,
        r.whatsapp.sourceLabel,
        r.countryName,
        r.country.value,
        r.country.sourceLabel,
        r.manager,
        r.inquiryCount,
        r.lastInquiryAt,
        r.last_login_at || '',
        r.created_at,
      ]
        .map(csvCell)
        .join(',')
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="contacts-${stamp}.csv"`);
  // BOM so Excel opens the Chinese headers as UTF-8.
  res.send('﻿' + lines.join('\r\n') + '\r\n');
});

module.exports = router;
