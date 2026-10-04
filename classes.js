/**
 * Master Dashboard — Canvas client (inlined from legacy canvas.js)
 *
 * Thin wrapper over the server-side Canvas proxy (/api/canvas/*). The
 * server holds the Canvas domain and access token in the macOS Keychain;
 * the browser never sees them. There is no sample data: when Canvas isn't
 * connected every call rejects with an error explaining how to fix it.
 *
 *   window.Canvas.isConnected()             -> Promise<boolean>
 *   window.Canvas.getCanvasToken()          -> Promise<{account, status}>  (rejects if not connected)
 *   window.Canvas.getCourses()              -> Promise<Course[]>
 *   window.Canvas.getAssignments(courseId)  -> Promise<Assignment[]>
 *   window.Canvas.getSyllabus(courseId)     -> Promise<{courseId, paragraphs, ...}>
 */

(function (global) {
  'use strict';

  var NOT_CONNECTED = 'Canvas isn’t connected. Go to Settings and save your Canvas domain and access token.';

  async function getCanvasToken() {
    var resp;
    try {
      resp = await fetch('/api/settings/status', { credentials: 'same-origin' });
    } catch (err) {
      throw new Error('Could not reach the dashboard server. Make sure it is running.');
    }
    if (!resp.ok) throw new Error('Could not check Canvas status (HTTP ' + resp.status + ').');
    var data = await resp.json();
    if (!data || data['canvas-token'] !== 'connected' || data['canvas-domain'] !== 'connected') {
      throw new Error(NOT_CONNECTED);
    }
    return { account: 'canvas-token', status: 'connected' };
  }

  async function isConnected() {
    try {
      await getCanvasToken();
      return true;
    } catch (_) {
      return false;
    }
  }

  async function canvasFetch(path) {
    await getCanvasToken();
    var resp = await fetch(path, { credentials: 'same-origin' });
    var data = await resp.json();
    if (!resp.ok || (data && data.error)) {
      throw new Error((data && data.error) || 'Canvas request failed (HTTP ' + resp.status + ').');
    }
    return data;
  }

  function getCourses() {
    return canvasFetch('/api/canvas/courses');
  }

  function getAssignments(courseId) {
    return canvasFetch('/api/canvas/courses/' + encodeURIComponent(courseId) + '/assignments');
  }

  function getSyllabus(courseId) {
    return canvasFetch('/api/canvas/courses/' + encodeURIComponent(courseId) + '/syllabus');
  }

  var api = {
    getCanvasToken: getCanvasToken,
    getCourses: getCourses,
    getAssignments: getAssignments,
    getSyllabus: getSyllabus,
    isConnected: isConnected,
  };

  global.Canvas = api;
  global.MasterDashboard = global.MasterDashboard || {};
  global.MasterDashboard.canvas = api;
})(window);

/* ============================================================
   MASTER DASHBOARD · CLASSES VIEW · CLIENT SCRIPT
   File: classes.js
   Plain JS. No framework.
   Data: /api/courses/all (real Canvas courses + blank-slate classes
   that aren't on Canvas yet) and Canvas assignments. There is no
   sample data. The grade calculator lives in its own tab.
   ============================================================ */

