'use strict';
const path = require('path');
const express = require('express');
const multer = require('multer');
const config = require('./src/config');
const { sessionMiddleware } = require('./src/lib/session');
const { csrfMiddleware } = require('./src/lib/csrf');
const { loadUser } = require('./src/lib/auth');
const accesslog = require('./src/lib/accesslog');
const settings = require('./src/lib/settings');
const { assetUrl } = require('./src/lib/assets');

const app = express();

// How many proxies to trust in front of us; see parseTrustProxy in config.js.
if (config.trustProxy !== false) app.set('trust proxy', config.trustProxy);
// Every template builds its asset URLs through this, so a deploy is never
// hidden behind a stale browser cache.
app.locals.assetUrl = assetUrl;
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

// Conservative security headers; no CDN or inline-script reliance in the views.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'"
  );
  next();
});

app.use(express.urlencoded({ extended: false, limit: '256kb' }));
app.use(sessionMiddleware);
// loadUser must precede csrfMiddleware: a rejected CSRF check renders a view
// that expects `currentUser` to already be in res.locals.
app.use(loadUser);
app.use(csrfMiddleware);

// Static assets. Uploads are user content, so they are served with nosniff
// and never executed.
app.use(
  express.static(path.join(__dirname, 'public'), {
    maxAge: config.isProd ? '7d' : 0,
    index: false,
  })
);

/**
 * Records a page view once the response is on its way out, so only requests
 * that actually produced a page are logged. Static assets never reach here:
 * express.static answers them above. Anonymous hits are skipped — the site is
 * login-gated, and logging them would fill the table with bot traffic; failed
 * sign-in attempts are recorded by the login route instead.
 */
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  res.on('finish', () => {
    if (!req.user || res.statusCode >= 400) return;
    if (req.path === '/healthz') return;
    if (!String(res.getHeader('content-type') || '').includes('text/html')) return;
    accesslog.record(req, 'page_view');
  });
  return next();
});

app.use('/', require('./src/routes/auth'));
app.use('/', require('./src/routes/site'));
app.use('/admin', require('./src/routes/admin'));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// 404
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Page not found',
    message: 'The page you requested does not exist.',
  });
});

// Errors, including upload rejections from multer.
app.use((err, req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `图片过大，单张不得超过 ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB。`
        : '只允许上传 JPG / PNG / WebP / GIF 格式的图片。';
    return res.status(400).render('error', { title: 'Upload rejected', message });
  }
  console.error('[error]', err);
  res.status(500).render('error', {
    title: 'Server error',
    message: 'Something went wrong. Please try again.',
  });
});

/** Drops access-log rows past the retention window the admin configured. */
function purgeOldLogs() {
  const days = Number(settings.get('log_retention_days'));
  if (!Number.isFinite(days) || days <= 0) return;
  const removed = accesslog.purgeOlderThan(days);
  if (removed) console.log(`[accesslog] purged ${removed} row(s) older than ${days} days`);
}

if (require.main === module) {
  purgeOldLogs();
  // Re-check daily; unref so the timer never holds the process open.
  setInterval(purgeOldLogs, 24 * 60 * 60 * 1000).unref();

  app.listen(config.port, config.host, () => {
    console.log(`Durlevel site listening on http://${config.host}:${config.port}`);
    if (!config.isProd) console.log('NODE_ENV is not "production" — dev defaults in use.');
    if (config.trustProxy === false) {
      console.log('TRUST_PROXY is off — behind Nginx set it to 1 so the access log records real client IPs.');
    } else {
      console.log(`Trusting proxy setting: ${config.trustProxy}`);
    }
  });
}

module.exports = app;
