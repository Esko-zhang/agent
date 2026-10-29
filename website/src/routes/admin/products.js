'use strict';
const express = require('express');
const config = require('../../config');
const products = require('../../lib/products');
const { uploadSingle, publicPath, removeUpload } = require('../../lib/upload');
const docs = require('../../lib/docs');
const roles = require('../../lib/roles');
const categories = require('../../lib/categories');
const imports = require('../../lib/import');
const productlog = require('../../lib/productlog');
const accesslog = require('../../lib/accesslog');
const settings = require('../../lib/settings');

const router = express.Router();

/**
 * A sales account drafts and edits; only an administrator publishes, deletes,
 * or removes an attached document. Everything a sales account creates starts
 * 下架 and waits for review, and a save from one can never flip that bit —
 * the form hides the checkbox, and this strips it again on the way in.
 */
function applyPublishRules(req, row, existing) {
  if (roles.canPublishProducts(req.user)) return row;
  return { ...row, is_active: existing ? existing.is_active : 0 };
}

/**
 * A product needs a category to live in, and products.fromForm refuses to
 * invent one. Say so on the page the person is already looking at instead of
 * letting the exception become a server error.
 */
function needCategories(req, res) {
  if (categories.keys().length) return false;
  res.status(400).render('error', {
    title: '还没有品类',
    message: '请先到「品类管理」创建至少一个品类，然后再录入产品。',
  });
  return true;
}

function denyUnlessAdmin(req, res, what) {
  if (roles.canDeleteProducts(req.user)) return false;
  res.status(403).render('error', { title: 'Forbidden', message: what });
  return true;
}

/** Shared context for both renders of the product form. */
function formContext(req, product, isNew, error, productDocs) {
  return {
    nav: 'products',
    product,
    isNew,
    error,
    productDocs,
    humanSize: docs.humanSize,
    // '' for Word and Excel, which no browser renders.
    docPreview: docs.previewKind,
    docPreviewUrl: docs.previewUrl,
    canPublish: roles.canPublishProducts(req.user),
    canDelete: roles.canDeleteProducts(req.user),
    // The history belongs to the administrators who review these edits.
    history: !isNew && roles.isAdmin(req.user) ? productlog.forProduct(product.id, 8) : [],
    parseDetail: productlog.parseDetail,
    actionLabels: productlog.ACTION_LABELS,
    // Same clock as 访问记录 and 产品变更记录, so timestamps can be compared.
    fmt: (t) => accesslog.formatTime(t, settings.get('log_timezone') || 'UTC'),
  };
}

router.get('/', (req, res) => {
  const category = categories.keys().includes(req.query.category) ? req.query.category : null;
  const search = String(req.query.q || '').trim();
  const rows = products.adminList(category, search);
  res.render('admin/products', {
    nav: 'products',
    rows,
    category,
    search,
    // Only asked for while a category is open, and only to warn that the
    // list in front of you is not the whole answer.
    outsideCategory: products.countOutsideCategory(category, search),
    canPublish: roles.canPublishProducts(req.user),
    canDelete: roles.canDeleteProducts(req.user),
    canImport: roles.canImportProducts(req.user),
  });
});

/**
 * The catalogue as a spreadsheet, in the importer's own layout so it can be
 * edited and fed back in. Administrators only, and for the same reason the
 * import is: one request hands over every product, published or not, with the
 * remarks and the internal Chinese names a sales account should not be able to
 * walk off with in a single file.
 *
 * It exports what the page in front of you shows — the open category and the
 * search term — so "export these twelve" needs no second screen.
 *
 * Declared before /:id/edit so the filename is never read as a product id.
 */
