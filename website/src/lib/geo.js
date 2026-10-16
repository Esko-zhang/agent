'use strict';
const ip3country = require('ip3country');

/**
 * Offline IP → country. ip3country ships a ~0.5MB IPv4 table, so there is no
 * API key, no per-request network call, and no customer IP leaving the server
 * — which matters because an IP is personal data.
 *
 * Known limits, both of which return "unknown" rather than a wrong answer:
 *   - IPv4 only; an IPv6 visitor has no country.
 *   - A VPN or proxy reports wherever the exit node is.
 */
let ready = false;
try {
  ip3country.init();
  ready = true;
} catch (err) {
  console.error('[geo] country lookup unavailable:', err.message);
}

const regionZh = safeDisplayNames('zh-CN');
const regionEn = safeDisplayNames('en');

function safeDisplayNames(locale) {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    return null;
  }
}

/** Two-letter code → 🇺🇸 style flag, built from regional indicator letters. */
function flagOf(code) {
  if (!/^[A-Za-z]{2}$/.test(code || '')) return '';
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

/** Country code for an IP, or '' when it cannot be determined. */
function countryCode(ip) {
  if (!ready) return '';
  const clean = String(ip || '').replace(/^::ffff:/, '').trim();
  if (!clean) return '';
  try {
    return ip3country.lookupStr(clean) || '';
  } catch {
    return '';
  }
}

function nameOf(code, lang = 'zh') {
  if (!code) return '';
  const dn = lang === 'en' ? regionEn : regionZh;
  if (!dn) return code;
  try {
    const name = dn.of(code.toUpperCase());
    return name && name !== code.toUpperCase() ? name : code;
  } catch {
    return code;
  }
}

/** Everything the UI needs for one IP. */
function describe(ip) {
  const code = countryCode(ip);
  return { code, name: nameOf(code), flag: flagOf(code) };
}

/** Renders a stored country code for a table cell. */
function label(code) {
  if (!code) return '';
  return `${flagOf(code)} ${nameOf(code)}`.trim();
}

module.exports = { ready, countryCode, nameOf, flagOf, describe, label };
