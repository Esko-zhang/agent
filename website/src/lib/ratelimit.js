'use strict';
const config = require('../config');

/**
 * Failed-login counters, kept in two buckets per attempt.
 *
 * The per-account bucket (`ip|username`) stops someone grinding one password
 * list against one account. On its own it misses the other shape of the same
 * attack: one likely password tried against a hundred usernames, which never
 * puts more than a single failure in any one bucket. The per-IP bucket catches
 * that, with a much higher ceiling so a shared office address never trips it.
 *
 * In memory, so it resets on restart and does not span processes. That is the
 * right trade for a site with a handful of accounts; it is a speed bump for
 * guessing, not a ban list.
 */
const buckets = new Map();

/** Beyond this the table is not allowed to grow — see sweep() below. */
const MAX_BUCKETS = 10000;

const accountKey = (ip, username) => `a|${ip}|${String(username || '').toLowerCase()}`;
const ipKey = (ip) => `i|${ip}`;

function capOf(key) {
  return key.startsWith('i|') ? config.login.maxAttemptsPerIp : config.login.maxAttempts;
}

function sweep(now = Date.now()) {
  for (const [k, v] of buckets) {
    if (now - v.first > config.login.windowMs) buckets.delete(k);
  }
}

// Swept on a timer rather than on every attempt: the old code walked the whole
// table inside check(), so an attacker rotating usernames made each login
// quadratic in the number of buckets they had created.
setInterval(() => sweep(), 60 * 1000).unref();

function check(ip, username) {
  const now = Date.now();
  for (const key of [accountKey(ip, username), ipKey(ip)]) {
    const b = buckets.get(key);
    if (!b || now - b.first > config.login.windowMs) continue;
    if (b.count < capOf(key)) continue;
    return {
      blocked: true,
      retryAfterMin: Math.max(1, Math.ceil((config.login.windowMs - (now - b.first)) / 60000)),
    };
  }
  return { blocked: false };
}

function recordFailure(ip, username) {
  const now = Date.now();
  for (const key of [accountKey(ip, username), ipKey(ip)]) {
    const b = buckets.get(key);
    if (b && now - b.first <= config.login.windowMs) {
      b.count += 1;
      continue;
    }
    if (!b && buckets.size >= MAX_BUCKETS) {
      sweep(now);
      // Still full after a sweep: stop recording rather than let the table grow
      // without limit. The counters already in it keep working.
      if (buckets.size >= MAX_BUCKETS) continue;
    }
    buckets.set(key, { count: 1, first: now });
  }
}

/**
 * Clears the account bucket on a successful sign-in. The IP bucket is left
 * alone on purpose: one correct password should not wipe the record of
 * failures against everyone else's account from the same address.
 */
function reset(ip, username) {
  buckets.delete(accountKey(ip, username));
}

module.exports = { check, recordFailure, reset };