(function () {
  'use strict';

  // ---- DOM helpers ----
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class')      node.className = attrs[k];
        else if (k === 'html')  node.innerHTML = attrs[k];
        else if (k === 'text')  node.textContent = attrs[k];
        else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (attrs[k] === true) {
          node.setAttribute(k, '');
        } else if (attrs[k] != null && attrs[k] !== false) {
          node.setAttribute(k, attrs[k]);
        }
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null || c === false) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  // ---- Date formatting (deterministic, local) ----
  var DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function parseDue(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d;
  }
  function formatDue(iso) {
    var d = parseDue(iso);
    if (!d) return 'No due date';
    var hh = d.getHours();
    var mm = pad(d.getMinutes());
    var ampm = hh >= 12 ? 'pm' : 'am';
    var h12 = ((hh + 11) % 12) + 1;
    return 'Due ' + DOW[d.getDay()] + ' ' + MON[d.getMonth()] + ' ' + d.getDate()
         + ', ' + h12 + ':' + mm + ampm;
  }
  function formatTermDate() {
    var d = new Date();
    return DOW[d.getDay()] + ' ' + MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  // ---- Color token resolver ----
  function accentVar(color) {
    switch ((color || 'cyan').toLowerCase()) {
      case 'amber':   return 'var(--cls-accent-amber)';
      case 'magenta': return 'var(--cls-accent-magenta)';
      case 'violet':  return 'var(--cls-accent-violet)';
      case 'green':   return 'var(--cls-accent-green)';
      case 'cyan':
      default:        return 'var(--cls-accent-cyan)';
    }
  }

  // ---- Data adapter: /api/courses/all (real Canvas + manual blank-slate
  // courses, already merged and filtered server-side). ----
  async function loadCourses() {
    try {
      var resp = await fetch('/api/courses/all', { credentials: 'same-origin' });
      var data = await resp.json();
      if (!resp.ok || !Array.isArray(data)) throw new Error('Could not load your classes.');
      return { courses: data, error: null };
    } catch (e) {
      return { courses: [], error: e.message };
    }
  }
  // Assignments only exist for Canvas-backed courses; a blank slate has
  // nothing to fetch yet.
  async function loadAssignments(courseId, courseSource) {
    if (courseSource !== 'canvas' || !window.Canvas) return [];
    try {
      var a = await window.Canvas.getAssignments(courseId);
      return Array.isArray(a) ? a : [];
    } catch (e) {
      return [];
    }
  }

  // ---- Render: tabs ----
  function renderTabs(courses, activeIdx) {
    var strip = $('#cls-tabs');
    if (!strip) return;
    strip.innerHTML = '';
    courses.forEach(function (course, i) {
      var tab = el('button', {
        class: 'cls-tab' + (i === activeIdx ? ' is-active' : ''),
        type:  'button',
        role:  'tab',
        'aria-selected': i === activeIdx ? 'true' : 'false',
        'data-course-id': course.id,
        'data-tab-index': i,
        title: course.code
      }, [
        el('span', { class: 'cls-tab-dot', style: 'color:' + accentVar(course.color) }),
        el('span', { class: 'cls-tab-code', text: course.name || course.code }),
        el('span', { class: 'cls-tab-underline' })
      ]);
      tab.addEventListener('click', function () { activate(i); });
      strip.appendChild(tab);
    });
  }

  // ---- Render: a single course panel ----
  async function renderPanel(course, source) {
    var isBlankSlate = source === 'manual';
    var assigns = (await loadAssignments(course.id, source))
      .filter(function (a) { return parseDue(a.dueDate) !== null; })
      .sort(function (a, b) { return new Date(a.dueDate) - new Date(b.dueDate); })
      .slice(0, 5);

    // (a) Course header — Canvas's own computed grade when it has one.
    var hasGrade = typeof course.currentScorePct === 'number';
    var earnedPct = hasGrade ? course.currentScorePct : 0;
    var gradeValueText = hasGrade ? earnedPct.toFixed(1) + '%' : '\u2014';
    var gradeDetailText = isBlankSlate
      ? 'Not yet on Canvas'
      : (hasGrade ? 'Synced from Canvas' : 'No grade posted yet');
    var header = el('div', { class: 'cls-course-head' }, [
      el('div', { class: 'cls-course-id' }, [
        el('div', { class: 'cls-course-code', text: course.code }),
        el('div', { class: 'cls-course-name', text: course.name }),
        el('div', { class: 'cls-course-meta' }, [
          el('span', null, [el('b', { text: 'Instructor ' }), document.createTextNode(course.instructor || '—')]),
          el('span', null, [el('b', { text: 'Term ' }),       document.createTextNode(course.term       || '—')]),
          el('span', null, [el('b', { text: 'Credits ' }),    document.createTextNode(course.credits ? String(course.credits) : '—')])
        ])
      ]),
      el('div', { class: 'cls-course-grade' }, [
        el('div', { class: 'cls-grade-label', text: 'CURRENT GRADE' }),
        el('div', { class: 'cls-grade-value', text: gradeValueText }),
        el('div', { class: 'cls-grade-letter', text: gradeDetailText })
      ])
    ]);

    // (b) Upcoming assignments
    var assignRows;
    if (assigns.length === 0) {
      assignRows = el('div', { class: 'cls-empty', text: isBlankSlate
        ? 'Not yet on Canvas — check back once your professor sets up the course.'
        : 'No upcoming assignments.'
      });
    } else {
      assignRows = el('div', { class: 'cls-assign-list' },
        assigns.map(function (a) {
          return el('div', { class: 'cls-assign' }, [
            el('div', { class: 'cls-assign-title', text: a.title }),
            el('div', { class: 'cls-assign-due',   text: formatDue(a.dueDate) }),
            el('div', { class: 'cls-assign-pts' }, [
              el('span', { class: 'cls-badge is-' + (a.status || 'not_started'), text: (a.status || 'not_started').replace('_',' ') }),
              ' ',
              document.createTextNode(a.points > 0 ? (a.points + ' pts') : '—')
            ])
          ]);
        })
      );
    }
    var nextDue = assigns.length > 0 ? formatDue(assigns[0].dueDate).replace(/^Due /, 'NEXT: ') : 'NO UPCOMING';
    var assignSub = el('section', { class: 'cls-sub', 'aria-label': 'Upcoming assignments' }, [
      el('div', { class: 'cls-sub-head' }, [
        el('div', { class: 'cls-sub-title', text: 'Upcoming Assignments' }),
        el('div', { class: 'cls-sub-meta',  text: nextDue })
      ]),
      assignRows
    ]);

    // (c) Syllabus summary + things to watch (from the uploaded syllabus)
    var syl = course.syllabus;
    var summarySub = null;
    if (syl && (syl.summary || syl.watch)) {
      var kids = (syl.summary || []).map(function (t) { return el('p', { class: 'cls-sum-p', text: t }); });
      if (syl.watch && syl.watch.length) {
        kids.push(el('div', { class: 'cls-watch-title', text: 'WATCH OUT FOR' }));
        kids.push(el('ul', { class: 'cls-watch' }, syl.watch.map(function (t) { return el('li', { text: t }); })));
      }
      summarySub = el('section', { class: 'cls-sub', 'aria-label': 'Syllabus summary' }, [
        el('div', { class: 'cls-sub-head' }, [
          el('div', { class: 'cls-sub-title', text: 'Syllabus Summary' }),
          el('div', { class: 'cls-sub-meta', text: (syl.source || '').toUpperCase() })
        ]),
        el('div', { class: 'cls-summary' }, kids)
      ]);
    }

    // (d) Quick links
    var links = Array.isArray(course.links) ? course.links : [];
    var linkNodes = links.length
      ? links.map(function (l) {
          return el('a', {
            class: 'cls-link', href: l.href || '#',
            target: l.href && l.href !== '#' ? '_blank' : '_self',
            rel: 'noopener noreferrer'
          }, [
            el('span', { class: 'cls-link-glyph', text: l.glyph || '◇' }),
            el('span', { text: l.label || 'Link' })
          ]);
        })
      : [el('div', { class: 'cls-empty', text: 'No quick links configured.' })];
    var linksSub = el('section', { class: 'cls-sub', 'aria-label': 'Quick links' }, [
      el('div', { class: 'cls-sub-head' }, [
        el('div', { class: 'cls-sub-title', text: 'Quick Links' }),
        el('div', { class: 'cls-sub-meta',  text: links.length + ' RESOURCES' })
      ]),
      el('div', { class: 'cls-links' }, linkNodes)
    ]);

    return el('section', {
      class: 'cls-panel',
      role: 'tabpanel',
      'data-course-id': course.id,
      'data-tab-index': '',
      style: '--cls-accent:' + accentVar(course.color) +
             '; border-top-color:' + accentVar(course.color)
    }, [
      header,
      el('div', { class: 'cls-body' + (summarySub ? '' : ' no-summary') }, [
        summarySub ? el('div', { class: 'cls-col-main' }, [summarySub]) : null,
        el('div', { class: 'cls-col-side' }, [assignSub, linksSub])
      ].filter(Boolean))
    ]);
  }

  async function renderPanels(courses) {
    var main = $('#cls-main');
    if (!main) return;
    main.innerHTML = '';
    for (var i = 0; i < courses.length; i++) {
      // Each course carries its own source ('canvas' | 'manual') —
      // a page can genuinely mix real Canvas courses with manual blank slates.
      var p = await renderPanel(courses[i], courses[i].source);
      p.dataset.tabIndex = i;
      main.appendChild(p);
    }
  }

  // ---- Activate a tab: show that course, hide the rest ----
  function activate(idx) {
    document.querySelectorAll('.cls-tab').forEach(function (t, i) {
      var on = (i === idx);
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('#cls-main .cls-panel').forEach(function (p) {
      p.hidden = String(p.dataset.tabIndex) !== String(idx);
    });
    try { localStorage.setItem('jarvis-classes-tab', String(idx)); } catch (e) {}
  }

  // ---- Grade calculator (its own tab) ----
  // Syllabus mode: each grading category has a weight (% of the course). The
  // user enters their average % on categories already graded; blank = not yet.
  //   earned    = sum(weight * score) / totalWeight          (course-% banked)
  //   remaining = (totalWeight - gradedWeight) / totalWeight (course-% still open)
  //   needed    = (targetMin - earned) / remaining           (avg % on the rest)
  // Manual mode (classes with no syllabus grading): what do I need on the final?
  function shortName(course) {
    return course.source === 'manual' ? (course.code || course.name) : course.code;
  }
  function fmt(n) { return (Math.round(n * 10) / 10).toFixed(1) + '%'; }
  function letterFor(scale, pct) {
    for (var i = 0; i < scale.length; i++) if (pct >= scale[i].min) return scale[i].grade;
    return scale[scale.length - 1].grade;
  }

  function computeNeeded(current, weightPct, target) {
    var w = weightPct / 100;
    var needed = (target - current * (1 - w)) / w;
    if (needed <= 0) return { kind: 'good', big: '0%', msg: 'Already locked in — any score on the final keeps you at or above ' + target + '%.' };
    if (needed > 100) {
      var best = current * (1 - w) + 100 * w;
      return { kind: 'warn', big: '>100%', msg: 'Out of reach — even a perfect final gives ' + best.toFixed(1) + '%.' };
    }
    return { kind: 'ok', big: needed.toFixed(1) + '%', msg: 'You need this on the final to finish with ' + target + '%.' };
  }

  function calcField(label, input) {
    return el('div', { class: 'cls-calc-input' }, [el('label', { for: input.id, text: label }), input]);
  }
  function resultBoxParts() {
    var msg = el('span', { text: '' });
    var big = el('b', { text: '—' });
    var box = el('div', { class: 'cls-calc-result', role: 'status' }, [msg, big]);
    return {
      box: box,
      set: function (kind, m, b) {
        box.classList.remove('is-warn', 'is-good');
        if (kind === 'warn') box.classList.add('is-warn');
        if (kind === 'good') box.classList.add('is-good');
        msg.textContent = m; big.textContent = b;
      }
    };
  }

  function renderManualCalc(host, course) {
    var current = el('input', { type: 'number', id: 'calc-current', min: '0', max: '200', step: '0.1', placeholder: 'e.g. 84.5' });
    var weight  = el('input', { type: 'number', id: 'calc-weight',  min: '1', max: '100', step: '0.5', placeholder: 'e.g. 30' });
    var target  = el('input', { type: 'number', id: 'calc-target',  min: '0', max: '200', step: '0.5', value: '90' });
    var hintText = !course ? 'Type your own numbers.'
      : (course.source === 'manual' ? 'This class isn’t on Canvas yet and has no syllabus grading, so type your numbers yourself.'
        : 'No grading weights on file for this class yet (upload its syllabus), so type your numbers yourself.');
    if (course && typeof course.currentScorePct === 'number') {
      current.value = course.currentScorePct.toFixed(1);
      hintText = 'No syllabus weights on file. Current grade filled from Canvas; enter what the final is worth.';
    }
    var res = resultBoxParts();
    res.set('', 'Fill in the fields and press Calculate.', '—');
    var btn = el('button', { type: 'button', class: 'cls-calc-btn', text: 'Calculate' });
    function run() {
      var cur = parseFloat(current.value), w = parseFloat(weight.value), t = parseFloat(target.value);
      if (!isFinite(cur) || cur < 0) return res.set('warn', 'Enter your current grade (before the final).', '—');
      if (!isFinite(w) || w <= 0 || w > 100) return res.set('warn', 'Enter what the final is worth, as a percent of the course grade (1–100).', '—');
      if (!isFinite(t) || t <= 0) return res.set('warn', 'Enter a target grade above 0%.', '—');
      var r = computeNeeded(cur, w, t);
      res.set(r.kind, r.msg, r.big);
    }
    btn.addEventListener('click', run);
    [current, weight, target].forEach(function (i) {
      i.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    });
    host.appendChild(el('div', { class: 'cls-calc-fields' }, [
      calcField('Current grade % (before the final)', current),
      calcField('Final is worth (% of course)', weight),
      calcField('Target grade %', target)
    ]));
    host.appendChild(el('div', { class: 'cls-calc-hint', text: hintText }));
    host.appendChild(el('div', { class: 'cls-calc-grid' }, [btn, el('div', { class: 'cls-calc-input' }, [el('label', { text: 'What you need' }), res.box])]));
  }

  function renderSyllabusCalc(host, course) {
    var syl = course.syllabus;
    var cats = syl.grading;
    var scale = (syl.scale && syl.scale.length) ? syl.scale : null;
    var totalW = cats.reduce(function (a, c) { return a + c.pct; }, 0);
    var storeKey = 'jarvis-calc-' + course.id;
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(storeKey) || '{}'); } catch (e) {}

    var inputs = cats.map(function (c, i) {
      var inp = el('input', { type: 'number', min: '0', max: '100', step: '0.1', placeholder: '—', 'aria-label': c.label + ' score percent' });
      if (saved.s && saved.s[i] != null && saved.s[i] !== '') inp.value = saved.s[i];
      inp.addEventListener('input', update);
      return inp;
    });
    var targetSel = null;
    if (scale) {
      targetSel = el('select', { id: 'calc-target-grade', 'aria-label': 'Target grade' }, scale.filter(function (g) { return g.min > 0; }).map(function (g) {
        return el('option', { value: String(g.min), text: g.grade + ' (' + g.min + '%+)' });
      }));
      var pref = saved.t;
      var def = scale.filter(function (g) { return g.min > 0; });
      var pick = def.filter(function (g) { return String(g.min) === pref; })[0] || def.filter(function (g) { return g.grade === 'A' || g.grade === 'S'; })[0] || def[0];
      targetSel.value = String(pick.min);
      targetSel.addEventListener('change', update);
    }
    var tiles = el('div', { class: 'calc-tiles' });
    var res = resultBoxParts();

    var rows = cats.map(function (c, i) {
      return el('div', { class: 'calc-row' }, [
        el('div', { class: 'calc-row-label', text: c.label }),
        el('div', { class: 'calc-row-w', text: (Math.round(c.pct * 10) / 10) + '% of grade' }),
        el('div', { class: 'calc-row-in' }, [inputs[i], el('span', { text: '%' })])
      ]);
    });

    function tile(label, value, sub) {
      return el('div', { class: 'calc-tile' }, [el('span', { text: label }), el('b', { text: value }), el('em', { text: sub || '' })]);
    }

    function update() {
      var earned = 0, gradedW = 0, bad = false;
      inputs.forEach(function (inp, i) {
        var v = parseFloat(inp.value);
        if (inp.value === '' || !isFinite(v)) { inp.classList.remove('is-bad'); return; }
        if (v < 0 || v > 100) { inp.classList.add('is-bad'); bad = true; return; }
        inp.classList.remove('is-bad');
        earned += cats[i].pct * v / 100;
        gradedW += cats[i].pct;
      });
      try {
        localStorage.setItem(storeKey, JSON.stringify({ s: inputs.map(function (i) { return i.value; }), t: targetSel ? targetSel.value : '' }));
      } catch (e) {}
      tiles.innerHTML = '';
      if (bad) { res.set('warn', 'Scores must be between 0 and 100.', '—'); return; }
      var earnedPct = earned / totalW * 100;              // course-% banked
      var remainW = totalW - gradedW;
      var remainPct = remainW / totalW * 100;             // course-% still open
      var avg = gradedW > 0 ? earned / gradedW * 100 : null;  // average on graded work
      tiles.appendChild(tile('BANKED', fmt(earnedPct), 'of ' + fmt(100 - remainPct) + ' graded'));
      tiles.appendChild(tile('AVG ON GRADED WORK', avg == null ? '—' : fmt(avg), avg != null && scale ? letterFor(scale, avg) : ''));
      tiles.appendChild(tile('STILL OPEN', fmt(remainPct), 'of the course'));
      if (scale) {
        tiles.appendChild(tile('BEST CASE', fmt(earnedPct + remainPct), letterFor(scale, earnedPct + remainPct)));
      }
      if (gradedW === 0) { res.set('', 'Enter your score on any category you already have results for.', '—'); return; }
      if (!scale) { res.set('good', 'Average on graded work so far.', fmt(avg)); return; }
      var goal = parseFloat(targetSel.value);
      var goalName = scale.filter(function (g) { return String(g.min) === targetSel.value; })[0].grade;
      if (remainW <= 0.0001) {
        var fin = letterFor(scale, earnedPct);
        res.set(earnedPct >= goal ? 'good' : 'warn', 'Everything is graded. Final grade: ' + fin + '.', fmt(earnedPct));
        return;
      }
      var needed = (goal - earnedPct) / remainPct * 100;
      if (needed <= 0) res.set('good', 'Already locked in: even 0% on the rest keeps you at ' + goalName + ' or better.', '0%');
      else if (needed > 100) res.set('warn', 'Out of reach: even 100% on everything left gives ' + fmt(earnedPct + remainPct) + ' (' + letterFor(scale, earnedPct + remainPct) + ').', '>100%');
      else res.set('ok', 'Average you need on the remaining ' + fmt(remainPct) + ' of the course to finish with ' + goalName + '.', fmt(needed));
    }

    var head = el('div', { class: 'calc-head' }, [
      el('div', { class: 'calc-src', text: 'Weights from ' + (syl.source || 'syllabus') }),
      targetSel ? el('div', { class: 'cls-calc-input calc-target' }, [el('label', { for: 'calc-target-grade', text: 'Target grade' }), targetSel]) : null
    ].filter(Boolean));
    host.appendChild(head);
    host.appendChild(el('div', { class: 'calc-rows' }, rows));
    host.appendChild(tiles);
    host.appendChild(el('div', { class: 'cls-calc-input' }, [el('label', { text: 'What you need' }), res.box]));
    if (syl.calcNote) host.appendChild(el('div', { class: 'cls-calc-hint', text: syl.calcNote }));
    update();
  }

  function renderCalculator(courses) {
    var host = $('#cls-calc-view');
    if (!host) return;
    host.innerHTML = '';

    var select = el('select', { id: 'calc-course', 'aria-label': 'Class' }, courses.map(function (c, i) {
      var hasW = c.syllabus && Array.isArray(c.syllabus.grading) && c.syllabus.grading.length;
      return el('option', { value: String(i), text: c.name + ' · ' + shortName(c) + (hasW ? '' : ' (no grading weights yet)') });
    }).concat([el('option', { value: 'manual', text: 'Other / type my own numbers' })]));
    var body = el('div', { class: 'calc-body' });

    function draw() {
      body.innerHTML = '';
      var c = select.value === 'manual' ? null : courses[+select.value];
      if (c && c.syllabus && Array.isArray(c.syllabus.grading) && c.syllabus.grading.length) renderSyllabusCalc(body, c);
      else renderManualCalc(body, c);
    }
    select.addEventListener('change', draw);
    var firstW = courses.findIndex(function (c) { return c.syllabus && c.syllabus.grading && c.syllabus.grading.length; });
    select.value = firstW >= 0 ? String(firstW) : 'manual';

    host.appendChild(el('section', { class: 'cls-panel', style: '--cls-accent:var(--cls-accent-cyan); border-top-color:var(--cls-accent-cyan)' }, [
      el('section', { class: 'cls-sub' }, [
        el('div', { class: 'cls-sub-head' }, [
          el('div', { class: 'cls-sub-title', text: 'Grade Calculator' }),
          el('div', { class: 'cls-sub-meta', text: 'FROM YOUR SYLLABI' })
        ]),
        el('div', { class: 'cls-calc-fields' }, [calcField('Class', select)]),
        body
      ])
    ]));
    draw();
  }

  // ---- View switching: COURSES / GRADE CALCULATOR ----
  function bindViews() {
    var buttons = document.querySelectorAll('.cls-view-btn');
    var courseView = $('#cls-course-view');
    var calcView = $('#cls-calc-view');
    buttons.forEach(function (b) {
      b.addEventListener('click', function () {
        var showCalc = b.dataset.view === 'calc';
        buttons.forEach(function (o) {
          var on = o === b;
          o.classList.toggle('is-active', on);
          o.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        courseView.hidden = showCalc;
        calcView.hidden = !showCalc;
      });
    });
  }

  // ---- Boot ----
  async function boot() {
    bindViews();
    var sub = $('#cls-subtitle');
    if (sub) sub.textContent = formatTermDate().toUpperCase();

    var data = await loadCourses();
    var courses = data.courses;

    var status = $('#cls-status');
    if (status) {
      var live = courses.some(function (c) { return c.source === 'canvas'; });
      status.textContent = live ? 'SYNCED' : 'NOT CONNECTED';
      if (!live) status.style.color = 'var(--c-amber)';
    }

    renderCalculator(courses);

    if (!courses.length) {
      var main = $('#cls-main');
      if (main) main.innerHTML = '<div class="cls-empty">' +
        (data.error || 'No classes yet. Go to Settings and save your Canvas domain and access token to sync your courses.') +
        '</div>';
      return;
    }
    var start = 0;
    try { start = parseInt(localStorage.getItem('jarvis-classes-tab'), 10) || 0; } catch (e) {}
    if (start >= courses.length) start = 0;
    renderTabs(courses, start);
    await renderPanels(courses);
    activate(start);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
