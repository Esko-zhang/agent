'use strict';
const express = require('express');
const staff = require('../../lib/staff');
const { uploadSingle, publicPath, removeUpload } = require('../../lib/upload');

const router = express.Router();

router.get('/', (_req, res) => {
  res.render('admin/staff', { nav: 'staff', rows: staff.q.listAll.all() });
});

router.get('/new', (_req, res) => {
  res.render('admin/staff-form', {
    nav: 'staff',
    member: { is_active: 1, sort_order: staff.nextSortOrder() },
    isNew: true,
    error: null,
  });
});

router.get('/:id/edit', (req, res, next) => {
  const member = staff.q.byId.get(req.params.id);
  if (!member) return next();
  res.render('admin/staff-form', { nav: 'staff', member, isNew: false, error: null });
});

router.post('/', uploadSingle('photo'), (req, res) => {
  const row = staff.fromForm(req.body);
  if (!row.name) {
    removeUpload(publicPath(req.file?.filename));
    return res.status(400).render('admin/staff-form', {
      nav: 'staff',
      member: row,
      isNew: true,
      error: '业务员姓名为必填项。',
    });
  }
  row.photo_path = req.file ? publicPath(req.file.filename) : '';
  const info = staff.q.insert.run(row);
  res.redirect('/admin/staff?ok=' + encodeURIComponent('已新增业务员 #' + info.lastInsertRowid));
});

router.post('/:id', uploadSingle('photo'), (req, res, next) => {
  const existing = staff.q.byId.get(req.params.id);
  if (!existing) {
    removeUpload(publicPath(req.file?.filename));
    return next();
  }
  const row = staff.fromForm(req.body);
  if (!row.name) {
    removeUpload(publicPath(req.file?.filename));
    return res.status(400).render('admin/staff-form', {
      nav: 'staff',
      member: { ...existing, ...row },
      isNew: false,
      error: '业务员姓名为必填项。',
    });
  }

  if (req.file) {
    row.photo_path = publicPath(req.file.filename);
    removeUpload(existing.photo_path);
  } else if (req.body.remove_photo) {
    row.photo_path = '';
    removeUpload(existing.photo_path);
  } else {
    row.photo_path = existing.photo_path;
  }

  staff.q.update.run({ ...row, id: existing.id });
  res.redirect('/admin/staff?ok=' + encodeURIComponent('已保存业务员 #' + existing.id));
});

router.post('/:id/delete', (req, res, next) => {
  const existing = staff.q.byId.get(req.params.id);
  if (!existing) return next();
  staff.q.remove.run(existing.id);
  removeUpload(existing.photo_path);
  res.redirect('/admin/staff?ok=' + encodeURIComponent('已删除业务员 #' + existing.id));
});

module.exports = router;
