'use strict';
const { db } = require('../db');

/**
 * Turns the raw access log into buying signals per account.
 *
 * The catalogue is one page, so a page view alone does not say which product
 * someone cared about. The signals that do are: what they searched for, which
 * spec sheets they downloaded, and what they put on an inquiry — in rising
 * order of intent. This module reads all three.
 */

const WINDOW_SQL = "datetime('now', ?)";

function windowClause(days) {
  return `-${Math.max(1, Math.floor(Number(days) || 30))} days`;
}

/** One row per account that has done anything in the window. */
function overview(days = 30) {
  const w = windowClause(days);
  const rows = db
    .prepare(
      `SELECT
         username,
         MAX(occurred_at)                                             AS last_seen,
         COUNT(*)                                                     AS events,
         COUNT(DISTINCT date(occurred_at))                            AS active_days,
         SUM(CASE WHEN event = 'page_view'     THEN 1 ELSE 0 END)     AS views,
         SUM(CASE WHEN event = 'doc_download'  THEN 1 ELSE 0 END)     AS downloads,
         SUM(CASE WHEN event = 'login_success' THEN 1 ELSE 0 END)     AS logins,
         COUNT(DISTINCT ip)                                           AS ips
       FROM access_log
       WHERE username <> '' AND occurred_at >= ${WINDOW_SQL}
       GROUP BY username`
    )
    .all(w);

  const searches = db
    .prepare(
      `SELECT username, COUNT(*) AS n FROM access_log
       WHERE username <> '' AND event = 'page_view' AND path LIKE '%/products?q=%'
         AND occurred_at >= ${WINDOW_SQL}
       GROUP BY username`
    )
    .all(w);
  const searchMap = Object.fromEntries(searches.map((r) => [r.username, r.n]));

  const inquiries = db
    .prepare(
      `SELECT username, COUNT(*) AS n FROM inquiries
       WHERE username <> '' AND created_at >= ${WINDOW_SQL}
       GROUP BY username`
    )
    .all(w);
  const inquiryMap = Object.fromEntries(inquiries.map((r) => [r.username, r.n]));

  const users = Object.fromEntries(
    db.prepare('SELECT username, display_name, role, is_active FROM users').all()
      .map((u) => [u.username.toLowerCase(), u])
  );

  return rows
    .map((r) => {
      const u = users[r.username.toLowerCase()];
      const searchCount = searchMap[r.username] || 0;
      const inquiryCount = inquiryMap[r.username] || 0;
      return {
        ...r,
        searches: searchCount,
        inquiries: inquiryCount,
        display_name: u ? u.display_name : '',
        role: u ? u.role : '',
        deleted: !u,
        // A simple weighting: an inquiry outranks a download, which outranks
        // a search, which outranks a plain visit.
        score: inquiryCount * 20 + r.downloads * 6 + searchCount * 2 + Math.min(r.views, 40),
      };
    })
    .sort((a, b) => b.score - a.score || b.last_seen.localeCompare(a.last_seen));
}

/** Pulls the search term out of a logged `/products?q=…` path. */
function searchTerm(path) {
  const m = String(path || '').match(/[?&]q=([^&]*)/);
  if (!m) return '';
  try {
    return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim();
  } catch {
    return m[1];
  }
}

/** Everything known about one account, for the detail page. */
function forAccount(username, days = 90) {
  const w = windowClause(days);

  const searchRows = db
    .prepare(
      `SELECT path, occurred_at FROM access_log
       WHERE username = ? COLLATE NOCASE AND event = 'page_view'
         AND path LIKE '%/products?q=%' AND occurred_at >= ${WINDOW_SQL}
       ORDER BY occurred_at DESC`
    )
    .all(username, w);

  const terms = new Map();
  for (const r of searchRows) {
    const t = searchTerm(r.path);
    if (!t) continue;
    const k = t.toLowerCase();
    if (!terms.has(k)) terms.set(k, { term: t, count: 0, last: r.occurred_at });
    terms.get(k).count += 1;
  }

  const downloads = db
    .prepare(
      `SELECT path, occurred_at FROM access_log
       WHERE username = ? COLLATE NOCASE AND event = 'doc_download'
         AND occurred_at >= ${WINDOW_SQL}
       ORDER BY occurred_at DESC LIMIT 100`
    )
    .all(username, w)
    .map((r) => ({
      // Logged as "/docs/3 (Product · LABEL)" — show the readable part.
      label: (String(r.path).match(/\(([^)]*)\)/) || [, r.path])[1],
      at: r.occurred_at,
    }));

  const inquiryRows = db
    .prepare(
      `SELECT * FROM inquiries WHERE username = ? COLLATE NOCASE AND created_at >= ${WINDOW_SQL}
       ORDER BY created_at DESC`
    )
    .all(username, w);

  const itemsByInquiry = new Map();
  for (const inq of inquiryRows) {
    itemsByInquiry.set(
      inq.id,
      db.prepare('SELECT * FROM inquiry_items WHERE inquiry_id = ? ORDER BY id').all(inq.id)
    );
  }

  // Which products they asked about most across all their inquiries.
  const productInterest = db
    .prepare(
      `SELECT t.name_en, COUNT(*) AS n, MAX(i.created_at) AS last
       FROM inquiry_items t JOIN inquiries i ON i.id = t.inquiry_id
       WHERE i.username = ? COLLATE NOCASE AND i.created_at >= ${WINDOW_SQL}
       GROUP BY t.name_en ORDER BY n DESC, last DESC`
    )
    .all(username, w);

  const visits = db
    .prepare(
      `SELECT occurred_at, event, path, ip FROM access_log
       WHERE username = ? COLLATE NOCASE AND occurred_at >= ${WINDOW_SQL}
       ORDER BY occurred_at DESC LIMIT 100`
    )
    .all(username, w);

  const ips = db
    .prepare(
      `SELECT ip, COUNT(*) AS n, MAX(occurred_at) AS last FROM access_log
       WHERE username = ? COLLATE NOCASE AND ip <> '' AND occurred_at >= ${WINDOW_SQL}
       GROUP BY ip ORDER BY n DESC`
    )
    .all(username, w);

  return {
    searches: [...terms.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last)),
    downloads,
    inquiries: inquiryRows,
    itemsByInquiry,
    productInterest,
    visits,
    ips,
  };
}

module.exports = { overview, forAccount, searchTerm };
