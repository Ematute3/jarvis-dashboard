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
    }).then(function (r) { return r.json(); });
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
    if (!name) return;
    api('POST', '/api/goals', { name: name }).then(function (res) {
      if (res.ok) { inputEl.value = ''; render(res.goals); }
    });
  });

  listEl.addEventListener('click', function (e) {
    var item = e.target.closest('.goal-item');
    if (!item) return;
    var id = item.dataset.id;
    if (e.target.closest('.goal-del')) {
      api('DELETE', '/api/goals/' + encodeURIComponent(id)).then(function (res) {
        if (res.ok) render(res.goals);
      });
      return;
    }
    var step = e.target.closest('.goal-step');
    if (step) {
      var current = parseInt(item.querySelector('.goal-pct').textContent, 10) || 0;
      var next = Math.max(0, Math.min(100, current + parseInt(step.dataset.delta, 10)));
      api('POST', '/api/goals/' + encodeURIComponent(id), { progress: next }).then(function (res) {
        if (res.ok) render(res.goals);
      });
    }
  });

  load();
})();
