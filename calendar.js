/* ============================================================
   MASTER DASHBOARD · CALENDAR VIEW · CLIENT SCRIPT
   File: calendar.js
   Plain JS, no framework. Source of truth is /api/calendar/aggregated
   (which fans out to Google Calendar + Canvas + UCR holidays), with
   /api/agenda for the day-detail modal and /api/calendar/events/new
   for creating events.
   ============================================================ */

(function () {
  'use strict';

  /* -----------------------------------------------------------
     Aggregator event:
     {
         kind:        'class' | 'schedule-meeting' | 'meeting'
                    | 'personal' | 'assignment' | 'holiday',
         title:       string,
         date:        'YYYY-MM-DD',
         start:       'HH:MM' | null (all-day),
         end:         'HH:MM' | null,
         durationMin: number,
         allDay:      boolean,
         location?:   string,
         courseId?:   string,
         source?:     'schedule' | 'calendar' | 'canvas' | 'holidays',
         color?:      string (hex)
       }
     ----------------------------------------------------------- */

  var NOW = new Date();
  var MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
  var DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function todayISO() { return isoDate(NOW); }
  function addDays(d, n) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() + n);
    return x;
  }
  function addMonths(d, n) {
    var x = new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
    return x;
  }
  function mondayOfWeek(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var dow = (x.getDay() + 6) % 7; // 0 = Mon
    x.setDate(x.getDate() - dow);
    return x;
  }
  function formatLongDate(d) {
    return DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' +
           d.getDate() + ', ' + d.getFullYear();
  }
  function escapeText(s) { return String(s == null ? '' : s); }
  function fmtTime12(hhmm) {
    if (!hhmm) return '';
    var h = parseInt(hhmm.slice(0, 2), 10);
    var m = hhmm.slice(3, 5);
    return ((h % 12) || 12) + ':' + m + (h < 12 ? ' AM' : ' PM');
  }

  // Map aggregator kind → CSS category class so each kind has a color.
  // Holidays get their own background tint (orange-soft).
  function kindToClass(kind) {
    switch (kind) {
      case 'class':            return 'cat-class';
      case 'schedule-meeting': return 'cat-meeting';
      case 'meeting':          return 'cat-meeting';
      case 'personal':         return 'cat-personal';
      case 'assignment':       return 'cat-assignment';
      case 'holiday':          return 'cat-holiday';
      default:                 return 'cat-work';
    }
  }

  // ---------- DOM helpers ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k === 'dataset') {
          for (var d in attrs.dataset) {
            if (!Object.prototype.hasOwnProperty.call(attrs.dataset, d)) continue;
            node.dataset[d] = attrs.dataset[d];
          }
        }
        else node.setAttribute(k, attrs[k]);
      }
    }
    if (children) {
      for (var i = 0; i < children.length; i++) {
        var c = children[i];
        if (c == null) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return node;
  }
  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (data) {
        return { ok: r.ok, status: r.status, data: data };
      });
    });
  }

  // ---------- App state ----------
  var state = {
    events: [],       // aggregator events (all kinds)
    error: null,
    weekAnchor: new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate()),
    monthAnchor: new Date(NOW.getFullYear(), NOW.getMonth(), 1),
    view: 'day',
  };

  // ---------- Event card builders ----------
  function cardFor(ev) {
    var startStr = (ev.allDay || ev.start == null) ? 'ALL DAY' : escapeText(ev.start);
    var sub = (ev.durationMin && !ev.allDay && ev.start != null)
      ? (ev.durationMin + 'm')
      : '';
    return el('article', {
      class: 'cal-event ' + kindToClass(ev.kind),
      dataset: { id: ev.id || '', date: ev.date || '', kind: ev.kind || '' },
    }, [
      el('span', { class: 'cal-event-time', text: startStr + (sub ? ' \u00b7 ' + sub : '') }),
      el('span', { class: 'cal-event-title', text: escapeText(ev.title) }),
    ]);
  }
  function dayRowCard(ev) {
    var start = (ev.allDay || ev.start == null) ? 'ALL DAY' : escapeText(ev.start);
    var sub = (ev.durationMin && !ev.allDay && ev.start != null)
      ? (ev.durationMin + 'm')
      : '';
    return el('article', {
      class: 'cal-event ' + kindToClass(ev.kind),
      dataset: { id: ev.id || '', date: ev.date || '' },
    }, [
      el('div', { class: 'cal-event-time-col', text: start }),
      el('div', null, [
        el('h3', { class: 'cal-event-title', text: escapeText(ev.title) }),
        (ev.location || ev.courseId)
          ? el('div', { class: 'cal-event-meta' }, [
              ev.location ? el('span', { class: 'cal-event-tag', text: '@ ' + escapeText(ev.location) }) : null,
              ev.courseId ? el('span', { class: 'cal-event-tag', text: '#' + escapeText(ev.courseId) }) : null,
            ])
          : null,
      ]),
      sub ? el('div', { class: 'cal-event-time-col', text: sub }) : null,
    ]);
  }

  // ---------- DAY view ----------
  function renderDayView(events, anchorDate) {
    var dayISO = isoDate(anchorDate);
    var dayEvents = events
      .filter(function (e) { return e && e.date === dayISO; })
      .filter(function (e) { return e.kind !== 'holiday'; })
      .sort(function (a, b) {
        return (a.start || '99:99') < (b.start || '99:99') ? -1
             : (a.start || '99:99') > (b.start || '99:99') ?  1 : 0;
      });

    $('#dayViewTitle').textContent = formatLongDate(anchorDate).toUpperCase();
    $('#dayViewCount').textContent = dayEvents.length + ' EVENTS';

    var list = $('#dayTimeline');
    list.innerHTML = '';
    list.appendChild(el('li', { class: 'cal-day-agenda' }, [
      dayEvents.length === 0
        ? el('div', { class: 'cal-day-empty', text: 'Nothing scheduled today. Pick another day with the week or month view.' })
        : dayEvents.map(dayRowCard),
    ]));
  }

  // ---------- WEEK view ----------
  function renderWeekView(events, anchorDate) {
    var monday = mondayOfWeek(anchorDate);
    var sunday = addDays(monday, 6);

    $('#weekViewTitle').textContent = 'WEEK VIEW';
    $('#weekViewRange').textContent =
      pad(monday.getMonth() + 1) + '/' + pad(monday.getDate()) +
      ' \u2192 ' + pad(sunday.getMonth() + 1) + '/' + pad(sunday.getDate()) +
      ' \u00b7 ' + sunday.getFullYear();

    var grid = $('#weekGrid');
    grid.innerHTML = '';

    var dayLabels = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
    var tISO = todayISO();
    for (var i = 0; i < 7; i++) {
      var d = addDays(monday, i);
      var dISO = isoDate(d);
      var isToday = (dISO === tISO);

      var col = el('div', {
        class: 'cal-week-col' + (isToday ? ' is-today' : ''),
        dataset: { date: dISO },
      });

      col.appendChild(el('div', { class: 'cal-week-col-header' }, [
        document.createTextNode(dayLabels[i]),
        el('span', {
          class: 'cal-week-col-num',
          text: pad(d.getMonth() + 1) + '/' + pad(d.getDate()),
        }),
      ]));

      var dayEvents = events
        .filter(function (e) { return e && e.date === dISO; })
        .filter(function (e) { return e.kind !== 'holiday'; })
        .sort(function (a, b) {
          return (a.start || '99:99') < (b.start || '99:99') ? -1
               : (a.start || '99:99') > (b.start || '99:99') ?  1 : 0;
        });

      for (var j = 0; j < dayEvents.length; j++) col.appendChild(cardFor(dayEvents[j]));
      grid.appendChild(col);
    }
  }

  // ---------- MONTH view ----------
  function renderMonthView(events, anchorDate) {
    var y = anchorDate.getFullYear();
    var m = anchorDate.getMonth();
    var firstOfMonth = new Date(y, m, 1);
    var firstDow = (firstOfMonth.getDay() + 6) % 7; // 0 = Mon
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var daysInPrev  = new Date(y, m, 0).getDate();

    $('#monthViewTitle').textContent = (MONTHS[m] + ' ' + y).toUpperCase();
    var tISO = todayISO();
    var monthCount = events.filter(function (e) {
      return e && e.date && e.date.slice(0, 4) === String(y) &&
             parseInt(e.date.slice(5, 7), 10) === m + 1;
    }).length;
    $('#monthViewTag').textContent = monthCount + ' EVENTS THIS MONTH';

    var grid = $('#monthGrid');
    grid.innerHTML = '';

    var totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;
    var prevMonthTail = firstDow;
    var nextCursor = 1;

    for (var i = 0; i < totalCells; i++) {
      var cellDate, isOut = false, dayNum;
      if (i < prevMonthTail) {
        dayNum = daysInPrev - prevMonthTail + 1 + i;
        cellDate = new Date(y, m - 1, dayNum);
        isOut = true;
      } else if (i >= firstDow + daysInMonth) {
        dayNum = nextCursor++;
        cellDate = new Date(y, m + 1, dayNum);
        isOut = true;
      } else {
        dayNum = i - prevMonthTail + 1;
        cellDate = new Date(y, m, dayNum);
      }

      var cellISO = isoDate(cellDate);
      var cell = el('div', {
        class: 'cal-month-cell' +
               (isOut ? ' is-out' : '') +
               (cellISO === tISO ? ' cal-today' : ''),
        dataset: { date: cellISO },
      });
      cell.appendChild(el('div', {
        class: 'cal-month-num',
        text: String(dayNum),
      }));

      var cellEvents = events
        .filter(function (e) { return e && e.date === cellISO; })
        .sort(function (a, b) {
          return (a.start || '99:99') < (b.start || '99:99') ? -1
               : (a.start || '99:99') > (b.start || '99:99') ?  1 : 0;
        });

      var max = 3;
      var shown = cellEvents.slice(0, max);
      for (var k = 0; k < shown.length; k++) {
        var ev = shown[k];
        var chip = el('div', {
          class: 'cal-event ' + kindToClass(ev.kind),
          title: escapeText((ev.allDay || ev.start == null ? 'All day' : ev.start) + ' \u00b7 ' + ev.title),
          text: escapeText((ev.allDay || ev.start == null ? '' : ev.start + ' ') + ev.title),
        });
        cell.appendChild(chip);
      }
      if (cellEvents.length > max) {
        cell.appendChild(el('div', {
          class: 'cal-month-more',
          text: '+ ' + (cellEvents.length - max) + ' more',
        }));
      }

      grid.appendChild(cell);
    }
  }

  // ---------- Tab switching ----------
  function bindTabs() {
    var tabs  = document.querySelectorAll('.cal-tab');
    var views = {
      day:   $('#viewDay'),
      week:  $('#viewWeek'),
      month: $('#viewMonth'),
    };
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var name = tab.dataset.tab;
        state.view = name;
        tabs.forEach(function (t) {
          var active = (t === tab);
          t.classList.toggle('is-active', active);
          t.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        Object.keys(views).forEach(function (k) {
          var v = views[k];
          var on = (k === name);
          v.classList.toggle('is-visible', on);
          if (on) v.removeAttribute('hidden'); else v.setAttribute('hidden', '');
          v.setAttribute('aria-hidden', on ? 'false' : 'true');
        });
      });
    });
  }

  // ---------- Header clock + subtitle + status ----------
  function tickClock() {
    var d = new Date();
    var hh = pad(d.getHours());
    var mm = pad(d.getMinutes());
    var ss = pad(d.getSeconds());
    var elc = $('#calClock');
    if (elc) elc.textContent = hh + ':' + mm + ':' + ss;
  }
  function paintHeader() {
    var sub = $('#calSub');
    if (sub) sub.textContent = formatLongDate(NOW).toUpperCase();
    tickClock();
    setInterval(tickClock, 1000);
  }

  // ---------- Week + month nav ----------
  function bindNav() {
    var prev = $('#calPrev'), today = $('#calToday'), next = $('#calNext');
    if (prev) prev.addEventListener('click', function () {
      state.weekAnchor = addDays(state.weekAnchor, -7);
      renderWeekView(state.events, state.weekAnchor);
    });
    if (today) today.addEventListener('click', function () {
      state.weekAnchor = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
      renderWeekView(state.events, state.weekAnchor);
    });
    if (next) next.addEventListener('click', function () {
      state.weekAnchor = addDays(state.weekAnchor, 7);
      renderWeekView(state.events, state.weekAnchor);
    });

    var mp = $('#calMonthPrev'), mt = $('#calMonthToday'), mn = $('#calMonthNext');
    if (mp) mp.addEventListener('click', function () {
      state.monthAnchor = addMonths(state.monthAnchor, -1);
      renderMonthView(state.events, state.monthAnchor);
    });
    if (mt) mt.addEventListener('click', function () {
      state.monthAnchor = new Date(NOW.getFullYear(), NOW.getMonth(), 1);
      renderMonthView(state.events, state.monthAnchor);
    });
    if (mn) mn.addEventListener('click', function () {
      state.monthAnchor = addMonths(state.monthAnchor, 1);
      renderMonthView(state.events, state.monthAnchor);
    });
  }

  // ---------- Load aggregated events ----------
  async function loadAggregated() {
    try {
      var r = await fetchJSON('/api/calendar/aggregated');
      if (!r.ok) return { events: [], error: (r.data && r.data.error) || 'Could not load calendar.' };
      // Aggregator returns a flat array (legacy /api/calendar/events returns {events:[]}).
      var arr = Array.isArray(r.data) ? r.data
              : (Array.isArray(r.data && r.data.events) ? r.data.events : []);
      return { events: arr, error: null };
    } catch (e) {
      return { events: [], error: 'Could not reach the dashboard server. Make sure it is running.' };
    }
  }

  // ---------- Day-detail modal (opens when any day is clicked) ----------
  function daySection(title, count, rows, emptyText) {
    return el('section', { class: 'cal-day-sec' }, [
      el('div', { class: 'cal-day-sec-head' }, [
        el('span', { text: title }),
        el('span', { class: 'cal-day-sec-count', text: String(count) }),
      ]),
      rows.length ? rows : [el('div', { class: 'cal-day-empty', text: emptyText })],
    ]);
  }
  function dayRow(time, title, sub) {
    return el('div', { class: 'cal-day-row' }, [
      el('div', { class: 'cal-day-time', text: time }),
      el('div', { class: 'cal-day-main' }, [
        el('div', { class: 'cal-day-name', text: title }),
        sub ? el('div', { class: 'cal-day-note', text: sub }) : null,
      ]),
    ]);
  }
  function fillAgenda(body, iso) {
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'cal-day-empty', text: 'Loading\u2026' }));
    return fetchJSON('/api/agenda?date=' + iso).then(function (r) {
      if (!r.ok || !r.data) throw new Error('Could not load this day.');
      var a = r.data;
      body.innerHTML = '';
      body.appendChild(daySection('CLASSES', a.classes.length, a.classes.map(function (c) {
        return dayRow(
          fmtTime12(c.start) + ' \u2013 ' + fmtTime12(c.end),
          c.label,
          [c.course, c.location].filter(Boolean).join(' \u00b7 ')
        );
      }), 'No classes.'));
      body.appendChild(daySection('EVENTS', a.events.length, a.events.map(function (e) {
        var allDay = e.durationMin >= 1440;
        var bits = [];
        if (e.location) bits.push('@ ' + e.location);
        if (e.notes) bits.push(e.notes.length > 140 ? e.notes.slice(0, 140) + '\u2026' : e.notes);
        return dayRow(
          allDay ? 'ALL DAY' : fmtTime12(e.start),
          e.title,
          bits.join(' \u00b7 ')
        );
      }), (a.errors && a.errors.calendar) || 'Nothing on your calendar.'));
      body.appendChild(daySection('DUE ON CANVAS', a.due.length, a.due.map(function (x) {
        var done = x.status === 'submitted' || x.status === 'graded';
        return dayRow(
          fmtTime12(x.time),
          x.title,
          x.course + (x.points ? ' \u00b7 ' + x.points + ' pts' : '') + (done ? ' \u00b7 done' : '')
        );
      }), (a.errors && a.errors.canvas) || 'Nothing due.'));
    }).catch(function (e) {
      body.innerHTML = '';
      body.appendChild(el('div', { class: 'cal-day-empty', text: e.message || 'Could not load this day.' }));
    });
  }
  function openDay(iso) {
    var backdrop = $('#calDayBackdrop');
    if (!backdrop) return;
    var d = new Date(iso + 'T00:00:00');
    $('#calDayTitle').textContent = formatLongDate(d).toUpperCase();
    $('#calDaySub').textContent = (iso === todayISO()) ? 'TODAY' : '';
    backdrop.hidden = false;
    fillAgenda($('#calDayBody'), iso);
  }
  function bindDayDetail() {
    var backdrop = $('#calDayBackdrop');
    if (!backdrop) return;
    var close = function () { backdrop.hidden = true; };
    var closeBtn = $('#calDayClose');
    if (closeBtn) closeBtn.addEventListener('click', close);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !backdrop.hidden) close();
    });
    var addBtn = $('#calDayAdd');
    if (addBtn) addBtn.addEventListener('click', function () {
      var date = $('#calDayTitle').dataset.date || todayISO();
      // date is encoded in the modal title's iso mapping; fall back to today.
      close();
      if (window.__openNewEvent) window.__openNewEvent(date);
    });
    // Delegated click for any [data-date] element (week cols + month cells).
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-date]');
      if (!t || !t.dataset.date) return;
      // Don't open when clicking an event card; open on cell/column only.
      if (e.target.closest('.cal-event')) return;
      openDay(t.dataset.date);
    });
  }

  // ---------- New Event modal ----------
  function bindNewEventForm() {
    var backdrop  = $('#calModalBackdrop');
    var openBtn   = $('#calNewEventBtn');
    var closeBtn  = $('#calModalClose');
    var cancelBtn = $('#calFormCancel');
    var form      = $('#calNewEventForm');
    var errorEl   = $('#calFormError');
    var submitBtn = $('#calFormSubmit');
    if (!backdrop || !openBtn || !form) return;

    function openModal(dateISO) {
      errorEl.textContent = '';
      form.reset();
      $('#calFormDate').value = (typeof dateISO === 'string' && dateISO) ? dateISO : todayISO();
      backdrop.hidden = false;
      $('#calFormTitle').focus();
    }
    function closeModal() { backdrop.hidden = true; }

    window.__openNewEvent = openModal;
    openBtn.addEventListener('click', function () { openModal(todayISO()); });
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) closeModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !backdrop.hidden) closeModal();
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errorEl.textContent = '';

      var title    = $('#calFormTitle').value.trim();
      var date     = $('#calFormDate').value;
      var start    = $('#calFormStart').value;
      var end      = $('#calFormEnd').value;
      var location = $('#calFormLocation').value.trim();
      var notes    = $('#calFormNotes').value.trim();

      if (!title || !date || !start || !end) {
        errorEl.textContent = 'Title, date, start, and end are required.';
        return;
      }
      if (end <= start) {
        errorEl.textContent = 'End time must be after start time.';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'CREATING\u2026';

      fetch('/api/calendar/events/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title, date: date, start: start, end: end,
          location: location || undefined, notes: notes || undefined,
        }),
      })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (result) {
          if (!result.ok || !result.data.ok) {
            throw new Error((result.data && result.data.error) || 'Failed to create event');
          }
          closeModal();
          return boot();
        })
        .catch(function (err) {
          errorEl.textContent = err.message;
        })
        .then(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = 'CREATE EVENT';
        });
    });
  }

  // ---------- Boot ----------
  async function boot() {
    try {
      paintHeader();
      var loaded = await loadAggregated();
      state.events = loaded.events;
      state.error = loaded.error;

      var statusEl = $('#calSourceStatus');
      if (statusEl) statusEl.textContent = loaded.error ? 'OFFLINE' : 'AGGREGATED';
      var noticeEl = $('#calNotice');
      if (noticeEl) {
        noticeEl.textContent = loaded.error || '';
        noticeEl.hidden = !loaded.error;
      }

      // Read-only export for other modules (chat, rescheduler, study planner).
      window.__JARVIS_CALENDAR__ = {
        events: state.events,
        today:  todayISO(),
        now:    NOW.toISOString(),
        source: loaded.error ? 'unavailable' : 'aggregated',
      };

      renderDayView(state.events, NOW);
      renderWeekView(state.events, state.weekAnchor);
      renderMonthView(state.events, state.monthAnchor);
    } catch (err) {
      // Render whatever state we have so the user sees the tabs even when
      // data loading fails; surface the error so it isn't silently dropped.
      try {
        renderDayView(state.events || [], NOW);
        renderWeekView(state.events || [], state.weekAnchor);
        renderMonthView(state.events || [], state.monthAnchor);
      } catch (_) { /* swallow render error */ }
      var noticeEl2 = $('#calNotice');
      if (noticeEl2) {
        noticeEl2.textContent = 'Calendar failed to load: ' + (err && err.message ? err.message : String(err));
        noticeEl2.hidden = false;
      }
      console.error('[calendar] boot failed', err);
    }
  }

  // Bind UI synchronously so tabs, nav, modals are live before data
  // arrives. Anything that needs data is re-rendered from boot().
  function bindAll() {
    bindTabs();
    bindNav();
    bindNewEventForm();
    bindDayDetail();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      bindAll();
      boot();
    });
  } else {
    bindAll();
    boot();
  }
})();