'use strict';
const express = require('express');
const accesslog = require('../../lib/accesslog');
const settings = require('../../lib/settings');

const router = express.Router();
const PER_PAGE = 50;
const EXPORT_CAP = 20000;

/** Reads the filter fields off the query string. */
function readFilter(query, tz) {
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  return {
    username: String(query.username || '').trim().slice(0, 64),
    event: String(query.event || '').trim(),
    q: String(query.q || '').trim().slice(0, 80),
    from: isDate(query.from) ? query.from : '',
    to: isDate(query.to) ? query.to : '',
    tzOffsetMinutes: accesslog.tzOffsetMinutes(tz),
  };
}

router.get('/', (req, res) => {
  const s = settings.all();
  const tz = s.log_timezone || 'UTC';
  const filter = readFilter(req.query, tz);

  const total = accesslog.count(filter);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), pages);
  const rows = accesslog.list(filter, { limit: PER_PAGE, offset: (page - 1) * PER_PAGE });

  res.render('admin/logs', {
    nav: 'logs',
    rows,
    total,
    page,
    pages,
    perPage: PER_PAGE,
    filter,
    tz,
    events: accesslog.EVENTS,
    eventLabels: accesslog.EVENT_LABELS,
    usernames: accesslog.usernames(),
    stats: accesslog.stats(),
    fmt: (t) => accesslog.formatTime(t, tz),
    retentionDays: s.log_retention_days,
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
  const rows = accesslog.listAll(filter, EXPORT_CAP);

  const header = ['时间 (' + tz + ')', '账号', '角色', '事件', '页面', 'IP', '浏览器标识'];
  const lines = [header.map(csvCell).join(',')];

  for (const r of rows) {
    lines.push(
      [
        accesslog.formatTime(r.occurred_at, tz),
        r.username,
        r.role,
        accesslog.EVENT_LABELS[r.event] || r.event,
        r.path,
        r.ip,
        r.user_agent,
      ]
        .map(csvCell)
        .join(',')
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="access-log-${stamp}.csv"`);
  // BOM so Excel opens the Chinese headers as UTF-8.
  res.send('﻿' + lines.join('\r\n') + '\r\n');
});

module.exports = router;
