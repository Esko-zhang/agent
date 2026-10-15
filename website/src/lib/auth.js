'use strict';
const { q } = require('./users');

/** Loads the logged-in user from the session cookie onto req/res.locals. */
function loadUser(req, res, next) {
  res.locals.currentUser = null;
  if (req.session?.uid) {
    const user = q.byId.get(req.session.uid);
    if (user && user.is_active) {
      req.user = user;
      res.locals.currentUser = user;
    } else {
      // Account was deleted or disabled after the cookie was issued.
      res.clearSession();
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  const target = req.originalUrl && req.method === 'GET' ? req.originalUrl : '/products';
  return res.redirect('/?next=' + encodeURIComponent(target));
}

function requireAdmin(req, res, next) {
  if (!req.user) return requireAuth(req, res, next);
  if (req.user.role === 'admin') return next();
  res.status(403);
  return res.render('error', {
    title: 'Forbidden',
    message: 'This area is restricted to administrators.',
  });
}

module.exports = { loadUser, requireAuth, requireAdmin };
