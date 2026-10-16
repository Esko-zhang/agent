'use strict';
const { db } = require('../db');
const geo = require('./geo');

/** Event types, with the Chinese labels the admin UI shows. */
const EVENTS = [
  { key: 'login_success', zh: '登录成功' },
  { key: 'login_failed', zh: '登录失败' },
  { key: 'logout', zh: '退出登录' },
  { key: 'page_view', zh: '浏览页面' },
  { key: 'doc_download', zh: '下载文档' },
  { key: 'inquiry_submitted', zh: '提交询盘' },
];
const EVENT_KEYS = EVENTS.map((e) => e.key);
const EVENT_LABELS = Object.fromEntries(EVENTS.map((e) => [e.key, e.zh]));

const q = {
  insert: db.prepare(
    `INSERT INTO access_log (user_id, username, role, event, path, ip, country, user_agent)
     VALUES (@user_id, @username, @role, @event, @path, @ip, @country, @user_agent)`
  ),
  purge: db.prepare("DELETE FROM access_log WHERE occurred_at < datetime('now', ?)"),
  distinctUsers: db.prepare(
    "SELECT DISTINCT username FROM access_log WHERE username <> '' ORDER BY username COLLATE NOCASE"
  ),
  distinctCountries: db.prepare(
    "SELECT country, COUNT(*) AS n FROM access_log WHERE country <> '' GROUP BY country ORDER BY n DESC"
  ),
  total: db.prepare('SELECT COUNT(*) AS n FROM access_log'),
  oldest: db.prepare('SELECT MIN(occurred_at) AS t FROM access_log'),
};

/**
 * The visitor's IP. Express only trusts X-Forwarded-For when `trust proxy` is
 * set, which config ties to TRUST_PROXY — so behind Nginx this is the real
 * client address, and without a proxy it cannot be spoofed by a header.
 */
function clientIp(req) {
  const ip = req.ip || req.socket?.remoteAddress || '';
  // Normalise IPv4-mapped IPv6 (::ffff:1.2.3.4) to plain IPv4.
  return ip.replace(/^::ffff:/, '');
}

function record(req, event, extra = {}) {
  if (!EVENT_KEYS.includes(event)) return;
  const user = extra.user || req.user || null;
  const ip = clientIp(req);
  try {
    q.insert.run({
      user_id: user ? user.id : null,
      username: String(extra.username ?? (user ? user.username : '')).slice(0, 64),
      role: user ? user.role : '',
      event,
      path: String(extra.path ?? req.originalUrl ?? '').slice(0, 300),
      ip: ip.slice(0, 64),
      // Resolved now, so the record keeps the answer that was true at the time.
      country: geo.countryCode(ip),
      user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
    });
  } catch (err) {
    // Logging must never break a request the visitor is making.
    console.error('[accesslog] failed to record', event, err.message);
  }
}

/**
 * Restricts a query to a set of accounts. `null` means no restriction (an
 * administrator); an empty array means "nothing", which is the correct answer
 * for a sales account with no customers yet.
 */
function scopeParts(usernames) {
  if (!usernames) return { sql: '', params: [] };
  if (!usernames.length) return { sql: ' AND 1 = 0', params: [] };
  const lowered = usernames.map((u) => String(u).toLowerCase());
  return {
    sql: ` AND lower(username) IN (${lowered.map(() => '?').join(',')})`,
    params: lowered,
  };
}

/** Builds the shared WHERE clause for the admin list and the CSV export. */
function buildFilter(filter = {}) {
  const where = [];
  const params = [];

  // Applied first so it cannot be widened by anything the viewer types.
  if (filter.scope) {
    if (!filter.scope.length) {
      where.push('1 = 0');
    } else {
      const lowered = filter.scope.map((u) => String(u).toLowerCase());
      where.push(`lower(username) IN (${lowered.map(() => '?').join(',')})`);
      params.push(...lowered);
    }
  }

  if (filter.username) {
    where.push('username = ? COLLATE NOCASE');
    params.push(filter.username);
  }
  if (filter.event && EVENT_KEYS.includes(filter.event)) {
    where.push('event = ?');
    params.push(filter.event);
  }
  if (filter.country) {
    where.push('country = ?');
    params.push(String(filter.country).toUpperCase().slice(0, 2));
  }
  if (filter.q) {
    const like = '%' + String(filter.q).replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    where.push("(ip LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\' OR user_agent LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  // Dates arrive as YYYY-MM-DD in the admin's timezone; convert to a UTC range.
  if (filter.from) {
    where.push("occurred_at >= datetime(?, ?)");
    params.push(filter.from + ' 00:00:00', utcShift(filter.tzOffsetMinutes));
  }
  if (filter.to) {
    where.push("occurred_at < datetime(?, ?)");
    params.push(filter.to + ' 00:00:00', `${-(filter.tzOffsetMinutes || 0) + 1440} minutes`);
  }
  return { clause: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

function utcShift(tzOffsetMinutes) {
  return `${-(tzOffsetMinutes || 0)} minutes`;
}

/** Minutes a timezone is ahead of UTC right now (Asia/Shanghai -> 480). */
function tzOffsetMinutes(timeZone, at = new Date()) {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      })
        .formatToParts(at)
        .map((p) => [p.type, p.value])
    );
    const asUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
    );
    return Math.round((asUtc - at.getTime() * 1) / 60000);
  } catch {
    return 0; // Unknown timezone: fall back to UTC rather than throwing.
  }
}

