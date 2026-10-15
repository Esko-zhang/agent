'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const express = require('express');
const imp = require('../../lib/import');
const config = require('../../config');
const { verifyCsrf } = require('../../lib/csrf');

const router = express.Router();

const TMP_DIR = path.join(os.tmpdir(), 'durlevel-import');
fs.mkdirSync(TMP_DIR, { recursive: true });

const ALLOWED = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  'text/plain',
]);

const uploader = multer({
  // The sheet is parsed once and then deleted; it never joins the site's files.
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TMP_DIR),
    filename: (_req, file, cb) =>
      cb(null, crypto.randomBytes(12).toString('hex') + path.extname(file.originalname || '')),
  }),
  limits: { fileSize: config.maxUploadBytes * 4, files: 1 },
  fileFilter: (_req, file, cb) => {
    const okExt = /\.(xlsx|xls|csv)$/i.test(file.originalname || '');
    if (ALLOWED.has(file.mimetype) || okExt) return cb(null, true);
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
  },
});

router.get('/', (_req, res) => {
  res.render('admin/import', {
    nav: 'products',
    stage: 'upload',
    error: null,
    columns: imp.COLUMNS,
    categories: config.CATEGORIES,
  });
});

router.get('/template.xlsx', async (_req, res, next) => {
  try {
    const buf = await imp.buildTemplate();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="durlevel-products-template.xlsx"');
    res.send(Buffer.from(buf));
  } catch (err) {
    next(err);
  }
});

router.post('/', uploader.single('sheet'), verifyCsrf, async (req, res, next) => {
  if (!req.file) {
    return res.status(400).render('admin/import', {
      nav: 'products',
      stage: 'upload',
      error: '请选择要导入的 Excel 或 CSV 文件。',
      columns: imp.COLUMNS,
      categories: config.CATEGORIES,
    });
  }

  try {
    const raw = await imp.readRows(req.file.path, req.file.originalname);
    if (!raw.length) {
      return res.status(400).render('admin/import', {
        nav: 'products',
        stage: 'upload',
        error: '文件里没有数据行（第一行应是表头，从第二行开始填产品）。',
        columns: imp.COLUMNS,
        categories: config.CATEGORIES,
      });
    }

    const analysed = imp.analyse(raw);
    const token = imp.stash(req.user.id, analysed, {
      filename: req.file.originalname,
      rows: raw.length,
    });

    res.render('admin/import', {
      nav: 'products',
      stage: 'preview',
      error: null,
      columns: imp.COLUMNS,
      categories: config.CATEGORIES,
      analysed,
      token,
      meta: { filename: req.file.originalname, rows: raw.length },
    });
  } catch (err) {
    return res.status(400).render('admin/import', {
      nav: 'products',
      stage: 'upload',
      error: '无法读取这个文件：' + err.message,
      columns: imp.COLUMNS,
      categories: config.CATEGORIES,
    });
  } finally {
    fs.promises.unlink(req.file.path).catch(() => {});
  }
});

router.post('/confirm', (req, res) => {
  const entry = imp.take(req.body.token, req.user.id);
  if (!entry) {
    return res.status(400).render('admin/import', {
      nav: 'products',
      stage: 'upload',
      error: '这次导入已过期或已经执行过，请重新上传文件。',
      columns: imp.COLUMNS,
      categories: config.CATEGORIES,
    });
  }
  const { created, updated } = imp.apply(entry.analysed);
  const skipped = entry.analysed.summary.error;
  const msg =
    `导入完成：新增 ${created} 个，更新 ${updated} 个` +
    (skipped ? `，跳过 ${skipped} 个有问题的行` : '');
  res.redirect('/admin/products?ok=' + encodeURIComponent(msg));
});

module.exports = router;
