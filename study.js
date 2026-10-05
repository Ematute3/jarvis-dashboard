/* ============================================================
   STUDY ASSISTANT · CLIENT SCRIPT
   Three buttons -> three modes (study guide / essay drafter / quiz).
   Talks to /api/canvas/courses/:id/files + /api/study/* on the local server.
   Saves outputs to ~/Downloads/canvas/study-outputs/<course>/<...>.md.
   ============================================================ */

(function () {
  'use strict';

  var $  = function (sel, root) { return (root || document).querySelector(sel); };

  // Mode: 'guide' | 'draft' | 'quiz'
  var state = { mode: 'guide', courses: [], lastContent: '', lastTitle: '' };

  function setStatus(text, kind) {
    var el = $('studyStatus');
    if (!el) return;
    el.textContent = text;
    el.style.color = kind === 'err'
      ? 'var(--c-orange)'
      : kind === 'ok' ? 'var(--c-cyan)' : 'var(--c-ink-dim)';
  }

  function notice(text, kind) {
    var n = $('studyNotice');
    if (!text) { n.hidden = true; n.textContent = ''; n.className = 'study-notice'; return; }
    n.hidden = false;
    n.textContent = text;
    n.className = 'study-notice' + (kind === 'ok' ? ' is-success' : '');
  }

  function fetchJSON(url, init) {
    return fetch(url, Object.assign({ credentials: 'same-origin' }, init || {}))
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, data: j }; }); })
      .catch(function (e) { return { ok: false, status: 0, data: null, error: String(e && e.message || e) }; });
  }

  // ---------- Course dropdown ----------
  function loadCourses() {
    setStatus('loading\u2026');
    return fetchJSON('/api/courses/all').then(function (r) {
      var list = (r.ok && Array.isArray(r.data)) ? r.data
               : (r.ok && Array.isArray(r.data && r.data.courses) ? r.data.courses : []);
      state.courses = list.map(function (c) {
        return {
          id: c.id,
          code: c.course_code || c.code || '',
          name: c.name || '',
        };
      });
      var sel = $('studyCourse');
      sel.innerHTML = '';
      if (state.courses.length === 0) {
        var opt = document.createElement('option');
        opt.value = ''; opt.textContent = 'No courses available (Canvas not configured)';
        sel.appendChild(opt);
        setStatus('OFFLINE', 'err');
        notice('Canvas API is not configured. Open Settings to add your Canvas token.', 'err');
      } else {
        state.courses.forEach(function (c) {
          var opt = document.createElement('option');
          opt.value = String(c.id);
          opt.textContent = (c.code ? c.code + ' \u2014 ' : '') + c.name;
          sel.appendChild(opt);
        });
        setStatus(state.courses.length + ' COURSES', 'ok');
      }
      $('studySub').textContent = state.courses.length
        ? state.courses.length + ' course' + (state.courses.length === 1 ? '' : 's') + ' available'
        : 'no Canvas connection';
    });
  }

  // ---------- Mode buttons ----------
  function setMode(mode) {
    state.mode = mode;
    $$('.study-mode-btn').forEach(function (b) {
      var on = b.dataset.mode === mode;
      b.classList.toggle('is-active', on);
    });
    $('studyTopicField').hidden = (mode === 'draft');
    $('studyPromptField').hidden = (mode !== 'draft');
    $('studyCountField').hidden  = (mode !== 'quiz');
  }

  // ---------- Generate ----------
  function runGenerate() {
    var sel = $('studyCourse');
    var courseId = sel.value;
    if (!courseId) { notice('Pick a course first.', 'err'); return; }
    var course = state.courses.find(function (c) { return String(c.id) === String(courseId); }) || {};
    var courseCode = course.code || '';
    var courseName = course.name || '';

    var payload = { courseId: courseId, courseCode: courseCode, courseName: courseName };
    var endpoint = '';
    if (state.mode === 'guide') {
      endpoint = '/api/study/guide';
      payload.topic = $('studyTopic').value.trim();
    } else if (state.mode === 'draft') {
      endpoint = '/api/study/draft';
      payload.prompt = $('studyPrompt').value.trim();
      if (!payload.prompt) { notice('Enter a prompt for the essay drafter.', 'err'); return; }
    } else {
      endpoint = '/api/study/quiz';
      payload.topic = $('studyTopic').value.trim();
      payload.count = parseInt($('studyCount').value, 10) || 10;
    }

    var btn = $('studyRun');
    btn.disabled = true;
    btn.textContent = 'GENERATING\u2026';
    notice('Pulling course files from Canvas and asking MiniMax to draft the output. This usually takes 20-60 seconds.', 'ok');
    $('studyOutput').hidden = true;
    $('studyMeta').hidden = true;

    fetchJSON(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (r) {
      btn.disabled = false;
      btn.textContent = 'GENERATE';
      if (!r.ok || !r.data || !r.data.ok) {
        var err = (r.data && r.data.error) || ('HTTP ' + r.status);
        notice('Failed: ' + err, 'err');
        return;
      }
      state.lastContent = r.data.content;
      state.lastTitle = endpointLabel(state.mode, courseCode, courseName, payload);
      notice('Done. Saved to ' + r.data.savedTo + '. NEVER submitted to Canvas; this is for your review only.', 'ok');
      renderOutput(r.data);
      refreshHistory();
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = 'GENERATE';
      notice('Error: ' + (err && err.message || err), 'err');
    });
  }

  function endpointLabel(mode, code, name, payload) {
    var title;
    if (mode === 'guide') title = 'STUDY GUIDE \u00b7 ' + (payload.topic || 'general');
    else if (mode === 'quiz') title = 'QUIZ \u00b7 ' + (payload.topic || 'general');
    else title = 'ESSAY DRAFT';
    return title + ' \u00b7 ' + (code || name || payload.courseId);
  }

  function renderOutput(data) {
    $('studyOutput').hidden = false;
    $('studyOutputTitle').textContent = state.lastTitle;
    $('studyOutputBody').textContent = data.content;
    $('studyMeta').hidden = false;
    var files = (data.filesUsed || []).map(function (f) {
      return f.name + (f.truncated ? ' (truncated)' : '');
    }).join(', ');
    $('studyFilesUsed').textContent = files || '\u2014';
    var saved = $('studySavedTo');
    saved.textContent = data.savedTo || '\u2014';
    saved.href = 'file://' + (data.savedTo || '');
  }

  // ---------- History ----------
  function refreshHistory() {
    fetchJSON('/api/study/outputs').then(function (r) {
      var list = (r.ok && r.data && Array.isArray(r.data.files)) ? r.data.files : [];
      var host = $('studyHistory');
      if (!list.length) {
        host.innerHTML = '<div class="study-empty">No saved outputs yet.</div>';
        return;
      }
      host.innerHTML = '';
      list.forEach(function (f) {
        var row = document.createElement('div');
        row.className = 'study-history-row';
        var a = document.createElement('a');
        a.href = 'file://' + f.path;
        a.textContent = (f.course ? f.course + ' \u00b7 ' : '') + f.name;
        a.title = f.path;
        var meta = document.createElement('span');
        meta.className = 'study-history-meta';
        meta.textContent = humanSize(f.size) + ' \u00b7 ' + new Date(f.mtime).toLocaleString();
        var open = document.createElement('a');
        open.href = 'file://' + f.path;
        open.textContent = 'OPEN';
        open.className = 'btn-ghost';
        open.style.padding = '4px 10px';
        open.style.fontSize = '10px';
        row.appendChild(a);
        row.appendChild(meta);
        row.appendChild(open);
        host.appendChild(row);
      });
    });
  }

  function humanSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(2) + ' MB';
  }

  // ---------- Copy + download ----------
  function copyOutput() {
    if (!state.lastContent) return;
    navigator.clipboard.writeText(state.lastContent).then(function () {
      var btn = $('studyCopy');
      var old = btn.textContent;
      btn.textContent = 'COPIED \u2713';
      setTimeout(function () { btn.textContent = old; }, 1200);
    });
  }

  function downloadOutput() {
    if (!state.lastContent) return;
    var blob = new Blob([state.lastContent], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (state.lastTitle || 'study-output').replace(/[^\w.-]+/g, '-') + '.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------- Boot ----------
  function bind() {
    $$('.study-mode-btn').forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.dataset.mode); });
    });
    $('studyRun').addEventListener('click', runGenerate);
    $('studyRefresh').addEventListener('click', function () { loadCourses(); refreshHistory(); });
    $('studyCopy').addEventListener('click', copyOutput);
    $('studyDownload').addEventListener('click', downloadOutput);
  }

  function boot() {
    bind();
    setMode('guide');
    loadCourses().then(refreshHistory);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();