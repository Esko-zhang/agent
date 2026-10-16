'use strict';
const express = require('express');
const intent = require('../../lib/intent');
const accesslog = require('../../lib/accesslog');
const settings = require('../../lib/settings');

const router = express.Router();
const WINDOWS = [7, 30, 90];

router.get('/', (req, res) => {
  const days = WINDOWS.includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const tz = settings.get('log_timezone') || 'UTC';
  const rows = intent.overview(days);
  // Who issued each account, so a sales lead can see their own customers.
  const byName = {};
  require('../../lib/users').q.list.all().forEach((u) => { byName[u.username.toLowerCase()] = u; });
  rows.forEach((r) => {
    const u = byName[r.username.toLowerCase()];
    r.created_by_name = u ? u.created_by_name : '';
  });
  res.render('admin/intent', {
    nav: 'intent',
    rows,
    days,
    windows: WINDOWS,
    fmt: (t) => accesslog.formatTime(t, tz),
  });
});

router.get('/:username', (req, res) => {
  const username = String(req.params.username).slice(0, 64);
  const days = WINDOWS.includes(Number(req.query.days)) ? Number(req.query.days) : 90;
  const tz = settings.get('log_timezone') || 'UTC';
  const data = intent.forAccount(username, days);
  const summary = intent.overview(days).find(
    (r) => r.username.toLowerCase() === username.toLowerCase()
  );
  res.render('admin/intent-detail', {
    nav: 'intent',
    username,
    days,
    windows: WINDOWS,
    data,
    summary,
    eventLabels: accesslog.EVENT_LABELS,
    searchTerm: intent.searchTerm,
    fmt: (t) => accesslog.formatTime(t, tz),
  });
});

module.exports = router;
