/* ============================================================
   MASTER DASHBOARD · SETTINGS NAV BADGE
   File: settings-badge.js
   Polls /api/config and shows a small "N/3 configured" badge on
   the SETTINGS chip in the top bar. Listens for 'config:changed'
   on window so the badge updates immediately after a save on
   settings.html.
   ============================================================ */

// To trigger an instant refresh from settings.html after a save, dispatch:
//   window.dispatchEvent(new CustomEvent('config:changed'));

(function () {
  'use strict';

  // Inject badge CSS once. Lives here so this feature is a single-file drop-in.
  var style = document.createElement('style');
  style.textContent =
    '.chip-badge {' +
      'display: inline-block;' +
      'margin-left: 6px;' +
      'padding: 1px 6px;' +
      'border-radius: 999px;' +
      'font-family: var(--f-mono);' +
      'font-size: 9px;' +
      'letter-spacing: 0.05em;' +
      'line-height: 1.4;' +
    '}' +
    '#settingsChip[data-configured="ok"]      .chip-badge { background: var(--c-cyan);   color: var(--c-bg); }' +
    '#settingsChip[data-configured="partial"] .chip-badge { background: var(--c-orange); color: var(--c-bg); }' +
    '#settingsChip[data-configured="missing"] .chip-badge { background: var(--c-orange); color: var(--c-bg); }';
  document.head.appendChild(style);

  var chip = document.getElementById('settingsChip');
  var badge = document.getElementById('settingsBadge');
  if (!chip || !badge) return;

  function paint(c) {
    if (!c) return;
    var set =
      (c.minimaxApiKeySet      ? 1 : 0) +
      (c.googleClientIdSet     ? 1 : 0) +
      (c.googleClientSecretSet ? 1 : 0);
    if (set === 0) {
      chip.dataset.configured = 'missing';
      badge.setAttribute('hidden', '');
      badge.textContent = '';
    } else {
      chip.dataset.configured = (set === 3) ? 'ok' : 'partial';
      badge.textContent = set + '/3';
      badge.removeAttribute('hidden');
    }
  }

  function refresh() {
    return fetch('/api/config')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(paint)
      .catch(function () { /* swallow — badge just stays as-is */ });
  }

  window.addEventListener('config:changed', refresh);
  refresh();
  setInterval(refresh, 60 * 1000);
})();