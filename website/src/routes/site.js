'use strict';
const fs = require('fs');
const express = require('express');
const config = require('../config');
const settings = require('../lib/settings');
const products = require('../lib/products');
const staff = require('../lib/staff');
const docs = require('../lib/docs');
const inquiry = require('../lib/inquiry');
const accesslog = require('../lib/accesslog');
const mailer = require('../lib/mailer');
const { requireAuth } = require('../lib/auth');
const usersLib = require('../lib/users');

const router = express.Router();

// Guards are attached per route: this router is mounted at "/", so a blanket
// `router.use(requireAuth)` would also swallow /healthz and every 404.

// The header shows the inquiry count on every page, so it cannot be a local of
// just the two routes that happened to need it first.
router.use((req, res, next) => {
  res.locals.basket = req.user ? inquiry.readBasket(req) : [];
  next();
});

/**
 * Only allow redirects back into this site, and drop any `ok` already on the
 * URL — otherwise every add-to-inquiry appends another one and the flash grows
 * into "added…,added…,added…" while the address bar fills with duplicates.
 */
function safeBack(value, fallback) {
  const v = String(value || '');
  if (!/^\/(?!\/)/.test(v)) return fallback;
  const [path, query = ''] = v.split('?');
  const params = new URLSearchParams(query);
  params.delete('ok');
  const rest = params.toString();
  return rest ? `${path}?${rest}` : path;
}

/** Appends a one-off message to a path that may or may not already have a query. */
function withFlash(path, message) {
  return path + (path.includes('?') ? '&' : '?') + 'ok=' + encodeURIComponent(message);
}

/**
 * The rep a customer should talk to: whoever issued their login, falling back
 * to the first published contact card so the button is never a dead end for
 * accounts an administrator created.
 */
function repFor(user) {
  const managed = usersLib.accountManagerOf(user);
  if (managed && managed.card) {
    return { name: managed.card.name, title: managed.card.title, card: managed.card, owned: true };
  }
  if (managed) {
    // A sales account with no card linked yet — name them, but no number.
    return { name: managed.owner.display_name || managed.owner.username, title: '', card: null, owned: true };
  }
  const fallback = staff.q.listActive.all().find((m) => m.whatsapp);
  return fallback ? { name: fallback.name, title: fallback.title, card: fallback, owned: false } : null;
}

/** A wa.me link, optionally carrying a prefilled message. */
function waLinkWithText(whatsapp, text) {
  const digits = String(whatsapp || '').replace(/\D/g, '');
  if (!digits) return '';
  const base = 'https://wa.me/' + digits;
  return text ? base + '?text=' + encodeURIComponent(text) : base;
}

/** The inquiry, written out for WhatsApp. */
function inquiryText(user, rows, quantities, notes) {
  const lines = [
    'Hello' + (user.display_name ? ', this is ' + user.display_name : '') + '.',
    'I would like a quotation for:',
    '',
  ];
  rows.forEach((p, i) => {
    const bits = [`${i + 1}. ${p.name_en}`];
    if (quantities[p.id]) bits.push(`Qty: ${quantities[p.id]}`);
    if (notes[p.id]) bits.push(notes[p.id]);
    lines.push(bits.join(' — '));
  });
  lines.push('', 'Account: ' + user.username);
  return lines.join('\n');
}

// Product list page: one page, three anchored category sections, one search box.
router.get('/products', requireAuth, (req, res) => {
  const search = String(req.query.q || '').trim().slice(0, 80);
  const sectionTitles = settings.sectionTitles();
  const sections = config.CATEGORIES.map((cat) => ({
    ...cat,
    title: sectionTitles[cat.key],
    rows: products.publicList(cat.key, search),
  }));

  const allIds = sections.flatMap((s) => s.rows.map((r) => r.id));
  res.render('products', {
    settings: settings.all(),
    sections,
    search,
    totalFound: sections.reduce((n, s) => n + s.rows.length, 0),
    fieldLabels: config.FIELD_LABELS,
    docsByProduct: docs.byProduct(allIds),
    humanSize: docs.humanSize,
    basket: inquiry.readBasket(req),
    currentUrl: req.originalUrl,
    flash: String(req.query.ok || '').slice(0, 120),
  });
});

router.get('/contact', requireAuth, (_req, res) => {
  res.render('contact', {
    settings: settings.all(),
    team: staff.q.listActive.all(),
    waLink: staff.waLink,
  });
});

/* ---------------------------------------------------------------------------
 * Spec sheets. Stored outside public/, so this route is the only way to them
 * and every download is attributable.
 * ------------------------------------------------------------------------- */
router.get('/docs/:id', requireAuth, (req, res, next) => {
  const doc = docs.q.byId.get(req.params.id);
  if (!doc) return next();
  const full = docs.filePath(doc.filename);
  if (!full || !fs.existsSync(full)) return next();

  const product = products.q.byId.get(doc.product_id);
  accesslog.record(req, 'doc_download', {
    path: `/docs/${doc.id} (${product ? product.name_en : '已删除产品'} · ${doc.label || '文档'})`,
  });
  res.download(full, docs.downloadName(doc, product));
});

