/* ============================================================
   MASTER DASHBOARD · NATIVE QUICK LAUNCH WIDGET
   File: native-launcher.js
   Wires up the .c-launcher card. Each [data-launch] button calls the
   Tauri command `open_native` so the desktop app can open the right
   Mac app or URL. In a plain browser the Tauri global is missing and
   we just log a friendly rejection.
   ============================================================ */

(function () {
  'use strict';

  // Detect Tauri runtime. Falls back to web alerts in browser.
  function callTauri(cmd, args) {
    if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
      return window.__TAURI__.core.invoke(cmd, args);
    }
    // Browser fallback: log + alert (no native access)
    console.log('[native-launcher] would invoke', cmd, args);
    return Promise.reject(new Error('Not running in Tauri — this widget requires the desktop app.'));
  }

  function bind() {
    document.querySelectorAll('[data-launch]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = btn.dataset.launch;
        var path = btn.dataset.path || null;
        var url = btn.dataset.url || null;
        btn.disabled = true;
        callTauri('open_native', { target: target, path: path, url: url })
          .then(function (msg) { console.log('[native-launcher]', msg); })
          .catch(function (err) {
            console.warn('[native-launcher]', err);
            if (window.confirm && err.message && err.message.indexOf('Not running in Tauri') === 0) {
              // already alerted in browser; no-op
            }
          })
          .finally(function () { btn.disabled = false; });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();