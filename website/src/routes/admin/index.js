'use strict';
const express = require('express');
const { requireBackend, requireSection, requireAdmin } = require('../../lib/auth');
const roles = require('../../lib/roles');
const products = require('../../lib/products');
const staff = require('../../lib/staff');
const { q: userQ } = require('../../lib/users');
const settings = require('../../lib/settings');
const config = require('../../config');

const router = express.Router();

// Everything below needs a staff account; each section is then checked against
// the role table, so a sales account cannot reach an admin-only page by URL.
router.use(requireBackend);

// Shared view context for every admin page.
router.use((req, res, next) => {
  res.locals.settings = settings.all();
  // The sidebar badge counts only the inquiries this account may open.
  const inquiryLib = require('../../lib/inquiry');
  if (roles.isAdmin(req.user)) {
    res.locals.newInquiries = inquiryLib.q.newCount.get().n;
  } else {
    const mine = roles.ownedAccounts(req.user, userQ.list.all()).map((u) => u.username);
    res.locals.newInquiries = inquiryLib.list({ status: 'new', usernames: mine },
      { limit: 1, offset: 0 }).total;
  }
  // Drafts a sales account left unpublished — the administrator's review
  // queue, shown as a badge on 产品管理 and a tile on the dashboard.
  res.locals.pendingProducts = roles.isAdmin(req.user)
    ? require('../../lib/productlog').pendingReview()
    : 0;
  res.locals.categories = config.CATEGORIES;
  res.locals.fieldLabels = config.FIELD_LABELS;
  res.locals.flash = req.query.ok || null;
  res.locals.roles = roles;
  res.locals.visibleSections = roles.sectionsFor(req.user);
  next();
});

router.get('/', (req, res) => {
  const counts = Object.fromEntries(products.q.countByCategory.all().map((r) => [r.category, r.n]));

  res.render('admin/dashboard', {
    nav: 'dashboard',
    counts,
    totalProducts: Object.values(counts).reduce((a, b) => a + b, 0),
    staffCount: staff.q.count.get().n,
    inactiveProducts: products.q.listAll.all().filter((p) => !p.is_active).length,
    // A sales account only ever sees the customers it issued.
    users: roles.ownedAccounts(req.user, userQ.list.all()),
  });
});

// The Excel import can rewrite many products in one go, so it stays with the
// administrators even though 产品管理 itself is now open to sales.
router.use('/products/import', requireAdmin, require('./import'));
router.use('/products', requireSection('products'), require('./products'));
router.use('/staff', requireSection('staff'), require('./staff'));
router.use('/users', requireSection('users'), require('./users'));
router.use('/inquiries', requireSection('inquiries'), require('./inquiries'));
router.use('/intent', requireSection('intent'), require('./intent'));
router.use('/logs', requireSection('logs'), require('./logs'));
router.use('/contacts', requireSection('contacts'), require('./contacts'));
router.use('/changes', requireSection('changes'), require('./changes'));
router.use('/settings', requireSection('settings'), require('./settings'));

module.exports = router;
