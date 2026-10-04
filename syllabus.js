/* ============================================================
   SYLLABUS LIBRARY · JARVIS-STYLE (local dashboard build)
   - Inlines the thin Canvas client (no canvas.js in this repo)
   - Uses textContent / createElement only for anything user-supplied
   - Endpoints hit the same paths as the legacy version
   ============================================================ */

(function (global) {
  'use strict';

  // ----- Inline Canvas client ---------------------------------------------
  // The legacy dashboard loads /canvas.js as a separate file. This repo has
  // no such file (and we can't create one outside syllabus.{html,css,js}),
  // so the same shape lives here. The browser still talks to the server
  // through the same /api/canvas/* paths and the server forwards them to
  // either the legacy JARVIS proxy or the local Canvas implementation.

  var NOT_CONNECTED = 'Canvas is not connected. Open Settings and save your Canvas domain and access token.';

  async function canvasGetToken() {
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

  async function canvasFetch(path) {
    await canvasGetToken();
    var resp = await fetch(path, { credentials: 'same-origin' });
    var data = await resp.json();
    if (!resp.ok || (data && data.error)) {
      throw new Error((data && data.error) || 'Canvas request failed (HTTP ' + resp.status + ').');
    }
    return data;
  }

  global.Canvas = {
    getCanvasToken: canvasGetToken,
    isConnected: function () { return canvasGetToken().then(function () { return true; }).catch(function () { return false; }); },
    getCourses: function () { return canvasFetch('/api/canvas/courses'); },
    getAssignments: function (id) { return canvasFetch('/api/canvas/courses/' + encodeURIComponent(id) + '/assignments'); },
    getSyllabus: function (id) { return canvasFetch('/api/canvas/courses/' + encodeURIComponent(id) + '/syllabus'); },
  };

  // ----- Module state -----------------------------------------------------
  var COURSES = [];
  var LOAD_ERROR = null;
  var ACTIVE_ID = null;

  // ----- Tiny DOM helpers -------------------------------------------------
  function el(id) { return document.getElementById(id); }
  function tag(name, props, children) {
    var node = document.createElement(name);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v == null) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'data') {
          Object.keys(v).forEach(function (dk) { node.dataset[dk] = v[dk]; });
        } else if (k === 'style' && typeof v === 'object') {
          Object.keys(v).forEach(function (sk) { node.style[sk] = v[sk]; });
        } else {
          node.setAttribute(k, v);
        }
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function setText(id, text) { var n = el(id); if (n) n.textContent = text == null ? '' : String(text); }

  function setStatus(text, state) {
    var s = el('sylStatus');
    if (!s) return;
    s.textContent = text;
    if (state) s.setAttribute('data-state', state);
    else s.removeAttribute('data-state');
  }

  // ----- Data loading -----------------------------------------------------
  async function loadCourses() {
    try {
      var resp = await fetch('/api/courses/all', { credentials: 'same-origin' });
      var data = await resp.json();
      if (!resp.ok || !Array.isArray(data)) {
        throw new Error('Could not load your classes.');
      }
      return data.map(function (c) {
        return {
          id: c.id,
          code: c.code,
          name: c.name,
          instructor: c.instructor || '—',
          term: c.term || '—',
          credits: c.credits > 0 ? c.credits + ' CR' : '',
          rawSource: c.source,
          notes: c.syllabus || null,
          _lazy: c.source === 'canvas',
        };
      });
    } catch (e) {
      LOAD_ERROR = e.message;
      return [];
    }
  }

  // ----- Render: course list -----------------------------------------------
  function renderCourseList() {
    var list = el('courseList');
    clear(list);
    setText('courseCount', COURSES.length + ' TOTAL');

    var hasCanvas = COURSES.some(function (c) { return c.rawSource === 'canvas'; });
    setStatus(hasCanvas ? 'LIVE · CANVAS' : 'NOT CONNECTED', hasCanvas ? 'ok' : '');

    if (!COURSES.length) {
      list.appendChild(tag('li', { class: 'course-empty', text: LOAD_ERROR || 'No classes yet.' }));
      return;
    }

    COURSES.forEach(function (c) {
      var row = tag('li', {
        class: 'course-row' + (c.id === ACTIVE_ID || (!ACTIVE_ID && c === COURSES[0]) ? ' active' : ''),
        role: 'option',
        tabindex: '0',
        data: { id: String(c.id) },
      }, [
        tag('div', { class: 'row-top' }, [
          tag('span', { class: 'row-code', text: c.code || '' }),
          tag('span', { class: 'row-credits', text: c.credits || '' }),
        ]),
        tag('span', { class: 'row-name', text: c.name || 'Untitled course' }),
        tag('span', { class: 'row-instructor', text: c.instructor || '—' }),
      ]);
      row.addEventListener('click', function () { selectCourse(c.id); });
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectCourse(c.id);
        }
      });
      list.appendChild(row);
    });
  }

  // ----- Render: syllabus viewer ------------------------------------------
  function emptyPara(text) {
    return tag('p', { class: 'syl-empty', text: text });
  }

  function buildSummarySection(notes) {
    if (!notes) return null;
    var paragraphs = notes.summary || [];
    if (!paragraphs.length && !(notes.watch || []).length) return null;

    var children = [];
    if (paragraphs.length) {
      children.push(
        tag('section', { class: 'syl-section' }, [
          tag('h3', null, [
            document.createTextNode('SUMMARY '),
            tag('span', { class: 'syl-src', text: notes.source || '' }),
          ]),
        ].concat(paragraphs.map(function (p) { return tag('p', { text: p }); })))
      );
    }
    if ((notes.watch || []).length) {
      var watchItems = notes.watch.map(function (w) { return tag('li', { text: w }); });
      children.push(
        tag('section', { class: 'syl-section syl-watch' }, [
          tag('h3', { text: 'WATCH OUT FOR' }),
          tag('ul', null, watchItems),
        ])
      );
    }
    return children;
  }

  function buildDescriptionSection(course, notes) {
    var description = Array.isArray(course.description) ? course.description : [];
    var paragraphs = description.length
      ? description.map(function (p) { return tag('p', { text: p }); })
      : [emptyPara('No syllabus content posted yet.')];
    return tag('section', { class: 'syl-section' }, [
      tag('h3', { text: notes ? 'CANVAS SYLLABUS PAGE' : 'COURSE DESCRIPTION' }),
    ].concat(paragraphs));
  }

  function buildGradingSection(course, notes) {
    var grading = notes && notes.grading
      ? notes.grading
      : (Array.isArray(course.grading) ? course.grading : []);
    var inner;
    if (grading.length) {
      var rows = grading.map(function (g) {
        var pctNum = Number(g.pct);
        var pctText = isFinite(pctNum) ? (Math.round(pctNum * 10) / 10) + '%' : '';
        var widthStyle = isFinite(pctNum) ? pctNum + '%' : '0%';
        return tag('div', { class: 'grade-row' }, [
          tag('span', { class: 'grade-label', text: g.label || '' }),
          tag('span', { class: 'grade-pct', text: pctText }),
          tag('div', { class: 'grade-bar' }, [
            tag('span', { style: { width: widthStyle } }),
          ]),
        ]);
      });
      inner = tag('div', { class: 'grade-list' }, rows);
    } else {
      inner = emptyPara('Not provided by Canvas for this course — check the description above.');
    }
    return tag('section', { class: 'syl-section' }, [
      tag('h3', { text: 'GRADING BREAKDOWN' }),
      inner,
    ]);
  }

  function buildOfficeHoursSection(course, notes) {
    var officeList = notes && notes.office
      ? notes.office
      : (course.office ? [course.office] : []);
    var inner;
    if (officeList.length) {
      var blocks = officeList.map(function (office) {
        return tag('div', { class: 'detail-list' }, [
          tag('div', { class: 'detail-item' }, [
            tag('span', { class: 'detail-key', text: 'WHO' }),
            tag('span', { class: 'detail-val', text: office.who || '' }),
          ]),
          tag('div', { class: 'detail-item' }, [
            tag('span', { class: 'detail-key', text: 'TIME' }),
            tag('span', { class: 'detail-val', text: office.when || '' }),
          ]),
          tag('div', { class: 'detail-item' }, [
            tag('span', { class: 'detail-key', text: 'LOCATION' }),
            tag('span', { class: 'detail-val', text: office.where || '' }),
          ]),
        ]);
      });
      inner = blocks.length === 1 ? blocks[0] : tag('div', null, blocks);
    } else {
      inner = emptyPara('Not provided by Canvas for this course.');
    }
    return tag('section', { class: 'syl-section' }, [
      tag('h3', { text: 'OFFICE HOURS' }),
      inner,
    ]);
  }

  function buildExamSection(course, notes) {
    var exams = notes && notes.keyDates && notes.keyDates.length
      ? notes.keyDates
      : (Array.isArray(course.exams) ? course.exams : []);
    var inner;
    if (exams.length) {
      var items = exams.map(function (ex) {
        return tag('div', { class: 'detail-item exam-item' }, [
          tag('span', { class: 'detail-key', text: String(ex.label || '').toUpperCase() }),
          tag('span', { class: 'detail-val', text: formatDate(ex.date) }),
        ]);
      });
      inner = tag('div', { class: 'detail-list' }, items);
    } else {
      inner = emptyPara('Not provided by Canvas for this course.');
    }
    return tag('section', { class: 'syl-section' }, [
      tag('h3', { text: notes ? 'KEY DATES' : 'EXAM DATES' }),
      inner,
    ]);
  }

  function renderSyllabus(course) {
    setText('sylCode', course.code || '—');
    setText('sylTitle', course.name || 'Untitled course');
    setText('sylInstructor', course.instructor || '—');
    setText('sylTerm', course.term || '—');
    setText('sylCredits', course.credits || '—');

    var body = el('sylBody');
    clear(body);

    var notesObj = course.notes || null;
    var summaryNodes = buildSummarySection(notesObj);
    if (summaryNodes) {
      summaryNodes.forEach(function (n) { body.appendChild(n); });
    }

    body.appendChild(buildDescriptionSection(course, notesObj));
    body.appendChild(buildGradingSection(course, notesObj));
    body.appendChild(buildOfficeHoursSection(course, notesObj));
    body.appendChild(buildExamSection(course, notesObj));
  }

  function renderEmptyBody(message) {
    var body = el('sylBody');
    clear(body);
    setText('sylCode', '—');
    setText('sylTitle', 'No course selected');
    setText('sylInstructor', '');
    setText('sylTerm', '—');
    setText('sylCredits', '—');
    body.appendChild(emptyPara(message));
  }

  // ----- Selection ---------------------------------------------------------
  async function selectCourse(id) {
    var course = COURSES.find(function (c) { return c.id === id; });
    if (!course) return;
    ACTIVE_ID = id;

    document.querySelectorAll('.course-row').forEach(function (row) {
      row.classList.toggle('active', row.dataset.id === String(id));
    });

    if (course.rawSource === 'manual' && !course._syllabusLoaded) {
      course.description = ['This class isn’t on Canvas yet. Its syllabus will appear here once your professor posts the course.'];
      course._syllabusLoaded = true;
    }
    if (course._lazy && !course._syllabusLoaded) {
      try {
        var syl = await window.Canvas.getSyllabus(course.id);
        course.description = syl.paragraphs || [];
        course.grading = syl.grading || [];
        course.office = syl.officeHours ? { who: course.instructor, when: syl.officeHours, where: '' } : null;
        course.exams = syl.examDates ? syl.examDates.map(function (d) { return { label: 'Exam', date: d }; }) : [];
      } catch (e) {
        course.description = ['Could not load syllabus from Canvas: ' + e.message];
        course.grading = [];
        course.office = null;
        course.exams = [];
      }
      course._syllabusLoaded = true;
    }

    renderSyllabus(course);
  }

  // ----- Helpers ----------------------------------------------------------
  function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
    });
  }

  // ----- Boot -------------------------------------------------------------
  function boot() {
    setStatus('CONNECTING…', '');
    loadCourses().then(function (list) {
      COURSES = list;
      renderCourseList();
      if (COURSES.length) {
        selectCourse(COURSES[0].id);
      } else {
        renderEmptyBody(LOAD_ERROR || 'No classes yet. Connect Canvas in Settings (Canvas domain + access token) to see your syllabi.');
        setStatus('OFFLINE', 'partial');
      }
    }).catch(function (e) {
      LOAD_ERROR = e && e.message ? e.message : 'Unexpected error.';
      renderCourseList();
      renderEmptyBody(LOAD_ERROR);
      setStatus('OFFLINE', 'partial');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);