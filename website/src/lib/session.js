'use strict';
const crypto = require('crypto');
const config = require('../config');

const COOKIE_NAME = 'durlevel_sid';

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sign(payload) {
  return crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
}

/**
 * Stateless, HMAC-signed session cookie: `<base64url(json)>.<signature>`.
 * Keeps sessions alive across restarts without an external store.
 */
function serialize(data) {
  const body = b64url(JSON.stringify(data));
  return `${body}.${sign(body)}`;
}

function deserialize(raw) {
  if (typeof raw !== 'string') return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const given = raw.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data || typeof data !== 'object') return null;
    if (!data.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[k] = part.slice(i + 1).trim();
    }
  }
  return out;
}

/** Attaches `req.session` plus `res.setSession` / `res.clearSession`. */
function sessionMiddleware(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  req.cookies = cookies;
  req.session = deserialize(cookies[COOKIE_NAME]);

  res.setSession = (data) => {
    const payload = { ...data, exp: Date.now() + config.sessionTtlMs };
    res.cookie(COOKIE_NAME, serialize(payload), {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      maxAge: config.sessionTtlMs,
      path: '/',
    });
    req.session = payload;
  };

  res.clearSession = () => {
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      path: '/',
    });
    req.session = null;
  };

  next();
}

module.exports = { COOKIE_NAME, sessionMiddleware, serialize, deserialize };
