'use strict';
const path = require('path');
require('dotenv').config();

const ROOT = path.resolve(__dirname, '..');

function bool(v, dflt = false) {
  if (v === undefined || v === '') return dflt;
  return /^(1|true|yes|on)$/i.test(String(v));
}

/**
 * Express's `trust proxy` setting, which decides how much of X-Forwarded-For
 * to believe — and therefore which IP the access log records.
 *   off / 0 / false  -> trust nothing (direct connections)
 *   1                -> one proxy in front (a plain Nginx or Caddy)
 *   2, 3, …          -> that many proxies (e.g. Cloudflare -> Nginx -> app)
 *   loopback, an IP, a CIDR, or a comma-separated list of them
 * Too low and every visitor is logged as the CDN; too high and a visitor can
 * forge their own IP by sending the header themselves.
 */
function parseTrustProxy(raw) {
  const v = String(raw == null ? '' : raw).trim();
  if (v === '' || /^(0|false|off|no)$/i.test(v)) return false;
  if (/^(1|true|on|yes)$/i.test(v)) return 1;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET || '';

if (isProd && sessionSecret.length < 32) {
  throw new Error(
    'SESSION_SECRET must be set to at least 32 characters in production. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
}

/**
 * The three product categories come straight from the requirement spreadsheet
 * ("产品列表页"). Each one has its own set of columns, so the field list is
 * declared once here and drives both the public table headers and the admin form.
 */
const CATEGORIES = [
  {
    key: 'oem',
    anchor: 'oem',
    zh: 'OEM成品',
    en: 'OEM Finished Products',
    settingKey: 'section_title_oem',
    defaultTitle: 'Durlevel OEM Finished Products',
    fields: ['dosage_form', 'spec', 'tags'],
  },
  {
    key: 'extract',
    anchor: 'extract',
    zh: '提取物',
    en: 'Extracts',
    settingKey: 'section_title_extract',
    defaultTitle: 'Durlevel Extracts',
    fields: ['content', 'ratio'],
  },
  {
    key: 'additive',
    anchor: 'additive',
    zh: '食品添加剂',
    en: 'Food Additives',
    settingKey: 'section_title_additive',
    defaultTitle: 'Durlevel Food Additives',
    fields: ['dosage_form', 'cas_no'],
  },
];

/** Labels for every product attribute, in both languages. */
const FIELD_LABELS = {
  dosage_form: { zh: '剂型', en: 'Dosage Form' },
  spec: { zh: '规格', en: 'Specification' },
  tags: { zh: '产品标签', en: 'Product Tags' },
  content: { zh: '含量', en: 'Content' },
  ratio: { zh: '比例', en: 'Ratio' },
  cas_no: { zh: 'CAS号', en: 'CAS No.' },
  remark: { zh: '备注', en: 'Remarks' },
};

const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);
const ALL_PRODUCT_FIELDS = Object.keys(FIELD_LABELS);

module.exports = {
  ROOT,
  isProd,
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  sessionSecret: sessionSecret || 'dev-only-insecure-secret-change-me',
  sessionTtlMs: Number(process.env.SESSION_TTL_HOURS || 12) * 60 * 60 * 1000,
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  cookieSecure: bool(process.env.COOKIE_SECURE, isProd),
  dbFile: process.env.DB_FILE || path.join(ROOT, 'data', 'site.db'),
  uploadDir: process.env.UPLOAD_DIR || path.join(ROOT, 'public', 'uploads'),
  // Spec sheets are deliberately NOT under public/: they are served only
  // through an authenticated route, unlike product images.
  docDir: process.env.DOC_DIR || path.join(ROOT, 'data', 'docs'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 5) * 1024 * 1024,
  maxDocBytes: Number(process.env.MAX_DOC_MB || 20) * 1024 * 1024,
  login: {
    maxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS || 8),
    windowMs: Number(process.env.LOGIN_WINDOW_MINUTES || 15) * 60 * 1000,
  },
  bootstrapAdmin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || '',
  },
  CATEGORIES,
  CATEGORY_KEYS,
  FIELD_LABELS,
  ALL_PRODUCT_FIELDS,
};
