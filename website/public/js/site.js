'use strict';
/**
 * The catalogue's one piece of motion, and the sheet counter in the margin.
 *
 * Both are decoration over a page that is already complete: the rules are
 * drawn in CSS and simply start undrawn once this file announces itself, and
 * the counter is an empty element until it is filled here. Without the script,
 * or with `prefers-reduced-motion: reduce`, the page is the same page — every
 * rule present, nothing hidden.
 *
 * There is no scroll handler and no animation frame loop: an
 * IntersectionObserver tells us when a sheet arrives, which is the only moment
 * either of these needs to do anything.
 */
(function () {
  var sections = Array.prototype.slice.call(
    document.querySelectorAll('.product-section')
  );
  if (!sections.length || typeof IntersectionObserver !== 'function') return;

  /* ---- The signature: each sheet's rule draws itself once, on arrival ---- */
  // Announcing support here, rather than in the markup, is what guarantees the
  // rules are visible when this file fails to load.
  document.documentElement.classList.add('js-draw');

  var heads = sections
    .map(function (s) { return s.querySelector('.section-head'); })
    .filter(Boolean);

  var drawer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-drawn');
      drawer.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.01 });

  heads.forEach(function (head) { drawer.observe(head); });

  // The first sheet is already on screen before the observer's first callback
  // on some browsers; draw it immediately so the page never opens mid-draw.
  if (heads[0]) heads[0].classList.add('is-drawn');

  /* ---- The margin counter: which sheet am I reading? ---- */
  var counter = document.getElementById('sheet-counter');
  if (!counter) return;

  var total = sections.length;
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };

  var num = document.createElement('span');
  num.className = 'num';
  var of = document.createElement('span');
  of.className = 'of';
  of.textContent = 'of ' + pad(total);
  var label = document.createElement('span');
  label.className = 'label';
  counter.appendChild(num);
  counter.appendChild(of);
  counter.appendChild(label);

  var current = -1;
  function show(index) {
    if (index === current) return;
    current = index;
    var section = sections[index];
    var head = section.querySelector('.section-head h2');
    num.textContent = pad(index + 1);
    // The short name if the section carries one — the heading is the long
    // form and would wrap to four lines in a 96px margin.
    label.textContent =
      section.getAttribute('data-sheet') || (head ? head.textContent.trim() : '');
  }
  show(0);

  // A sheet becomes the current one while its top third of the viewport holds
  // it; the band is narrow so the number changes at a definite moment rather
  // than drifting between two sheets.
  var tracker = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var i = sections.indexOf(entry.target);
      if (i !== -1) show(i);
    });
  }, { rootMargin: '-25% 0px -70% 0px', threshold: 0 });

  sections.forEach(function (s) { tracker.observe(s); });
})();
