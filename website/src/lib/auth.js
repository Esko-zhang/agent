'use strict';
const { q } = require('./users');
const roles = require('./roles');

/** Loads the logged-in user from the session cookie onto req/res.locals. */
function loadUser(req, res, next) {
  res.locals.currentUser = null;
  if (req.session?.uid) {
    const user = q.byId.get(req.session.uid);
    // A cookie is good only while the account is still there, still enabled,
    // and still on the password epoch the cookie was issued under. Cookies
    // issued before this column existed carry no `ep` and read as 0, which is
    // where every existing account starts — nobody is logged out by the
    // upgrade itself.
    const sameEpoch = user && (req.session.ep ?? 0) === (user.session_epoch ?? 0);
    if (user && user.is_active && sameEpoch) {
      req.user = user;
      res.locals.currentUser = user;
    } else {
      // Deleted, disabled, or the password has been reset since.
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
