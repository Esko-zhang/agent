'use strict';
const express = require('express');
const config = require('../../config');
const products = require('../../lib/products');
const { uploadSingle, publicPath, removeUpload } = require('../../lib/upload');
const docs = require('../../lib/docs');

const router = express.Router();

router.get('/', (req, res) => {
  const category = config.CATEGORY_KEYS.includes(req.query.category) ? req.query.category : null;
  const rows = category
    ? products.q.listByCategoryAdmin.all(category)
    : products.q.listAll.all();
  res.render('admin/products', { nav: 'products', rows, category });
});

router.get('/new', (req, res) => {
  const category = config.CATEGORY_KEYS.includes(req.query.category)
    ? req.query.category
    : config.CATEGORY_KEYS[0];
  res.render('admin/product-form', {
    nav: 'products',
    product: { category, is_active: 1, sort_order: products.nextSortOrder(category) },
    isNew: true,
    error: null,
    productDocs: [],
    humanSize: docs.humanSize,
  });
});

router.get('/:id/edit', (req, res, next) => {
  const product = products.q.byId.get(req.params.id);
  if (!product) return next();
  res.render('admin/product-form', {
    nav: 'products',
    product,
    isNew: false,
    error: null,
    productDocs: docs.q.forProduct.all(product.id),
    humanSize: docs.humanSize,
  });
});

router.post('/', uploadSingle('image'), (req, res) => {
  const row = products.fromForm(req.body);
  if (!row.name_en) {
    removeUpload(publicPath(req.file?.filename));
    return res.status(400).render('admin/product-form', {
      nav: 'products',
      product: { ...row, is_active: row.is_active },
      isNew: true,
      error: '产品英文名字为必填项。',
      productDocs: [],
      humanSize: docs.humanSize,
    });
  }
  row.image_path = req.file ? publicPath(req.file.filename) : '';
  const info = products.q.insert.run(row);
  res.redirect(`/admin/products?category=${row.category}&ok=${encodeURIComponent('已新增产品 #' + info.lastInsertRowid)}`);
});

router.post('/:id', uploadSingle('image'), (req, res, next) => {
  const existing = products.q.byId.get(req.params.id);
  if (!existing) {
    removeUpload(publicPath(req.file?.filename));
    return next();
  }
  const row = products.fromForm(req.body);
  if (!row.name_en) {
    removeUpload(publicPath(req.file?.filename));
    return res.status(400).render('admin/product-form', {
      nav: 'products',
      product: { ...existing, ...row },
      isNew: false,
      error: '产品英文名字为必填项。',
      productDocs: docs.q.forProduct.all(existing.id),
      humanSize: docs.humanSize,
    });
  }

  if (req.file) {
    row.image_path = publicPath(req.file.filename);
    removeUpload(existing.image_path);
  } else if (req.body.remove_image) {
    row.image_path = '';
    removeUpload(existing.image_path);
  } else {
    row.image_path = existing.image_path;
  }

  products.q.update.run({ ...row, id: existing.id });
  res.redirect(`/admin/products?category=${row.category}&ok=${encodeURIComponent('已保存产品 #' + existing.id)}`);
});

router.post('/:id/delete', (req, res, next) => {
  const existing = products.q.byId.get(req.params.id);
  if (!existing) return next();
  // Delete the files too; the rows go with the product via ON DELETE CASCADE.
  for (const d of docs.q.forProduct.all(existing.id)) docs.removeFile(d.filename);
  products.q.remove.run(existing.id);
  removeUpload(existing.image_path);
  res.redirect(`/admin/products?category=${existing.category}&ok=${encodeURIComponent('已删除产品 #' + existing.id)}`);
});

/* --- spec sheets (TDS / COA / MSDS) attached to a product --- */

router.post('/:id/docs', docs.uploadDoc('doc'), (req, res, next) => {
  const product = products.q.byId.get(req.params.id);
  if (!product) {
    if (req.file) docs.removeFile(req.file.filename);
    return next();
  }
  if (!req.file) {
    return res.redirect(
      `/admin/products/${product.id}/edit?ok=` + encodeURIComponent('请先选择要上传的文件')
    );
  }
  docs.q.insert.run({
    product_id: product.id,
    label: String(req.body.label || '').trim().slice(0, 40) || '文档',
    filename: req.file.filename,
    original: String(req.file.originalname || '').slice(0, 150),
    size_bytes: req.file.size,
  });
  res.redirect(`/admin/products/${product.id}/edit?ok=` + encodeURIComponent('文档已上传'));
});

router.post('/:id/docs/:docId/delete', (req, res, next) => {
  const product = products.q.byId.get(req.params.id);
  const doc = docs.q.byId.get(req.params.docId);
  if (!product || !doc || doc.product_id !== product.id) return next();
  docs.remove(doc.id);
  res.redirect(`/admin/products/${product.id}/edit?ok=` + encodeURIComponent('文档已删除'));
});

module.exports = router;
