'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('../config');
const { verifyCsrf } = require('./csrf');
const filetype = require('./filetype');

fs.mkdirSync(config.uploadDir, { recursive: true });

const ALLOWED = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  // Random name: never trust the client-supplied filename or extension.
  filename: (_req, file, cb) =>
    cb(null, crypto.randomBytes(16).toString('hex') + ALLOWED.get(file.mimetype)),
});

const uploadImage = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
  },
});

/**
 * The only way routes should accept an upload: multer parses the multipart
 * body, then the deferred CSRF check runs immediately after. Bundling the two
 * means an upload route can never be wired up without CSRF protection.
 */
/**
 * Rejects an upload whose bytes do not match the type it claimed, deleting it
 * on the way out. Runs after multer has written the file, which is the first
 * moment there is anything to look at.
 */
function verifyContent(req, res, next) {
  if (!req.file) return next();
  const ext = path.extname(req.file.filename).toLowerCase();
  if (filetype.matches(req.file.path, ext)) return next();
  fs.promises.unlink(req.file.path).catch(() => {});
  req.file = undefined;
  return next(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'file'));
}

function uploadSingle(field) {
  return [uploadImage.single(field), verifyCsrf, verifyContent];
}

/** Public URL for a stored upload, e.g. `/uploads/ab12.jpg`. */
function publicPath(filename) {
  return filename ? '/uploads/' + path.basename(filename) : '';
}

/** Deletes a previously uploaded file, ignoring anything outside the upload dir. */
function removeUpload(publicUrl) {
  if (!publicUrl || !publicUrl.startsWith('/uploads/')) return;
  const file = path.join(config.uploadDir, path.basename(publicUrl));
  if (path.dirname(file) !== path.resolve(config.uploadDir)) return;
  fs.promises.unlink(file).catch(() => {});
}

module.exports = { uploadSingle, publicPath, removeUpload, ALLOWED };
