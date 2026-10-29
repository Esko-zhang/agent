'use strict';
const express = require('express');
const settings = require('../lib/settings');
const { verifyLogin, q } = require('../lib/users');
const ratelimit = require('../lib/ratelimit');
const accesslog = require('../lib/accesslog');
const categories = require('../lib/categories');

const router = express.Router();

/**
 * What the sign-in panel lists down its side. It used to be three names typed
 * into the template, which stopped being true the moment the administrator
 * could add and remove categories — so it reads the published ones instead.
 */
function catalogueLines() {
  return categories.active().map((c) => c.en).slice(0, 5);
}

/**
 * Only allow redirects back into this site.
 *
 * Parsed rather than pattern-matched: browsers normalise a backslash to a
 * slash, so "/\evil.com" is "//evil.com" to them while a /^\/(?!\/)/ test
 * sees a harmless path and waves it through. Resolving against a placeholder
 * origin and checking what came out is the only version that agrees with the
 * browser.
 */
function safeNext(next) {
  const v = String(next || '');
  if (!v.startsWith('/')) return '/products';
  try {
    const base = 'http://durlevel.invalid';
    const u = new URL(v, base);
    if (u.origin !== base) return '/products';
    return u.pathname + u.search + u.hash;
  } catch {
    return '/products';
  }
}

// The homepage IS the login page (see 规划方案 §1).
router.get('/', (req, res) => {
  if (req.user) return res.redirect(safeNext(req.query.next));
  res.render('login', {
    settings: settings.all(),
    error: null,
    username: '',
    lines: catalogueLines(),
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
      lines: catalogueLines(),
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
  res.setSession({ uid: user.id, ep: user.session_epoch || 0 });
  accesslog.record(req, 'login_success', { user, username: user.username, path: '/login' });
  return res.redirect(next);
});

router.post('/logout', (req, res) => {
  if (req.user) accesslog.record(req, 'logout', { path: '/logout' });
  res.clearSession();
  res.redirect('/');
});

module.exports = router;
