'use strict';
const express = require('express');
const settings = require('../lib/settings');
const { verifyLogin, q } = require('../lib/users');
const ratelimit = require('../lib/ratelimit');
const accesslog = require('../lib/accesslog');

const router = express.Router();

/** Only allow redirects back into this site. */
function safeNext(next) {
  const v = String(next || '');
  return /^\/(?!\/)/.test(v) ? v : '/products';
}

// The homepage IS the login page (see 规划方案 §1).
router.get('/', (req, res) => {
  if (req.user) return res.redirect(safeNext(req.query.next));
  res.render('login', {
    settings: settings.all(),
    error: null,
    username: '',
    next: safeNext(req.query.next),
  });
});

router.post('/login', (req, res) => {
  const { username = '', password = '' } = req.body;
  const next = safeNext(req.body.next);
  const ip = req.ip || 'unknown';
  const render = (error) =>
    res.status(401).render('login', {
      settings: settings.all(),
      error,
      username: String(username).slice(0, 64),
      next,
    });

  const limited = ratelimit.check(ip, username);
  if (limited.blocked) {
    accesslog.record(req, 'login_failed', { username, path: '/login (rate limited)' });
    return render(`Too many failed attempts. Please try again in ${limited.retryAfterMin} minute(s).`);
  }

  if (!String(username).trim() || !String(password)) {
    return render('Please enter both your account and password.');
  }

  const user = verifyLogin(username, password);
  if (!user) {
    ratelimit.recordFailure(ip, username);
    accesslog.record(req, 'login_failed', { username, path: '/login' });
    return render('Incorrect account or password.');
  }
  if (user.blocked) {
    accesslog.record(req, 'login_failed', { username, path: '/login (account disabled)' });
    return render('This account has been disabled. Please contact your administrator.');
  }

  ratelimit.reset(ip, username);
  q.touchLogin.run(user.id);
  res.setSession({ uid: user.id });
  accesslog.record(req, 'login_success', { user, username: user.username, path: '/login' });
  return res.redirect(next);
});

router.post('/logout', (req, res) => {
  if (req.user) accesslog.record(req, 'logout', { path: '/logout' });
  res.clearSession();
  res.redirect('/');
});

module.exports = router;
