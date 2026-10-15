/*
 * Admin progressive enhancement. Loaded as an external file because the site's
 * CSP forbids inline scripts and inline event handlers.
 */
(function () {
  'use strict';

  // Confirmation prompts for destructive forms (`data-confirm="…"`).
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    var message = form.getAttribute('data-confirm');
    if (message && !window.confirm(message)) event.preventDefault();
  });

  // Show only the attribute fields that belong to the selected category.
  var categorySelect = document.querySelector('[data-category-select]');
  if (categorySelect) {
    var toggle = function () {
      var current = categorySelect.value;
      document.querySelectorAll('[data-for-categories]').forEach(function (el) {
        var allowed = el.getAttribute('data-for-categories').split(' ');
        el.hidden = allowed.indexOf(current) === -1;
      });
    };
    categorySelect.addEventListener('change', toggle);
    toggle();
  }

  // Live file-name feedback on image pickers.
  document.querySelectorAll('input[type="file"][data-preview-target]').forEach(function (input) {
    input.addEventListener('change', function () {
      var target = document.getElementById(input.getAttribute('data-preview-target'));
      if (!target) return;
      target.textContent = input.files && input.files.length
        ? '已选择：' + input.files[0].name
        : '';
    });
  });
})();
