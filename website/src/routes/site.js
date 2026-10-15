'use strict';
const express = require('express');
const config = require('../config');
const settings = require('../lib/settings');
const products = require('../lib/products');
const staff = require('../lib/staff');
const { requireAuth } = require('../lib/auth');

const router = express.Router();

// Guards are attached per route: this router is mounted at "/", so a blanket
// `router.use(requireAuth)` would also swallow /healthz and every 404.
// Product list page: one page, three anchored category sections, one search box.
router.get('/products', requireAuth, (req, res) => {
  const search = String(req.query.q || '').trim().slice(0, 80);
  const sectionTitles = settings.sectionTitles();
  const sections = config.CATEGORIES.map((cat) => ({
    ...cat,
    title: sectionTitles[cat.key],
    rows: products.publicList(cat.key, search),
  }));
  res.render('products', {
    settings: settings.all(),
    sections,
    search,
    totalFound: sections.reduce((n, s) => n + s.rows.length, 0),
    fieldLabels: config.FIELD_LABELS,
  });
});

router.get('/contact', requireAuth, (_req, res) => {
  res.render('contact', {
    settings: settings.all(),
    team: staff.q.listActive.all(),
    waLink: staff.waLink,
  });
});

module.exports = router;