router.get('/export.xlsx', async (req, res, next) => {
  if (denyUnlessAdmin(req, res, '只有管理员可以导出产品。')) return;
  try {
    const category = categories.keys().includes(req.query.category) ? req.query.category : null;
    const search = String(req.query.q || '').trim().slice(0, 80);
    const rows = products.adminList(category, search);

    const stamp = new Date().toISOString().slice(0, 10);
    const scope = category ? categories.nameOf(category) : '全部产品';
    const buf = await imports.buildExport(rows, { title: scope });

    // Taking the whole catalogue out of the system is worth a line in the
    // record, the same as putting one in.
    productlog.record(req, {
      action: 'export',
      category: category || '',
      note: `导出 ${rows.length} 个产品（${scope}${search ? `，搜索「${search}」` : ''}）`,
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="durlevel-products-${stamp}.xlsx"; ` +
        `filename*=UTF-8''${encodeURIComponent(`${scope}-${stamp}.xlsx`)}`
    );
    res.send(Buffer.from(buf));
  } catch (err) {
    next(err);
  }
});

router.get('/new', (req, res) => {
  if (needCategories(req, res)) return;
  const known = categories.activeKeys();
  const category = known.includes(req.query.category) ? req.query.category : known[0] || '';
  res.render(
    'admin/product-form',
    formContext(
      req,
      {
        category,
        // A draft from a sales account is never live on save.
        is_active: roles.canPublishProducts(req.user) ? 1 : 0,
        sort_order: products.nextSortOrder(category),
      },
      true,
      null,
      []
    )
  );
});

router.get('/:id/edit', (req, res, next) => {
  const product = products.q.byId.get(req.params.id);
  if (!product) return next();
  res.render(
    'admin/product-form',
    formContext(req, product, false, null, docs.q.forProduct.all(product.id))
  );
});

router.post('/', uploadSingle('image'), (req, res) => {
  if (needCategories(req, res)) return removeUpload(publicPath(req.file?.filename));
  const row = applyPublishRules(req, products.fromForm(req.body), null);
  if (!row.name_en) {
    removeUpload(publicPath(req.file?.filename));
    return res
      .status(400)
      .render('admin/product-form', formContext(req, row, true, '产品英文名字为必填项。', []));
  }
  // The name inside its category identifies the product — to the importer and
  // now to the database. Say so here rather than let the unique index turn it
  // into an error page.
  const clash = products.findByIdentity(row.category, row.name_en);
  if (clash) {
    removeUpload(publicPath(req.file?.filename));
    return res.status(400).render(
      'admin/product-form',
      formContext(req, row, true,
        `「${categories.nameOf(row.category)}」下已经有一个叫「${row.name_en}」的产品（#${clash.id}）。` +
        '请改个名字，或者直接编辑那一个。', [])
    );
  }
  row.image_path = req.file ? publicPath(req.file.filename) : '';
  const id = products.saveWithLog(
    () => Number(products.q.insert.run(row).lastInsertRowid),
    (newId) => productlog.record(req, { action: 'create', product: { ...row, id: newId } })
  );
  const note = row.is_active
    ? '已新增产品 #' + id
    : '已新增产品 #' + id + '（下架状态，需管理员上架后客户才看得到）';
  res.redirect(`/admin/products?category=${row.category}&ok=${encodeURIComponent(note)}`);
});

/**
 * Renumbers a category 1, 2, 3 … in its current display order. Administrators
 * only: it rewrites every row in the category, and the order itself is a
 * catalogue-wide decision. Logged once rather than once per product.
 */
router.post('/renumber', (req, res) => {
  if (denyUnlessAdmin(req, res, '只有管理员可以重新编号。')) return;
  const one = categories.keys().includes(req.body.category) ? req.body.category : null;
  const keys = one ? [one] : categories.keys();
  // All of the categories or none of them. Renumbering each in its own
  // transaction meant a failure halfway through "全部分类" left some ordered
  // and some not, with a log that agreed with neither.
  const total = products.saveWithLog(
    () => {
      let n = 0;
      for (const key of keys) {
        const renamed = products.renumber(key);
        if (!renamed) continue;
        n += renamed;
        productlog.record(req, {
          action: 'reorder',
          category: key,
          note: `重新编号「${categories.nameOf(key)}」：${renamed} 个产品按当前顺序排成 1…${renamed}`,
        });
      }
      return n;
    },
    () => {}
  );
  res.redirect(
    `/admin/products${one ? '?category=' + one + '&' : '?'}ok=` +
      encodeURIComponent(total ? `已重新编号 ${total} 个产品` : '没有可编号的产品')
  );
});

