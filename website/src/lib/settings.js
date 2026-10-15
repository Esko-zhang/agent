'use strict';
const { db } = require('../db');
const { CATEGORIES } = require('../config');

/**
 * Site-wide settings live in a simple key/value table so the admin can change
 * copy and branding without a deploy. Anything not stored falls back to these.
 */
const DEFAULTS = {
  site_name: 'Durlevel',
  brand_name: 'Durlevel',
  logo_path: '',
  login_tagline: 'Health Ingredients & OEM Manufacturing',
  products_intro: 'Browse our OEM finished products, plant extracts and food additives.',
  contact_intro: 'Our sales team is ready to support your enquiry.',
  footer_text: '© Durlevel. All rights reserved.',
  company_address: '',
  ...Object.fromEntries(CATEGORIES.map((c) => [c.settingKey, c.defaultTitle])),
};

const selectAll = db.prepare('SELECT key, value FROM settings');
const upsert = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

function all() {
  const stored = Object.fromEntries(selectAll.all().map((r) => [r.key, r.value]));
  return { ...DEFAULTS, ...stored };
}

function get(key) {
  return all()[key] ?? '';
}

function setMany(values) {
  const tx = db.transaction((entries) => {
    for (const [key, value] of entries) {
      if (key in DEFAULTS) upsert.run(key, value == null ? '' : String(value));
    }
  });
  tx(Object.entries(values));
}

/** Resolved section headings for the three product categories. */
function sectionTitles() {
  const s = all();
  return Object.fromEntries(CATEGORIES.map((c) => [c.key, s[c.settingKey] || c.defaultTitle]));
}

module.exports = { DEFAULTS, all, get, setMany, sectionTitles };
