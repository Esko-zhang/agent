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
const categories = require('../lib/categories');
const { requireAuth } = require('../lib/auth');
const roles = require('../lib/roles');
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
  if (!v.startsWith('/')) return fallback;
  let u;
  try {
    // Same reason as safeNext in routes/auth.js: a regex cannot see that a
    // browser reads "/\evil.com" as "//evil.com".
    const base = 'http://durlevel.invalid';
    u = new URL(v, base);
    if (u.origin !== base) return fallback;
  } catch {
    return fallback;
  }
  u.searchParams.delete('ok');
  const rest = u.searchParams.toString();
  return rest ? `${u.pathname}?${rest}` : u.pathname;
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
  // Categories are rows now, so the public page simply follows whatever the
  // administrator has published, in their order.
  const sections = categories.active().map((cat) => ({
    ...cat,
    rows: products.publicList(cat.key, search),
  }));

  const allIds = sections.flatMap((s) => s.rows.map((r) => r.id));
  res.render('products', {
    settings: settings.all(),
    sections,
    // The title block's revision cell: when this catalogue last actually
    // changed, not when the page was opened. A catalogue with nothing
    // published in it has no revision to show.
    catalogue: { revised: products.lastPublishedAt() || '—' },
    search,
    totalFound: sections.reduce((n, s) => n + s.rows.length, 0),
    fieldLabels: config.FIELD_LABELS,
    docsByProduct: docs.byProduct(allIds),
    humanSize: docs.humanSize,
    // '' for a Word or Excel file, so the template can tell a sheet that can
    // be read in place from one that can only be downloaded.
    docPreview: docs.previewKind,
    docPreviewUrl: docs.previewUrl,
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
/** Both routes need the file on disk and the product it belongs to. */
function loadDoc(req) {
  const doc = docs.q.byId.get(req.params.id);
  if (!doc) return null;
  const product = products.q.byId.get(doc.product_id);
  // A document is only as visible as the product it hangs off. The catalogue
  // filters on is_active and this route did not, so a draft a sales account
  // had not had approved yet was hidden from the listing while its TDS stayed
  // one guessable id away — and a deleted product's files stayed downloadable
  // for good. Backend accounts still see both, which is how they review them.
  if (!product) return null;
  if (!product.is_active && !roles.hasBackend(req.user)) return null;
  const full = docs.filePath(doc.filename);
  if (!full || !fs.existsSync(full)) return null;
  return { doc, full, product };
}

/** "/docs/3 (Vitamin C 1000mg Tablets · TDS)" — readable in the access log. */
function docLogPath(doc, product, suffix = '') {
  const name = product ? product.name_en : '已删除产品';
  return `/docs/${doc.id}${suffix} (${name} · ${doc.label || '文档'})`;
}

/**
 * Reading a spec sheet in place.
 *
 * A buyer comparing six products should not have to collect six files in a
 * downloads folder to look at them. PDFs and images are therefore served
 * inline here, and the viewer shows them over the catalogue; Word and Excel
 * have no browser renderer, so they are not served by this route at all and
 * the viewer offers the download instead.
 *
 * It is the same gate as the download: signed in, and recorded — opening a
 * TDS is a buying signal whether or not the file ends up on disk.
 */
function sendPreview(req, res, next) {
  const found = loadDoc(req);
  if (!found) return next();
  const kind = docs.previewOf(found.doc);
  if (!kind) return next();

  accesslog.record(req, 'doc_preview', {
    path: docLogPath(found.doc, found.product, '/preview'),
  });

  res.type(kind.type);
  // inline, not attachment: this response is meant to be rendered, not saved.
  // The filename still travels, so "save as" from the viewer names it properly.
  res.setHeader(
    'Content-Disposition',
    `inline; filename*=UTF-8''${encodeURIComponent(docs.downloadName(found.doc, found.product))}`
  );
  // The site frames nothing but itself, and the global DENY would stop even
  // that — a same-origin PDF needs its own frame rules to render in place.
  // Only the framing rule is relaxed: a stricter default-src on a PDF response
  // is a known way to break Firefox's built-in reader, and buys nothing here
  // because the type is one this module chose and nosniff is already set.
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
  res.sendFile(found.full);
}

// The trailing name is ignored by the handler and read by nobody but the
// browser's own PDF reader, which puts the last path segment in its title bar:
// without it a buyer looking at a spec sheet sees the word "preview" there.
router.get('/docs/:id/preview', requireAuth, sendPreview);
router.get('/docs/:id/preview/:name', requireAuth, sendPreview);

router.get('/docs/:id', requireAuth, (req, res, next) => {
  const found = loadDoc(req);
  if (!found) return next();

  accesslog.record(req, 'doc_download', {
    path: docLogPath(found.doc, found.product),
  });
  res.download(found.full, docs.downloadName(found.doc, found.product));
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

  const header = {
    user_id: req.user.id,
    username: req.user.username,
    ...form,
    ip: accesslog.clientIp(req),
  };
  const items = rows.map((r) => ({
    product_id: r.id,
    name_en: r.name_en,
    category: r.category,
    quantity: quantities[r.id] || '',
    note: notes[r.id] || '',
  }));

  // A double-click should send one inquiry, not two. If the identical thing
  // arrived moments ago, treat this as the same submission and show the same
  // confirmation rather than filing it again.
  const already = inquiry.recentDuplicate(req.user.id, inquiry.fingerprintOf(header, items));
  if (already) {
    inquiry.clearBasket(res);
    return res.redirect('/inquiry/sent?id=' + already.id);
  }

  const id = inquiry.create(header, items);

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
