/* ============================================================
   SETTINGS PAGE · CREDENTIAL MANAGEMENT
   File: settings.js
   Reads masked config from GET  /api/config,
   writes partial patches via  PUT /api/config.
   No frameworks — IIFE module like the rest of the dashboard.
   ============================================================ */

(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  // Basic HTML escape — only used if we ever inject untrusted text. Kept here
  // for parity with the dashboard's other modules (goals.js, etc.).
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // -----------------------------------------------------------------
  // Toast (mirror of dashboard's notif-panel open/close pattern)
  // -----------------------------------------------------------------
  var toastTimer = null;
  function toast(message, kind) {
    var el = $('toast');
    if (!el) return;
    el.textContent = String(message || '');
    el.className = 'toast open ' + (kind || 'ok');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.className = 'toast';
      toastTimer = null;
    }, 2400);
  }

  // -----------------------------------------------------------------
  // Status pill helpers
  //   isSet=true  → 'ok' (cyan dot,  "Configured")
  //   isSet=false → 'missing' (orange dot, "Not set")
  // -----------------------------------------------------------------
  function setStatus(id, isSet, configuredLabel, missingLabel) {
    var el = $(id);
    if (!el) return;
    if (isSet == null) {
      el.dataset.state = 'unknown';
      el.textContent = 'checking…';
    } else {
      el.dataset.state = isSet ? 'ok' : 'missing';
      el.textContent = isSet
        ? (configuredLabel || 'Configured')
        : (missingLabel    || 'Not set');
    }
  }

  // Mask a value to "abcd…wxyz" if it looks like a real secret.
  // Server may already return masked strings; this is a safety net so we
  // never display a full client secret back to the user.
  function preview(value, opts) {
    opts = opts || {};
    var minKeep = opts.minKeep == null ? 4 : opts.minKeep;
    var s = String(value == null ? '' : value);
    if (!s) return '—';
    // If the server already sent a masked string (contains '…' or '***'),
    // pass it through verbatim.
    if (s.indexOf('…') !== -1 || s.indexOf('*') !== -1) return s;
    if (s.length <= minKeep * 2) return s; // too short to mask meaningfully
    return s.slice(0, minKeep) + '…' + s.slice(-minKeep);
  }

  // -----------------------------------------------------------------
  // API wrapper
  // -----------------------------------------------------------------
  function api(method, url, body) {
    return fetch(url, {
      method: method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      // Body may be empty for some error paths — guard the .json() parse.
      return r.text().then(function (txt) {
        var data = null;
        if (txt) { try { data = JSON.parse(txt); } catch (e) { data = null; } }
        if (!r.ok) {
          var err = new Error('Request failed: ' + r.status);
          err.status = r.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  // -----------------------------------------------------------------
  // Load current config and render everything
  // -----------------------------------------------------------------
  function render(c) {
    if (!c) return;

    // MiniMax
    setStatus('minimaxStatus', c.minimaxApiKeySet);
    $('minimaxSaved').textContent = 'Currently saved: ' + (c.minimaxApiKey || '—');

    // Google — both fields have their own pill
    setStatus('googleStatus', c.googleClientIdSet && c.googleClientSecretSet);
    setStatus('googleClientIdStatus', c.googleClientIdSet);
    $('googleClientIdSaved').textContent = 'Currently saved: ' + (c.googleClientId || '—');

    setStatus('googleClientSecretStatus', c.googleClientSecretSet);
    $('googleClientSecretSaved').textContent = 'Currently saved: ' + (c.googleClientSecret || '—');

    // Redirect URI is a non-secret, server-known value
    var redirectEl = $('googleRedirectUri');
    if (redirectEl) redirectEl.textContent = c.googleRedirectUri || '—';

    // Tool
    var iter = parseInt(c.toolMaxIterations, 10);
    if (!isNaN(iter) && iter >= 1 && iter <= 20) {
      $('toolMaxIterations').value = iter;
    }

    // Topbar summary — "N/3 configured"
    var setBits = (c.minimaxApiKeySet ? 1 : 0)
              + (c.googleClientIdSet ? 1 : 0)
              + (c.googleClientSecretSet ? 1 : 0);
    var meta = $('statusMeta');
    if (meta) {
      meta.textContent = setBits + '/3 configured';
      meta.dataset.state = setBits === 3 ? 'ok' : (setBits === 0 ? 'missing' : 'partial');
    }
  }

  function load() {
    api('GET', '/api/config').then(render).catch(function (err) {
      var meta = $('statusMeta');
      if (meta) { meta.textContent = 'unavailable'; meta.dataset.state = 'missing'; }
      toast('Could not load config (' + (err.status || 'network') + ').', 'err');
    });
  }

  // -----------------------------------------------------------------
  // Save handlers
  // -----------------------------------------------------------------
  function lock(btn) {
    if (!btn) return function () { /* noop unlock */ };
    btn.disabled = true;
    var prev = btn.textContent;
    btn.textContent = 'SAVING…';
    return function () {
      btn.disabled = false;
      btn.textContent = prev;
    };
  }

  function saveMinimax(e) {
    e.preventDefault();
    var input = $('minimaxApiKey');
    var key = (input.value || '').trim();
    if (!key) { toast('Type a key first.', 'err'); input.focus(); return; }

    var unlock = lock(e.target.querySelector('button[type="submit"]'));
    api('PUT', '/api/config', { minimaxApiKey: key })
      .then(function () {
        toast('MiniMax key saved.', 'ok');
        input.value = '';
        load();
        window.dispatchEvent(new CustomEvent('config:changed'));
      })
      .catch(function (err) { toast('Save failed (' + (err.status || 'network') + ').', 'err'); })
      .then(unlock);
  }

  function saveGoogle(e) {
    e.preventDefault();
    var idEl = $('googleClientId');
    var secEl = $('googleClientSecret');
    var idVal  = (idEl.value  || '').trim();
    var secVal = (secEl.value || '').trim();

    // Build a partial patch — only include fields the user typed into.
    // An empty input means "leave whatever is already saved alone".
    var patch = {};
    if (idVal)  patch.googleClientId     = idVal;
    if (secVal) patch.googleClientSecret = secVal;
    if (!idVal && !secVal) {
      toast('Type a value into at least one field first.', 'err');
      (idVal ? secEl : idEl).focus();
      return;
    }

    var unlock = lock(e.target.querySelector('button[type="submit"]'));
    api('PUT', '/api/config', patch)
      .then(function () {
        toast('Google OAuth saved.', 'ok');
        idEl.value = '';
        secEl.value = '';
        load();
        window.dispatchEvent(new CustomEvent('config:changed'));
      })
      .catch(function (err) { toast('Save failed (' + (err.status || 'network') + ').', 'err'); })
      .then(unlock);
  }

  function saveTool(e) {
    e.preventDefault();
    var input = $('toolMaxIterations');
    var v = parseInt(input.value, 10);
    if (isNaN(v) || v < 1 || v > 20) {
      toast('Pick a number between 1 and 20.', 'err');
      input.focus();
      return;
    }

    var unlock = lock(e.target.querySelector('button[type="submit"]'));
    api('PUT', '/api/config', { toolMaxIterations: v })
      .then(function () {
        toast('Tool settings saved.', 'ok');
        load();
        window.dispatchEvent(new CustomEvent('config:changed'));
      })
      .catch(function (err) { toast('Save failed (' + (err.status || 'network') + ').', 'err'); })
      .then(unlock);
  }

  // -----------------------------------------------------------------
  // Wire up
  // -----------------------------------------------------------------
  var f1 = $('minimaxForm');
  var f2 = $('googleForm');
  var f3 = $('toolForm');
  if (f1) f1.addEventListener('submit', saveMinimax);
  if (f2) f2.addEventListener('submit', saveGoogle);
  if (f3) f3.addEventListener('submit', saveTool);

  // Initialize all pills to "unknown" so the page doesn't flash empty
  setStatus('minimaxStatus',              null);
  setStatus('googleStatus',               null);
  setStatus('googleClientIdStatus',       null);
  setStatus('googleClientSecretStatus',   null);

  load();
})();