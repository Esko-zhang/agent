'use strict';
const { q } = require('./users');
const roles = require('./roles');

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

function forbid(res, message) {
  res.status(403);
  return res.render('error', { title: 'Forbidden', message });
}

/** Admin only. */
function requireAdmin(req, res, next) {
  if (!req.user) return requireAuth(req, res, next);
  if (roles.isAdmin(req.user)) return next();
  return forbid(res, 'This area is restricted to administrators.');
}

/** Anyone who may open the backend at all: admin or sales. */
function requireBackend(req, res, next) {
  if (!req.user) return requireAuth(req, res, next);
  if (roles.hasBackend(req.user)) return next();
  return forbid(res, 'This area is restricted to staff accounts.');
}

/** Guards one backend section against the role table in lib/roles.js. */
function requireSection(sectionKey) {
  return (req, res, next) => {
    if (!req.user) return requireAuth(req, res, next);
    if (roles.canSee(req.user, sectionKey)) return next();
    return forbid(res, 'Your account does not have access to this section.');
  };
}

module.exports = { loadUser, requireAuth, requireAdmin, requireBackend, requireSection };
