'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('../config');
const { db } = require('../db');
const { verifyCsrf } = require('./csrf');

fs.mkdirSync(config.docDir, { recursive: true });

/** Spec sheets buyers actually ask for, plus the office formats they arrive in. */
const ALLOWED = new Map([
  ['application/pdf', '.pdf'],
  ['application/msword', '.doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/vnd.ms-excel', '.xls'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.docDir),
  filename: (_req, file, cb) =>
    cb(null, crypto.randomBytes(16).toString('hex') + ALLOWED.get(file.mimetype)),
});

const uploader = multer({
  storage,
  limits: { fileSize: config.maxDocBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
  },
});

/** Parses the upload, then verifies the deferred CSV token — same pattern as images. */
function uploadDoc(field) {
  return [uploader.single(field), verifyCsrf];
}

const q = {
  byId: db.prepare('SELECT * FROM product_docs WHERE id = ?'),
  forProduct: db.prepare('SELECT * FROM product_docs WHERE product_id = ? ORDER BY id'),
  insert: db.prepare(
    `INSERT INTO product_docs (product_id, label, filename, original, size_bytes)
     VALUES (@product_id, @label, @filename, @original, @size_bytes)`
  ),
  remove: db.prepare('DELETE FROM product_docs WHERE id = ?'),
  countByProduct: db.prepare(
    'SELECT product_id, COUNT(*) AS n FROM product_docs GROUP BY product_id'
  ),
  all: db.prepare('SELECT * FROM product_docs'),
};

/** Documents grouped by product id, for rendering many rows at once. */
function byProduct(productIds) {
  const map = new Map();
  if (!productIds.length) return map;
  const rows = db
    .prepare(
      `SELECT * FROM product_docs WHERE product_id IN (${productIds.map(() => '?').join(',')})
       ORDER BY product_id, id`
    )
    .all(...productIds);
  for (const r of rows) {
    if (!map.has(r.product_id)) map.set(r.product_id, []);
    map.get(r.product_id).push(r);
  }
  return map;
}

/**
 * What a browser can render itself, and the type to declare when it does.
 *
 * A PDF and an image can be shown in place; Word and Excel cannot, and no
 * amount of wishing changes that — those stay downloads, and the viewer says
 * so rather than opening an empty frame. The type is read from the stored
 * extension, which this module chose itself from the upload's MIME type, so it
 * is never a client-supplied string.
 */
const PREVIEWABLE = new Map([
  ['.pdf', { type: 'application/pdf', kind: 'pdf' }],
  ['.jpg', { type: 'image/jpeg', kind: 'image' }],
  ['.jpeg', { type: 'image/jpeg', kind: 'image' }],
  ['.png', { type: 'image/png', kind: 'image' }],
]);

/** `{ type, kind }` for a document a browser can display, else null. */
function previewOf(doc) {
  if (!doc) return null;
  return PREVIEWABLE.get(path.extname(String(doc.filename || '')).toLowerCase()) || null;
}

/** 'pdf' | 'image' | '' — what the viewer should do with this document. */
function previewKind(doc) {
  const p = previewOf(doc);
  return p ? p.kind : '';
}

/** Absolute path of a stored document, or null if it escapes the doc directory. */
function filePath(filename) {
  const base = path.resolve(config.docDir);
  const full = path.resolve(base, path.basename(String(filename || '')));
  return full.startsWith(base + path.sep) ? full : null;
}

function removeFile(filename) {
  const full = filePath(filename);
  if (full) fs.promises.unlink(full).catch(() => {});
}

/** Deletes a document row and its file. */
function remove(id) {
  const doc = q.byId.get(id);
  if (!doc) return null;
  q.remove.run(doc.id);
  removeFile(doc.filename);
  return doc;
}

function humanSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

/**
 * Where to read this document in place, with its own name as the last segment
 * — the browser's PDF reader shows that segment in its title bar, so without
 * it a buyer opening a spec sheet is looking at a document called "preview".
 * Returns '' for a file no browser can render.
 */
function previewUrl(doc, product) {
  if (!doc || !previewOf(doc)) return '';
  return `/docs/${doc.id}/preview/${encodeURIComponent(downloadName(doc, product))}`;
}

/** A download filename a browser will accept, derived from the product name. */
function downloadName(doc, product) {
  const ext = path.extname(doc.filename) || '';
  const base = [product?.name_en, doc.label].filter(Boolean).join(' - ') || 'document';
  const safe = base.replace(/[^\w一-龥 .-]/g, '').trim().slice(0, 80) || 'document';
  return safe + ext;
}

module.exports = {
  ALLOWED,
  PREVIEWABLE,
  previewOf,
  previewKind,
  previewUrl,
  uploadDoc,
  q,
  byProduct,
  filePath,
  remove,
  removeFile,
  humanSize,
  downloadName,
};
