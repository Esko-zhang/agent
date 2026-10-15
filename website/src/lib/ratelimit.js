'use strict';
const config = require('../config');

/** In-memory failed-login counter, keyed by IP + username. */
const buckets = new Map();

function keyOf(ip, username) {
  return `${ip}|${String(username || '').toLowerCase()}`;
}

function prune(now) {
  for (const [k, v] of buckets) {
    if (now - v.first > config.login.windowMs) buckets.delete(k);
  }
}

function check(ip, username) {
  const now = Date.now();
  prune(now);
  const b = buckets.get(keyOf(ip, username));
  if (!b) return { blocked: false };
  if (now - b.first > config.login.windowMs) return { blocked: false };
  if (b.count < config.login.maxAttempts) return { blocked: false };
  return { blocked: true, retryAfterMin: Math.ceil((config.login.windowMs - (now - b.first)) / 60000) };
}

function recordFailure(ip, username) {
  const now = Date.now();
  const k = keyOf(ip, username);
  const b = buckets.get(k);
  if (!b || now - b.first > config.login.windowMs) buckets.set(k, { count: 1, first: now });
  else b.count += 1;
}

function reset(ip, username) {
  buckets.delete(keyOf(ip, username));
}

module.exports = { check, recordFailure, reset };
