/*
 * Keeps the "Send this list on WhatsApp" link in step with the form. The link
 * is rendered server-side so it works without JavaScript, but quantities and
 * notes typed after the page loaded would otherwise be missing from it.
 * Loaded as an external file because the site's CSP forbids inline scripts.
 */
(function () {
  'use strict';

  var link = document.querySelector('[data-wa-inquiry]');
  if (!link) return;

  var base = link.getAttribute('data-wa-base');
  var greeting = link.getAttribute('data-wa-greeting') || '';
  var account = link.getAttribute('data-wa-account') || '';
  if (!base) return;

  function buildText() {
    var lines = [greeting, 'I would like a quotation for:', ''];
    var rows = document.querySelectorAll('[data-rfq-row]');
    Array.prototype.forEach.call(rows, function (row, i) {
      var name = row.getAttribute('data-product-name') || '';
      var qtyEl = row.querySelector('input[name^="qty_"]');
      var noteEl = row.querySelector('input[name^="note_"]');
      var bits = [i + 1 + '. ' + name];
      if (qtyEl && qtyEl.value.trim()) bits.push('Qty: ' + qtyEl.value.trim());
      if (noteEl && noteEl.value.trim()) bits.push(noteEl.value.trim());
      lines.push(bits.join(' — '));
    });
    if (account) lines.push('', 'Account: ' + account);
    return lines.join('\n');
  }

  function refresh() {
    link.href = base + '?text=' + encodeURIComponent(buildText());
  }

  document.addEventListener('input', function (e) {
    if (e.target && /^(qty|note)_/.test(e.target.name || '')) refresh();
  });
  refresh();
})();
