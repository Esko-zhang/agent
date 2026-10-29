'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('../config');
const { requireAuth } = require('../lib/auth');

const router = express.Router();

/**
 * Product and contact-card images.
 *
 * These used to be served straight out of public/ by express.static, which
 * runs before any guard — so a catalogue that is private, login-gated and sent
 * to named customers was handing its product photography to anyone holding a
 * URL, for as long as the file existed. The filenames are random, so nobody
 * could enumerate them; but a link only has to leak once, and a forwarded mail
 * or a screenshot is all that takes.
 *
 * The path stays /uploads/<name> so stored image_path values and every
 * template keep working. This router is mounted ahead of express.static, which
 * therefore never sees these requests.
 *
 * Nginx serves this prefix off disk on its own — deploy/nginx.conf.template no
 * longer does, and an existing install has to have that location block removed
 * or the app is bypassed and this guard does nothing.
 */
router.get('/:name', requireAuth, (req, res, next) => {
  // basename() first: the name is the only part a request controls, and it has
  // no business containing a separator.
  const name = path.basename(String(req.params.name || ''));
  const base = path.resolve(config.uploadDir);
  const full = path.resolve(base, name);
  if (!full.startsWith(base + path.sep)) return next();
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return next();

  // Uploaded bytes: never let a browser decide what they are.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Private, not public: the image is as confidential as the catalogue page it
  // sits on, so shared caches must not keep a copy.
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(full);
});

module.exports = router;
