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

/**
 * Every officially assigned ISO 3166-1 alpha-2 code. Intl.DisplayNames can
 * translate a code but cannot enumerate them, so the list is spelled out here
 * — it is what fills the country picker and what typed text is matched against.
 */
const CODES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ ' +
  'BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR ' +
  'CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ' +
  'ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ ' +
  'LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ ' +
  'MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF ' +
  'PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI ' +
  'SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR ' +
  'TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ');

/**
 * Spellings a customer is likely to type that Intl does not return — "USA",
 * "UK", "Holland", "中国大陆". Checked after the official names, so it only
 * ever adds matches.
 */
const ALIASES = {
  usa: 'US', 'united states of america': 'US', america: 'US', 'u s a': 'US',
  uk: 'GB', 'u k': 'GB', britain: 'GB', 'great britain': 'GB', england: 'GB', scotland: 'GB',
  wales: 'GB', 'northern ireland': 'GB', 英格兰: 'GB', 大不列颠: 'GB',
  uae: 'AE', 'u a e': 'AE', emirates: 'AE', dubai: 'AE', 迪拜: 'AE', 阿联酋: 'AE',
  korea: 'KR', 'south korea': 'KR', 'republic of korea': 'KR', 南韩: 'KR', 大韩民国: 'KR',
  'north korea': 'KP', 朝鲜: 'KP',
  russia: 'RU', 俄国: 'RU', 苏联: 'RU',
  vietnam: 'VN', 'viet nam': 'VN',
  iran: 'IR', syria: 'SY', bolivia: 'BO', tanzania: 'TZ', venezuela: 'VE',
  laos: 'LA', brunei: 'BN', moldova: 'MD', macedonia: 'MK', 'north macedonia': 'MK',
  netherlands: 'NL', holland: 'NL', 荷兰: 'NL',
  czech: 'CZ', czechia: 'CZ', 'czech republic': 'CZ', 捷克: 'CZ',
  turkey: 'TR', turkiye: 'TR', türkiye: 'TR', 土耳其: 'TR',
  'saudi arabia': 'SA', saudi: 'SA', ksa: 'SA', 沙特: 'SA',
  'hong kong': 'HK', hongkong: 'HK', 香港: 'HK',
  taiwan: 'TW', 台湾: 'TW', 臺灣: 'TW',
  macau: 'MO', macao: 'MO', 澳门: 'MO',
  'ivory coast': 'CI', 'cote d ivoire': 'CI',
  myanmar: 'MM', burma: 'MM', 缅甸: 'MM',
  swaziland: 'SZ', eswatini: 'SZ', 'cape verde': 'CV', 'east timor': 'TL',
  china: 'CN', prc: 'CN', 'p r c': 'CN', 中国: 'CN', 中国大陆: 'CN', 中华人民共和国: 'CN',
  大陆: 'CN', 内地: 'CN',
  mainland: 'CN', 'mainland china': 'CN',
  germany: 'DE', deutschland: 'DE', spain: 'ES', espana: 'ES', españa: 'ES',
  japan: 'JP', 日本: 'JP', india: 'IN', 印度: 'IN', 'south africa': 'ZA',
  mexico: 'MX', méxico: 'MX', brazil: 'BR', brasil: 'BR',
};

/**
 * Loose match of typed text to a country code. Case, spacing, punctuation and
 * a leading "the" are ignored, so "the Netherlands", "netherlands" and "NL"
 * all land on NL. Returns '' when nothing matches — never a guess.
 */
let matchIndex = null;
function normaliseName(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[\s.,'’\u2018\u201c\u201d"()\-_/]+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

function buildMatchIndex() {
  const m = new Map();
  const add = (text, code) => {
    const key = normaliseName(text);
    if (key && !m.has(key)) m.set(key, code);
  };
  for (const code of CODES) {
    add(code, code);
    add(nameOf(code, 'zh'), code);
    add(nameOf(code, 'en'), code);
  }
  // Aliases last: an official name always wins.
  for (const [text, code] of Object.entries(ALIASES)) add(text, code);
  return m;
}

function resolve(text) {
  const key = normaliseName(text);
  if (!key) return '';
  if (!matchIndex) matchIndex = buildMatchIndex();
  return matchIndex.get(key) || '';
}

/** The country picker: every code with its Chinese name and flag, A-Z by name. */
let optionCache = null;
function options() {
  if (optionCache) return optionCache;
  const collator = (() => {
    try {
      return new Intl.Collator('zh-Hans-u-co-pinyin');
    } catch {
      return { compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0) };
    }
  })();
  optionCache = CODES.map((code) => ({ code, name: nameOf(code), flag: flagOf(code) })).sort(
    (a, b) => collator.compare(a.name, b.name)
  );
  return optionCache;
}

module.exports = { ready, countryCode, nameOf, flagOf, describe, label, CODES, resolve, options };
