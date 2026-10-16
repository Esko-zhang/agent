'use strict';
const express = require('express');
const intent = require('../../lib/intent');
const accesslog = require('../../lib/accesslog');
const settings = require('../../lib/settings');
const roles = require('../../lib/roles');
const usersLib = require('../../lib/users');

/** Accounts keyed by lowercase username, for the ownership checks below. */
function accountsByName() {
  const map = {};
  usersLib.q.list.all().forEach((u) => { map[u.username.toLowerCase()] = u; });
  return map;
}

const router = express.Router();
const WINDOWS = [7, 30, 90];

router.get('/', (req, res) => {
  const days = WINDOWS.includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const tz = settings.get('log_timezone') || 'UTC';
  const byName = accountsByName();
  // A sales account sees only its own customers' activity.
  const rows = intent.overview(days)
    .filter((r) => roles.canSeeCustomer(req.user, r.username, byName))
    .map((r) => {
      const u = byName[r.username.toLowerCase()];
      return { ...r, created_by_name: u ? u.created_by_name : '' };
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
  if (!roles.canSeeCustomer(req.user, username, accountsByName())) {
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: 'This customer belongs to another sales representative.',
    });
  }
  const days = WINDOWS.includes(Number(req.query.days)) ? Number(req.query.days) : 90;
  const tz = settings.get('log_timezone') || 'UTC';
  const data = intent.forAccount(username, days);
  const summary = intent
    .overview(days)
    .find((r) => r.username.toLowerCase() === username.toLowerCase());
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