router.post('/:id', uploadSingle('image'), (req, res, next) => {
  const existing = products.q.byId.get(req.params.id);
  if (!existing) {
    removeUpload(publicPath(req.file?.filename));
    return next();
  }
  if (needCategories(req, res)) return removeUpload(publicPath(req.file?.filename));
  const row = applyPublishRules(req, products.fromForm(req.body), existing);
  if (!row.name_en) {
    removeUpload(publicPath(req.file?.filename));
    return res
      .status(400)
      .render(
        'admin/product-form',
        formContext(
          req,
          { ...existing, ...row },
          false,
          '产品英文名字为必填项。',
          docs.q.forProduct.all(existing.id)
        )
      );
  }

  // Work out the new image first, but do not touch the old file yet: a file
  // deleted before the row is written cannot be put back if the write fails.
  let replaced = '';
  const clash = products.findByIdentity(row.category, row.name_en, existing.id);
  if (clash) {
    removeUpload(publicPath(req.file?.filename));
    return res.status(400).render(
      'admin/product-form',
      formContext(req, { ...existing, ...row }, false,
        `「${categories.nameOf(row.category)}」下已经有一个叫「${row.name_en}」的产品（#${clash.id}）。` +
        '请改个名字，或者直接编辑那一个。',
        docs.q.forProduct.all(existing.id))
    );
  }

  if (req.file) {
    row.image_path = publicPath(req.file.filename);
    replaced = existing.image_path;
  } else if (req.body.remove_image) {
    row.image_path = '';
    replaced = existing.image_path;
  } else {
    row.image_path = existing.image_path;
  }

  const changes = products.saveWithLog(
    () => {
      products.q.update.run({ ...row, id: existing.id });
      return productlog.recordUpdate(req, existing, { ...row, id: existing.id });
    },
    () => {}
  );
  // Committed: now the old file is genuinely unreferenced.
  if (replaced) removeUpload(replaced);
  const note = changes.length
    ? '已保存产品 #' + existing.id + '（改了 ' + changes.length + ' 项）'
    : '产品 #' + existing.id + ' 没有变化';
  res.redirect(`/admin/products?category=${row.category}&ok=${encodeURIComponent(note)}`);
});

router.post('/:id/delete', (req, res, next) => {
  if (denyUnlessAdmin(req, res, '只有管理员可以删除产品。业务员可以修改产品，或请管理员下架。')) return;
  const existing = products.q.byId.get(req.params.id);
  if (!existing) return next();
  // Read the filenames before the rows go (ON DELETE CASCADE takes them with
  // the product), but delete nothing on disk until the transaction commits.
  const files = docs.q.forProduct.all(existing.id).map((d) => d.filename);
  products.saveWithLog(
    () => products.q.remove.run(existing.id),
    () => productlog.record(req, { action: 'delete', product: existing })
  );
  for (const f of files) docs.removeFile(f);
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
  const label = String(req.body.label || '').trim().slice(0, 40) || '文档';
  docs.q.insert.run({
    product_id: product.id,
    label,
    filename: req.file.filename,
    original: String(req.file.originalname || '').slice(0, 150),
    size_bytes: req.file.size,
  });
  productlog.record(req, {
    action: 'doc_add',
    product,
    note: `上传文档：${label} · ${String(req.file.originalname || '').slice(0, 80)}`,
  });
  res.redirect(`/admin/products/${product.id}/edit?ok=` + encodeURIComponent('文档已上传'));
});

router.post('/:id/docs/:docId/delete', (req, res, next) => {
  if (denyUnlessAdmin(req, res, '只有管理员可以删除产品文档。')) return;
  const product = products.q.byId.get(req.params.id);
  const doc = docs.q.byId.get(req.params.docId);
  if (!product || !doc || doc.product_id !== product.id) return next();
  productlog.record(req, {
    action: 'doc_remove',
    product,
    note: `删除文档：${doc.label} · ${doc.original}`,
  });
  docs.remove(doc.id);
  res.redirect(`/admin/products/${product.id}/edit?ok=` + encodeURIComponent('文档已删除'));
});

module.exports = router;
