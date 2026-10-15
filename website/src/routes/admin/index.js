'use strict';
const express = require('express');
const { requireAdmin } = require('../../lib/auth');
const products = require('../../lib/products');
const staff = require('../../lib/staff');
const { q: userQ } = require('../../lib/users');
const settings = require('../../lib/settings');
const config = require('../../config');

const router = express.Router();

router.use(requireAdmin);

// Shared view context for every admin page.
router.use((req, res, next) => {
  res.locals.settings = settings.all();
  res.locals.newInquiries = require('../../lib/inquiry').q.newCount.get().n;
  res.locals.categories = config.CATEGORIES;
  res.locals.fieldLabels = config.FIELD_LABELS;
  res.locals.flash = req.query.ok || null;
  next();
});

router.get('/', (_req, res) => {
  const counts = Object.fromEntries(products.q.countByCategory.all().map((r) => [r.category, r.n]));
  res.render('admin/dashboard', {
    nav: 'dashboard',
    counts,
    totalProducts: Object.values(counts).reduce((a, b) => a + b, 0),
    staffCount: staff.q.count.get().n,
    users: userQ.list.all(),
  });
});

router.use('/products/import', require('./import'));
router.use('/products', require('./products'));
router.use('/staff', require('./staff'));
router.use('/users', require('./users'));
router.use('/inquiries', require('./inquiries'));
router.use('/intent', require('./intent'));
router.use('/logs', require('./logs'));
router.use('/settings', require('./settings'));

module.exports = router;
