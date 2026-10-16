'use strict';
const { db } = require('../db');
const geo = require('./geo');
const staffLib = require('./staff');

/**
 * The contact directory behind /admin/contacts.
 *
 * Contact details reach us from three places, and none of them is complete on
 * its own:
 *
 *   account  手填 — what an administrator or the account's own sales rep typed
 *                   into 账号管理. Authoritative, so it always wins.
 *   inquiry  询盘 — what the customer typed on their own quote requests. Often
 *                   the only email we have, and the most recent one is used.
 *   card     名片 — for a sales account, the business card it is linked to.
 *   ip       IP   — the country the visitor's address resolves to. Only ever a
 *                   fallback for the country, never for a phone or an email.
 *
 * Every value therefore carries the source it came from, so the admin can see
 * at a glance which details are confirmed and which are only what a customer
 * once typed into a form.
 */

const SOURCE_LABELS = { account: '已存', inquiry: '询盘', card: '名片', ip: 'IP' };

const q = {
  accounts: db.prepare(`
    SELECT id, username, display_name, role, is_active, created_at, last_login_at,
           created_by, created_by_name, staff_id, company, email, phone, whatsapp, country
    FROM users ORDER BY username COLLATE NOCASE
  `),
  // Oldest first: folding the rows in order leaves the most recent non-empty
  // value of each field in place.
  inquiries: db.prepare(`
    SELECT lower(username) AS u, company, contact_name, email, phone, country, created_at
    FROM inquiries WHERE trim(username) <> '' ORDER BY created_at, id
  `),
  inquiryCounts: db.prepare(`
    SELECT lower(username) AS u, COUNT(*) AS n FROM inquiries
    WHERE trim(username) <> '' GROUP BY lower(username)
  `),
  // The country each account was last seen from, by IP.
  lastSeen: db.prepare(`
    SELECT lower(username) AS u, country, occurred_at
    FROM access_log WHERE country <> '' AND trim(username) <> ''
    ORDER BY occurred_at, id
  `),
};

/** Most recent non-empty contact value per account, as the customer typed it. */
function fromInquiries() {
  const byUser = new Map();
  for (const r of q.inquiries.all()) {
    const cur = byUser.get(r.u) || {};
    for (const field of ['company', 'contact_name', 'email', 'phone', 'country']) {
      const v = String(r[field] || '').trim();
      if (v) cur[field] = v;
    }
    cur.at = r.created_at;
    byUser.set(r.u, cur);
  }
  return byUser;
}

function lastSeenCountries() {
  const byUser = new Map();
  for (const r of q.lastSeen.all()) byUser.set(r.u, { code: r.country, at: r.occurred_at });
  return byUser;
}

/** Picks the first non-empty candidate and remembers where it came from. */
function pick(candidates) {
  for (const [source, raw] of candidates) {
    const value = String(raw == null ? '' : raw).trim();
    if (value) return { value, source, sourceLabel: SOURCE_LABELS[source] || source };
  }
  return { value: '', source: '', sourceLabel: '' };
}

