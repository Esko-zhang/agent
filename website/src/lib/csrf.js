'use strict';
const crypto = require('crypto');
const config = require('../config');

const COOKIE_NAME = 'durlevel_csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isMultipart(req) {
  return String(req.headers['content-type'] || '')
    .toLowerCase()
    .startsWith('multipart/form-data');
}

function tokenMatches(req, token) {
  const sent = req.body?._csrf || req.headers['x-csrf-token'];
  const a = Buffer.from(String(sent || ''));
  const b = Buffer.from(String(token || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function reject(res) {
  res.status(403);
  return res.render('error', {
    title: 'Request expired',
    message: '表单已过期或无效，请返回上一页刷新后重试。 / Form expired, please refresh and retry.',
  });
}

/**
 * Double-submit CSRF. A random token is kept in a readable cookie and must be
 * echoed back in the `_csrf` field of every state-changing request.
 *
 * Multipart bodies are parsed by multer inside the route, so there is no
 * `req.body` to inspect yet when this runs. Those requests are flagged and
 * verified by `verifyCsrf`, which `upload.uploadSingle()` always appends right
 * after the parser — so an upload route cannot accidentally skip the check.
 */
function csrfMiddleware(req, res, next) {
  let token = req.cookies?.[COOKIE_NAME];
  if (!token || !/^[a-f0-9]{48}$/.test(token)) {
    token = crypto.randomBytes(24).toString('hex');
    res.cookie(COOKIE_NAME, token, {
      httpOnly: false,
      sameSite: 'lax',
      secure: config.cookieSecure,
      path: '/',
    });
  }
  res.locals.csrfToken = token;
  req.csrfToken = token;

  if (SAFE_METHODS.has(req.method)) return next();
  if (isMultipart(req)) {
    req.csrfDeferred = true;
    return next();
  }
  return tokenMatches(req, token) ? next() : reject(res);
}

/** Verifies a deferred (multipart) token once the body has been parsed. */
function verifyCsrf(req, res, next) {
  if (!req.csrfDeferred) return next();
  req.csrfDeferred = false;
  return tokenMatches(req, req.csrfToken) ? next() : reject(res);
}

module.exports = { csrfMiddleware, verifyCsrf };
