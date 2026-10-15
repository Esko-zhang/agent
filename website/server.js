'use strict';
const path = require('path');
const express = require('express');
const multer = require('multer');
const config = require('./src/config');
const { sessionMiddleware } = require('./src/lib/session');
const { csrfMiddleware } = require('./src/lib/csrf');
const { loadUser } = require('./src/lib/auth');

const app = express();

if (config.trustProxy) app.set('trust proxy', 1);
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

if (require.main === module) {
  app.listen(config.port, config.host, () => {
    console.log(`Durlevel site listening on http://${config.host}:${config.port}`);
    if (!config.isProd) console.log('NODE_ENV is not "production" — dev defaults in use.');
  });
}

module.exports = app;