/** One merged row per account. */
function merge(account, inquiry, seen, card) {
  const email = pick([
    ['account', account.email],
    ['inquiry', inquiry.email],
    ['card', card && card.email],
  ]);
  const phone = pick([
    ['account', account.phone],
    ['inquiry', inquiry.phone],
    ['card', card && card.phone],
  ]);
  const whatsapp = pick([
    ['account', account.whatsapp],
    ['card', card && card.whatsapp],
  ]);
  const company = pick([
    ['account', account.company],
    ['inquiry', inquiry.company],
  ]);
  const country = pick([
    ['account', account.country],
    // Free text as typed on an inquiry, matched to a code where possible.
    ['inquiry', geo.resolve(inquiry.country)],
    ['ip', seen && seen.code],
  ]);

  // What a backfill would copy onto the account: inquiry values for fields the
  // account itself does not have yet.
  const pending = {};
  if (!account.email && inquiry.email) pending.email = inquiry.email;
  if (!account.phone && inquiry.phone) pending.phone = inquiry.phone;
  if (!account.company && inquiry.company) pending.company = inquiry.company;
  if (!account.country) {
    const code = geo.resolve(inquiry.country) || (seen && seen.code) || '';
    if (code) pending.country = code;
  }

  const reachable = !!(email.value || phone.value || whatsapp.value);
  return {
    id: account.id,
    username: account.username,
    display_name: account.display_name || inquiry.contact_name || '',
    role: account.role,
    is_active: account.is_active,
    created_at: account.created_at,
    last_login_at: account.last_login_at,
    manager: account.created_by_name || '',
    company,
    email,
    phone,
    whatsapp,
    country,
    countryName: country.value ? geo.nameOf(country.value) : '',
    countryFlag: country.value ? geo.flagOf(country.value) : '',
    waLink: staffLib.waLink(whatsapp.value),
    lastSeenAt: seen ? seen.at : '',
    lastInquiryAt: inquiry.at || '',
    pending,
    hasPending: Object.keys(pending).length > 0,
    reachable,
    // Everything the directory asks for: a name, a mail route, a voice or chat
    // route, and a country.
    complete: !!(email.value && (phone.value || whatsapp.value) && country.value),
  };
}

/** Every account, merged. Filtering happens on top of this. */
function all() {
  const inquiries = fromInquiries();
  const seen = lastSeenCountries();
  const counts = new Map(q.inquiryCounts.all().map((r) => [r.u, r.n]));
  const cards = new Map(staffLib.q.listAll.all().map((c) => [c.id, c]));

  return q.accounts.all().map((a) => {
    const key = a.username.toLowerCase();
    const row = merge(a, inquiries.get(key) || {}, seen.get(key), a.staff_id ? cards.get(a.staff_id) : null);
    row.inquiryCount = counts.get(key) || 0;
    return row;
  });
}

function matches(row, { role, q: term, country, only }) {
  if (role && row.role !== role) return false;
  if (country && row.country.value !== country) return false;
  if (only === 'missing' && row.reachable) return false;
  if (only === 'reachable' && !row.reachable) return false;
  if (only === 'pending' && !row.hasPending) return false;
  if (term) {
    // A country searched by any of its spellings — "UAE", "阿联酋", "AE" — all
    // land on the same code, which is what the row is actually stored with.
    if (row.country.value && geo.resolve(term) === row.country.value) return true;
    const needle = term.toLowerCase();
    const hay = [
      row.username,
      row.display_name,
      row.company.value,
      row.email.value,
      row.phone.value,
      row.whatsapp.value,
      row.countryName,
      row.country.value,
      row.manager,
    ]
      .join(' ')
      .toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

function directory(filter = {}) {
  return all().filter((row) => matches(row, filter));
}

/** Headline numbers, always over every account so the tiles stay comparable. */
function stats(rows) {
  const customers = rows.filter((r) => r.role === 'user');
  return {
    accounts: rows.length,
    customers: customers.length,
    withEmail: rows.filter((r) => r.email.value).length,
    withPhone: rows.filter((r) => r.phone.value || r.whatsapp.value).length,
    withCountry: rows.filter((r) => r.country.value).length,
    unreachable: rows.filter((r) => !r.reachable).length,
  };
}

/** The countries present in the directory, for the filter dropdown. */
function countriesOf(rows) {
  const seen = new Map();
  for (const r of rows) {
    if (r.country.value) seen.set(r.country.value, (seen.get(r.country.value) || 0) + 1);
  }
  return [...seen.entries()]
    .map(([code, n]) => ({ code, n, name: geo.nameOf(code), flag: geo.flagOf(code) }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

module.exports = {
  SOURCE_LABELS,
  q,
  all,
  directory,
  directoryMatch: matches,
  stats,
  countriesOf,
  merge,
};
