'use strict';
const express = require('express');
const settings = require('../../lib/settings');
const { uploadSingle, publicPath, removeUpload } = require('../../lib/upload');

const router = express.Router();

router.get('/', (_req, res) => {
  res.render('admin/settings', { nav: 'settings', error: null });
});

router.post('/', uploadSingle('logo'), (req, res) => {
  const current = settings.all();
  const values = {};
  for (const key of Object.keys(settings.DEFAULTS)) {
    if (key === 'logo_path') continue;
    if (key in req.body) values[key] = String(req.body[key]);
  }

  if (req.file) {
    values.logo_path = publicPath(req.file.filename);
    removeUpload(current.logo_path);
  } else if (req.body.remove_logo) {
    values.logo_path = '';
    removeUpload(current.logo_path);
  }

  settings.setMany(values);
  res.redirect('/admin/settings?ok=' + encodeURIComponent('网站设置已保存'));
});

module.exports = router;