/** Renders a stored UTC timestamp in the configured timezone. */
function formatTime(utcString, timeZone) {
  if (!utcString) return '';
  const d = new Date(String(utcString).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return String(utcString);
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
      .format(d)
      .replace(/\//g, '-');
  } catch {
    return String(utcString) + ' UTC';
  }
}

function count(filter) {
  const { clause, params } = buildFilter(filter);
  return db.prepare(`SELECT COUNT(*) AS n FROM access_log ${clause}`).get(...params).n;
}

function list(filter, { limit = 50, offset = 0 } = {}) {
  const { clause, params } = buildFilter(filter);
  return db
    .prepare(
      `SELECT * FROM access_log ${clause} ORDER BY occurred_at DESC, id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);
}

/** Every matching row, for the CSV export. Capped so one click cannot stall. */
function listAll(filter, cap = 20000) {
  const { clause, params } = buildFilter(filter);
  return db
    .prepare(`SELECT * FROM access_log ${clause} ORDER BY occurred_at DESC, id DESC LIMIT ?`)
    .all(...params, cap);
}

/** Headline numbers for the last 24 hours and the last 7 days, within scope. */
function stats(scope = null) {
  const day = "datetime('now', '-1 day')";
  const week = "datetime('now', '-7 days')";
  const sc = scopeParts(scope);
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  return {
    loginsToday: one(
      `SELECT COUNT(*) AS n FROM access_log
       WHERE event = 'login_success' AND occurred_at >= ${day}${sc.sql}`,
      ...sc.params
    ).n,
    activeAccountsToday: one(
      `SELECT COUNT(DISTINCT username) AS n FROM access_log
       WHERE username <> '' AND occurred_at >= ${day}${sc.sql}`,
      ...sc.params
    ).n,
    uniqueIpsToday: one(
      `SELECT COUNT(DISTINCT ip) AS n FROM access_log
       WHERE ip <> '' AND occurred_at >= ${day}${sc.sql}`,
      ...sc.params
    ).n,
    countriesToday: one(
      `SELECT COUNT(DISTINCT country) AS n FROM access_log
       WHERE country <> '' AND occurred_at >= ${day}${sc.sql}`,
      ...sc.params
    ).n,
    failedWeek: one(
      `SELECT COUNT(*) AS n FROM access_log
       WHERE event = 'login_failed' AND occurred_at >= ${week}${sc.sql}`,
      ...sc.params
    ).n,
    total: one(`SELECT COUNT(*) AS n FROM access_log WHERE 1 = 1${sc.sql}`, ...sc.params).n,
    oldest: one(`SELECT MIN(occurred_at) AS t FROM access_log WHERE 1 = 1${sc.sql}`, ...sc.params).t,
  };
}

function usernames(scope = null) {
  const sc = scopeParts(scope);
  return db
    .prepare(
      `SELECT DISTINCT username FROM access_log
       WHERE username <> ''${sc.sql} ORDER BY username COLLATE NOCASE`
    )
    .all(...sc.params)
    .map((r) => r.username);
}

/** Countries seen in the log, most frequent first, for the filter dropdown. */
function countries(scope = null) {
  const sc = scopeParts(scope);
  return db
    .prepare(
      `SELECT country, COUNT(*) AS n FROM access_log
       WHERE country <> ''${sc.sql} GROUP BY country ORDER BY n DESC`
    )
    .all(...sc.params)
    .map((r) => ({
      code: r.country,
      name: geo.nameOf(r.country),
      flag: geo.flagOf(r.country),
      count: r.n,
    }));
}

/** Drops rows older than the retention window. Returns how many were removed. */
function purgeOlderThan(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return q.purge.run(`-${Math.floor(n)} days`).changes;
}

module.exports = {
  EVENTS,
  tzOffsetMinutes,
  formatTime,
  EVENT_KEYS,
  EVENT_LABELS,
  clientIp,
  record,
  list,
  listAll,
  count,
  stats,
  usernames,
  countries,
  purgeOlderThan,
};