/* ---------------------------------------------------------------------------
 * Inquiry basket
 * ------------------------------------------------------------------------- */
router.post('/inquiry/add', requireAuth, (req, res) => {
  const id = Number.parseInt(req.body.product_id, 10);
  const back = safeBack(req.body.back, '/products');
  const product = Number.isInteger(id) ? products.q.byId.get(id) : null;
  if (!product || !product.is_active) {
    return res.redirect(back);
  }
  const basket = inquiry.readBasket(req);
  const already = basket.includes(id);
  if (!already && basket.length >= inquiry.MAX_ITEMS) {
    return res.redirect(withFlash(back, 'Your inquiry list is full.'));
  }
  if (!already) inquiry.writeBasket(res, basket.concat(id));
  return res.redirect(withFlash(back, `${product.name_en} added to your inquiry list.`));
});

router.post('/inquiry/remove', requireAuth, (req, res) => {
  const id = Number.parseInt(req.body.product_id, 10);
  const back = safeBack(req.body.back, '/inquiry');
  inquiry.writeBasket(res, inquiry.readBasket(req).filter((x) => x !== id));
  return res.redirect(back);
});

router.post('/inquiry/clear', requireAuth, (req, res) => {
  inquiry.clearBasket(res);
  return res.redirect('/inquiry');
});

router.get('/inquiry', requireAuth, (req, res) => {
  const ids = inquiry.readBasket(req);
  const rows = ids.map((id) => products.q.byId.get(id)).filter(Boolean);
  const rep = repFor(req.user);
  res.render('inquiry', {
    settings: settings.all(),
    rows,
    basket: ids,
    error: null,
    form: {
      company: req.user.display_name || '',
      contact_name: '',
      email: '',
      phone: '',
      country: '',
      message: '',
    },
    quantities: {},
    notes: {},
    rep,
    waChat: rep && rep.card ? waLinkWithText(rep.card.whatsapp, '') : '',
    waInquiry:
      rep && rep.card && rows.length
        ? waLinkWithText(rep.card.whatsapp, inquiryText(req.user, rows, {}, {}))
        : '',
  });
});

router.post('/inquiry', requireAuth, async (req, res) => {
  const ids = inquiry.readBasket(req);
  const rows = ids.map((id) => products.q.byId.get(id)).filter(Boolean);

  const form = {
    company: String(req.body.company || '').trim().slice(0, 150),
    contact_name: String(req.body.contact_name || '').trim().slice(0, 100),
    email: String(req.body.email || '').trim().slice(0, 150),
    phone: String(req.body.phone || '').trim().slice(0, 60),
    country: String(req.body.country || '').trim().slice(0, 80),
    message: String(req.body.message || '').trim().slice(0, 2000),
  };
  const quantities = {};
  const notes = {};
  for (const r of rows) {
    quantities[r.id] = String(req.body['qty_' + r.id] || '').trim().slice(0, 60);
    notes[r.id] = String(req.body['note_' + r.id] || '').trim().slice(0, 300);
  }

  const rep = repFor(req.user);
  const reject = (message) =>
    res.status(400).render('inquiry', {
      settings: settings.all(),
      rows,
      basket: ids,
      error: message,
      form,
      quantities,
      notes,
      rep,
      waChat: rep && rep.card ? waLinkWithText(rep.card.whatsapp, '') : '',
      waInquiry:
        rep && rep.card && rows.length
          ? waLinkWithText(rep.card.whatsapp, inquiryText(req.user, rows, quantities, notes))
          : '',
    });

  if (!rows.length) return reject('Your inquiry list is empty. Add products from the catalogue first.');
  if (!form.email) return reject('Please provide an email address so we can reply.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return reject('Please check the email address.');

  const id = inquiry.create(
    {
      user_id: req.user.id,
      username: req.user.username,
      ...form,
      ip: accesslog.clientIp(req),
    },
    rows.map((r) => ({
      product_id: r.id,
      name_en: r.name_en,
      category: r.category,
      quantity: quantities[r.id] || '',
      note: notes[r.id] || '',
    }))
  );

  accesslog.record(req, 'inquiry_submitted', {
    path: `/inquiry #${id} (${rows.length} 个产品)`,
  });
  inquiry.clearBasket(res);

  // Never let a mail problem turn a saved inquiry into an error page.
  mailer
    .notifyInquiry(
      { ...form, username: req.user.username },
      rows.map((r) => ({ name_en: r.name_en, quantity: quantities[r.id], note: notes[r.id] })),
      staff.q.listActive.all().map((m) => m.email).filter(Boolean)
    )
    .catch(() => {});

  return res.redirect('/inquiry/sent?id=' + id);
});

router.get('/inquiry/sent', requireAuth, (req, res) => {
  const rep = repFor(req.user);
  res.render('inquiry-sent', {
    settings: settings.all(),
    reference: String(req.query.id || '').slice(0, 12),
    rep,
    waChat: rep && rep.card ? waLinkWithText(rep.card.whatsapp, '') : '',
  });
});

module.exports = router;
