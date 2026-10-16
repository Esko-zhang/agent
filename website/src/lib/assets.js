'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

/**
 * Cache-busting URLs for the static files.
 *
 * Stylesheets and scripts are served with a seven-day cache in production,
 * which is what makes the site quick — and what would otherwise hide a deploy
 * from everyone who had already visited: the browser keeps the old CSS until
 * the cache expires, so a redesign reaches nobody for a week.
 *
 * Each URL therefore carries a short hash of the file's contents, computed
 * once when the process starts. The URL changes exactly when the file does,
 * so a deploy invalidates precisely the assets it touched and nothing else.
 */
const PUBLIC_DIR = path.join(config.ROOT, 'public');
const cache = new Map();

function fingerprint(urlPath) {
  const clean = String(urlPath || '').split('?')[0];
  // Stay inside public/: these paths come from our own templates, but a
  // traversal here would read arbitrary files.
  const file = path.resolve(PUBLIC_DIR, '.' + (clean.startsWith('/') ? clean : '/' + clean));
  if (!file.startsWith(PUBLIC_DIR)) return '';
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
  } catch {
    // A missing file still renders; it just goes out unversioned.
    return '';
  }
}

/** `/css/site.css` → `/css/site.css?v=1a2b3c4d5e` */
function assetUrl(urlPath) {
  if (!cache.has(urlPath)) cache.set(urlPath, fingerprint(urlPath));
  const v = cache.get(urlPath);
  return v ? `${urlPath}?v=${v}` : urlPath;
}

module.exports = { assetUrl };
