'use strict';
/**
 * The viewer: look at a photograph, a product shot or a spec sheet without
 * leaving the page, and get close enough to read it.
 *
 * A buyer comparing six products should not have to collect six files in a
 * downloads folder to look at them, and a 56px thumbnail of a tablet is not a
 * photograph of anything. So anything worth seeing opens here instead.
 *
 * It is built as progressive enhancement. Every trigger is a real link to the
 * real file, so with this script blocked — which a strict corporate proxy will
 * do — clicking still opens the image or the PDF in a tab. Nothing is hidden
 * behind JavaScript; this only makes it nicer.
 *
 * Two modes:
 *   image  our own canvas-free zoom, because browsers do not give an <img>
 *          one: wheel, pinch, buttons, double-click, +/- keys; drag to pan.
 *   pdf    an <iframe>, because the browser's own PDF viewer already zooms,
 *          searches and prints, and nothing we wrote would be better.
 *
 * Word and Excel never reach here. There is no browser renderer for them, so
 * their triggers stay plain download links rather than opening an empty frame.
 */
(function () {
  var MIN = 1, MAX = 8;
  var ui = null;          // built once, on first use
  var state = null;       // { kind, scale, x, y, natural }
  var lastFocus = null;

  var reduced = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function build() {
    var root = el('div', 'viewer');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.hidden = true;

    var bar = el('div', 'viewer-bar');
    var title = el('p', 'viewer-title');
    title.id = 'viewer-title';
    root.setAttribute('aria-labelledby', title.id);

    var tools = el('div', 'viewer-tools');
    var out = el('span', 'viewer-zoom');          // the live reading, e.g. 240%
    var zoomOut = el('button', 'viewer-btn', '−');
    var zoomIn = el('button', 'viewer-btn', '+');
    var reset = el('button', 'viewer-btn viewer-btn-wide', 'Fit');
    var open = el('a', 'viewer-btn viewer-btn-wide', 'Open');
    var save = el('a', 'viewer-btn viewer-btn-wide', 'Download');
    var close = el('button', 'viewer-btn viewer-btn-close', '✕');

    zoomOut.type = zoomIn.type = reset.type = close.type = 'button';
    zoomOut.setAttribute('aria-label', 'Zoom out');
    zoomIn.setAttribute('aria-label', 'Zoom in');
    reset.setAttribute('aria-label', 'Fit to screen');
    close.setAttribute('aria-label', 'Close');
    open.target = '_blank';
    open.rel = 'noopener';
    save.setAttribute('download', '');

    tools.appendChild(out);
    tools.appendChild(zoomOut);
    tools.appendChild(zoomIn);
    tools.appendChild(reset);
    tools.appendChild(open);
    tools.appendChild(save);
    tools.appendChild(close);
    bar.appendChild(title);
    bar.appendChild(tools);

    var stage = el('div', 'viewer-stage');
    var img = el('img', 'viewer-image');
    img.alt = '';
    img.draggable = false;
    var frame = el('iframe', 'viewer-frame');
    frame.title = 'Document';
    frame.hidden = true;
    img.hidden = true;
    stage.appendChild(img);
    stage.appendChild(frame);

    var hint = el('p', 'viewer-hint');

    root.appendChild(bar);
    root.appendChild(stage);
    root.appendChild(hint);
    document.body.appendChild(root);

    ui = { root: root, title: title, stage: stage, img: img, frame: frame,
           out: out, reset: reset, open: open, save: save, close: close,
           zoomIn: zoomIn, zoomOut: zoomOut, hint: hint, tools: tools };

    close.addEventListener('click', hide);
    zoomIn.addEventListener('click', function () { zoomBy(1.4); });
    zoomOut.addEventListener('click', function () { zoomBy(1 / 1.4); });
    reset.addEventListener('click', fit);
    // A click on the backdrop closes; a click on the picture does not.
    root.addEventListener('mousedown', function (e) { if (e.target === root || e.target === stage) hide(); });

    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('dblclick', onDoubleClick);
    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', onPointerUp);
    stage.addEventListener('pointercancel', onPointerUp);
    document.addEventListener('keydown', onKey);
    return ui;
  }

  /* ---------------- image transform ---------------- */

  function apply() {
    if (!state || state.kind !== 'image') return;
    ui.img.style.transform =
      'translate(' + state.x + 'px,' + state.y + 'px) scale(' + state.scale + ')';
    ui.out.textContent = Math.round(state.scale * 100) + '%';
    ui.stage.classList.toggle('is-zoomed', state.scale > MIN + 0.001);
    ui.zoomOut.disabled = state.scale <= MIN + 0.001;
    ui.zoomIn.disabled = state.scale >= MAX - 0.001;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /**
   * Keeps whatever sits under the pointer under the pointer. Without this,
   * zooming walks the picture off toward a corner and you chase it.
   */
  function zoomAt(factor, px, py) {
    if (!state || state.kind !== 'image') return;
    var next = clamp(state.scale * factor, MIN, MAX);
    if (next === state.scale) return;
    var rect = ui.stage.getBoundingClientRect();
    var cx = (px == null ? rect.width / 2 : px - rect.left) - rect.width / 2;
    var cy = (py == null ? rect.height / 2 : py - rect.top) - rect.height / 2;
    var ratio = next / state.scale;
    state.x = cx - (cx - state.x) * ratio;
    state.y = cy - (cy - state.y) * ratio;
    state.scale = next;
    if (state.scale === MIN) { state.x = 0; state.y = 0; }
    constrain();
    apply();
  }

  function zoomBy(factor) { zoomAt(factor, null, null); }

  /** At 1x the picture is centred; zoomed in, it may not be dragged off-stage. */
  function constrain() {
    if (!state || state.kind !== 'image') return;
    var r = ui.img.getBoundingClientRect();
    var stageRect = ui.stage.getBoundingClientRect();
    var overX = Math.max(0, (r.width - stageRect.width) / 2);
    var overY = Math.max(0, (r.height - stageRect.height) / 2);
    state.x = clamp(state.x, -overX, overX);
    state.y = clamp(state.y, -overY, overY);
  }

  function fit() {
    if (!state) return;
    state.scale = MIN; state.x = 0; state.y = 0;
    apply();
  }

  function onWheel(e) {
    if (!state || state.kind !== 'image') return;
    e.preventDefault();
    zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX, e.clientY);
  }

  function onDoubleClick(e) {
    if (!state || state.kind !== 'image') return;
    e.preventDefault();
    if (state.scale > MIN + 0.001) fit();
    else zoomAt(2.5, e.clientX, e.clientY);
  }

  /* ---------------- drag to pan, pinch to zoom ---------------- */

  var pointers = new Map();
  var dragFrom = null;
  var pinchFrom = null;

  function onPointerDown(e) {
    if (!state || state.kind !== 'image') return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      dragFrom = { x: e.clientX - state.x, y: e.clientY - state.y, moved: false };
      if (ui.stage.setPointerCapture) {
        try { ui.stage.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      }
    } else if (pointers.size === 2) {
      dragFrom = null;
      pinchFrom = { dist: spread(), scale: state.scale };
    }
  }

  function spread() {
    var p = Array.from(pointers.values());
    return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1;
  }

  function centre() {
    var p = Array.from(pointers.values());
    return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
  }

  function onPointerMove(e) {
    if (!state || state.kind !== 'image' || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2 && pinchFrom) {
      var c = centre();
      var want = clamp(pinchFrom.scale * (spread() / pinchFrom.dist), MIN, MAX);
      zoomAt(want / state.scale, c.x, c.y);
      return;
    }
    if (dragFrom && state.scale > MIN + 0.001) {
      state.x = e.clientX - dragFrom.x;
      state.y = e.clientY - dragFrom.y;
      dragFrom.moved = true;
      constrain();
      apply();
    }
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchFrom = null;
    if (pointers.size === 0) dragFrom = null;
  }

  /* ---------------- keyboard ---------------- */

  function onKey(e) {
    if (!ui || ui.root.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); return hide(); }
    if (e.key === 'Tab') return trapTab(e);
    if (!state || state.kind !== 'image') return;
    var step = 60;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.4); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1 / 1.4); }
    else if (e.key === '0') { e.preventDefault(); fit(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); state.x += step; constrain(); apply(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); state.x -= step; constrain(); apply(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); state.y += step; constrain(); apply(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); state.y -= step; constrain(); apply(); }
  }

  /** Tab must not wander out of an open dialog and onto the page behind it. */
  function trapTab(e) {
    var stops = Array.prototype.filter.call(
      ui.root.querySelectorAll('button, a[href], iframe'),
      function (n) { return !n.disabled && !n.hidden && n.offsetParent !== null; }
    );
    if (!stops.length) return;
    var first = stops[0], last = stops[stops.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ---------------- open / close ---------------- */

  function show(opts) {
    if (!ui) build();
    // The element that opened it, not whatever happened to hold focus: a
    // click does not always move focus, and closing must never drop the
    // reader back at the top of the page.
    lastFocus = opts.from || document.activeElement;
    state = { kind: opts.kind, scale: MIN, x: 0, y: 0 };

    ui.title.textContent = opts.title || '';
    ui.open.href = opts.url;
    ui.save.href = opts.download || opts.url;
    ui.root.classList.toggle('is-still', reduced.matches);

    var isImage = opts.kind === 'image';
    ui.img.hidden = !isImage;
    ui.frame.hidden = isImage;
    ui.zoomIn.hidden = ui.zoomOut.hidden = ui.reset.hidden = ui.out.hidden = !isImage;

    if (isImage) {
      ui.img.alt = opts.title || '';
      ui.img.src = opts.url;
      ui.hint.textContent = '滚轮或双指缩放 · 拖动平移 · 双击放大 · Esc 关闭';
      apply();
    } else {
      ui.frame.src = opts.url;
      ui.frame.title = opts.title || 'Document';
      // The browser's own PDF viewer owns zoom in this mode, so we do not
      // claim to: our buttons would be lying about a frame we cannot reach.
      ui.hint.textContent = '用阅读器自带的工具缩放 · Esc 关闭';
    }

    ui.root.hidden = false;
    document.documentElement.classList.add('viewer-open');
    ui.close.focus();
  }

  function hide() {
    if (!ui || ui.root.hidden) return;
    ui.root.hidden = true;
    document.documentElement.classList.remove('viewer-open');
    // Drop the sources: a 20MB PDF should not sit decoded behind the page.
    ui.img.removeAttribute('src');
    ui.frame.removeAttribute('src');
    state = null;
    pointers.clear();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
  }

  /* ---------------- wiring ---------------- */

  // Delegated, so rows rendered after this script still work.
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-view]') : null;
    if (!t) return;
    // Let a modified click do what the browser would: new tab, save, etc.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    var kind = t.getAttribute('data-view-kind') || 'image';
    if (kind !== 'image' && kind !== 'pdf') return;   // nothing we can render
    e.preventDefault();
    show({
      from: t,
      kind: kind,
      url: t.getAttribute('data-view'),
      download: t.getAttribute('data-view-download') || '',
      title: t.getAttribute('data-view-title') || t.getAttribute('alt') || '',
    });
  });
})();
