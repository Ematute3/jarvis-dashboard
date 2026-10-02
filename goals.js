/* ============================================================
   MASTER DASHBOARD · GOALS WIDGET
   File: goals.js
   Fully user-managed: add a goal, nudge its progress, remove it.
   Stored server-side in data/goals.json via /api/goals.
   ============================================================ */

(function () {
  'use strict';

  var listEl = document.getElementById('goalList');
  var formEl = document.getElementById('goalForm');
  var inputEl = document.getElementById('goalInput');
  var countEl = document.getElementById('goalsCount');
  if (!listEl || !formEl) return;

  var STEP = 10;
  var inFlight = new Set();
  var submitInFlight = false;
  var statusTimer = null;

  // Status element — injected next to the form for inline user feedback.
  var statusEl = document.createElement('div');
  statusEl.className = 'goal-status';
  statusEl.setAttribute('role', 'status');
  statusEl.setAttribute('aria-live', 'polite');
  if (formEl.parentNode) {
    formEl.parentNode.insertBefore(statusEl, formEl.nextSibling);
  } else {
    formEl.appendChild(statusEl);
  }

  function setStatus(msg, kind) {
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
    if (!msg) {
      statusEl.textContent = '';
      statusEl.className = 'goal-status';
      return;
    }
    statusEl.textContent = msg;
    statusEl.className = 'goal-status' + (kind ? ' goal-status--' + kind : '');
    statusTimer = setTimeout(function () {
      statusEl.textContent = '';
      statusEl.className = 'goal-status';
      statusTimer = null;
    }, 1500);
  }

  function setError(msg) { setStatus(msg, 'error'); }
  function setSuccess(msg) { setStatus(msg, 'success'); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function api(method, url, body) {
    return fetch(url, {
      method: method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      if (!r.ok) {
        var err = new Error('Request failed: ' + r.status);
        err.status = r.status;
        throw err;
      }
      return r.json();
    });
  }

  function render(goals) {
    if (countEl) countEl.textContent = goals.length;
    if (!goals.length) {
      listEl.innerHTML = '<li class="goal-empty">No goals yet — add your first one below.</li>';
      return;
    }
    listEl.innerHTML = goals.map(function (g) {
      return '<li class="goal-item" data-id="' + esc(g.id) + '">' +
        '<span class="goal-name">' + esc(g.name) + '</span>' +
        '<span class="goal-bar"><span class="goal-fill" style="--w:' + g.progress + '%"></span></span>' +
        '<span class="goal-pct">' + g.progress + '%</span>' +
        '<button type="button" class="goal-step" data-delta="-' + STEP + '" aria-label="Decrease progress">−</button>' +
        '<button type="button" class="goal-step" data-delta="' + STEP + '" aria-label="Increase progress">+</button>' +
        '<button type="button" class="goal-del" aria-label="Remove goal">×</button>' +
        '</li>';
    }).join('');
  }

  function load() {
    return api('GET', '/api/goals').then(function (goals) {
      render(Array.isArray(goals) ? goals : []);
    }).catch(function () {
      listEl.innerHTML = '<li class="goal-empty">Could not load goals.</li>';
    });
  }

  formEl.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = inputEl.value.trim();
    if (!name) {
      setError('Type a goal first.');
      inputEl.focus();
      return;
    }
    if (submitInFlight) return;
    submitInFlight = true;

    var submitBtn = formEl.querySelector('button[type="submit"], button:not([type])');
    if (submitBtn) submitBtn.disabled = true;

    api('POST', '/api/goals', { name: name })
      .then(function (res) {
        if (res.ok) {
          inputEl.value = '';
          render(res.goals);
          setSuccess('Added.');
        } else {
          setError("Couldn't save — retry.");
        }
      })
      .catch(function () {
        setError("Couldn't save — retry.");
      })
      .then(function () {
        submitInFlight = false;
        if (submitBtn) submitBtn.disabled = false;
      });
  });

  listEl.addEventListener('click', function (e) {
    var item = e.target.closest('.goal-item');
    if (!item) return;
    var id = item.dataset.id;
    if (!id || inFlight.has(id)) return;

    if (e.target.closest('.goal-del')) {
      inFlight.add(id);
      api('DELETE', '/api/goals/' + encodeURIComponent(id))
        .then(function (res) { if (res.ok) render(res.goals); })
        .catch(function () { setError("Couldn't save — retry."); })
        .then(function () { inFlight.delete(id); });
      return;
    }
    var step = e.target.closest('.goal-step');
    if (step) {
      var current = parseInt(item.querySelector('.goal-pct').textContent, 10) || 0;
      var next = Math.max(0, Math.min(100, current + parseInt(step.dataset.delta, 10)));
      inFlight.add(id);
      api('POST', '/api/goals/' + encodeURIComponent(id), { progress: next })
        .then(function (res) { if (res.ok) render(res.goals); })
        .catch(function () { setError("Couldn't save — retry."); })
        .then(function () { inFlight.delete(id); });
    }
  });

  load();
})();
