/* ============================================================
   MASTER DASHBOARD · CALENDAR PAGE · APP
   File: calendar.js
   Multi-tab week view: Overview, Classes, Meetings, Assignments,
   Study (placeholder). Fetches /api/calendar/aggregated once,
   caches it, and re-renders locally on tab / week navigation.
   ============================================================ */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var DAY_SHORT = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  var MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var KIND_COLORS = {
    'class': '#00E5FF',
    'schedule-meeting': '#00E5FF',
    'meeting': '#2979FF',
    'personal': '#7EE2FF',
    'assignment': '#FF9100',
    'holiday': '#FF9100',
  };

  /* ---------- State ---------- */
  var state = {
    items: [],        // aggregated events from the server
    holidays: [],     // extracted separately so we can render bands regardless of tab
    tab: 'overview',  // active tab key
    anchor: null,     // Date object for any day in the displayed week
    minH: 8,
    maxH: 22,
  };

  /* ---------- Date helpers ---------- */
  function startOfWeekMon(d) {
    var out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var dow = (out.getDay() + 6) % 7; // Mon=0..Sun=6
    out.setDate(out.getDate() - dow);
    return out;
  }
  function addDays(d, n) {
    var out = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    return out;
  }
  function isoDay(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1);
    var dd = String(d.getDate());
    return y + '-' + (m.length < 2 ? '0' + m : m) + '-' + (dd.length < 2 ? '0' + dd : dd);
  }
  function monthLabel(d) {
    return MONTH_SHORT[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }
  function monthRangeLabel(start, end) {
    // start = Mon, end = Sun (start + 6)
    if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
      return MONTH_SHORT[start.getMonth()] + ' ' + start.getDate() + '\u2013' + end.getDate() + ', ' + start.getFullYear();
    }
    if (start.getFullYear() === end.getFullYear()) {
      return MONTH_SHORT[start.getMonth()] + ' ' + start.getDate() + ' \u2013 ' + MONTH_SHORT[end.getMonth()] + ' ' + end.getDate() + ', ' + start.getFullYear();
    }
    return monthLabel(start) + ' \u2013 ' + monthLabel(end);
  }
  function time12(hhmm) {
    if (!hhmm) return '';
    var p = String(hhmm).split(':');
    if (p.length < 2) return hhmm;
    var h = parseInt(p[0], 10);
    var m = p[1];
    var ap = h >= 12 ? 'p' : 'a';
    var h12 = ((h + 11) % 12) + 1;
    return h12 + (m === '00' ? '' : ':' + m) + ap;
  }

  /* ---------- Fetch ---------- */
  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return { error: 'HTTP ' + r.status }; }).then(function (d) {
          d._status = r.status;
          return d;
        });
      }
      return r.json();
    });
  }
  function loadAggregated() {
    setStatus('', 'loading\u2026');
    var rb = $('calRefresh');
    if (rb) rb.disabled = true;
    return fetchJSON('/api/calendar/aggregated').then(function (data) {
      if (rb) rb.disabled = false;
      if (data && data.error) {
        setStatus('partial', String(data.error).toUpperCase());
        state.items = [];
        state.holidays = [];
        renderSub('Server returned: ' + data.error);
        renderGrid();
        return;
      }
      // /api/calendar/aggregated returns a flat array; legacy /api/calendar/events
      // returns { events: [...] }. Accept either shape.
      var events = Array.isArray(data)
        ? data
        : (Array.isArray(data && data.events) ? data.events : []);
      var items = events.filter(function (e) { return e && e.kind && e.kind !== 'holiday'; });
      var holidays = events.filter(function (e) { return e && e.kind === 'holiday'; });
      state.items = items;
      state.holidays = holidays;
      if (events.length) {
        setStatus('ok', 'CONNECTED');
        renderSub(events.length + ' EVENTS \u00B7 ' + items.length + ' SCHEDULED');
      } else {
        setStatus('', 'NO DATA');
        renderSub('No events returned by the server.');
      }
      renderGrid();
    }).catch(function () {
      if (rb) rb.disabled = false;
      setStatus('partial', 'OFFLINE');
      state.items = [];
      state.holidays = [];
      renderSub('Could not reach the dashboard server.');
      renderGrid();
    });
  }

  /* ---------- DOM helpers ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function setStatus(stateName, text) {
    var s = $('calStatus');
    if (!s) return;
    s.textContent = text;
    if (stateName) s.setAttribute('data-state', stateName);
    else s.removeAttribute('data-state');
  }
  function renderSub(text) {
    var s = $('calSub');
    if (s) s.textContent = text;
  }

  /* ---------- Filter & render ---------- */
  function filterFor(tab) {
    var all = state.items.concat([]); // shallow copy
    var out;
    switch (tab) {
      case 'classes':
        out = all.filter(function (e) {
          return e.kind === 'class' || e.kind === 'schedule-meeting';
        });
        break;
      case 'meetings':
        out = all.filter(function (e) {
          return e.kind === 'meeting' || e.kind === 'personal';
        });
        break;
      case 'assignments':
        out = all.filter(function (e) { return e.kind === 'assignment'; });
        break;
      case 'study':
        return []; // empty by design
      case 'overview':
      default:
        out = all;
        break;
    }
    return out;
  }

  function inRange(item, ws, we) {
    // ws/we are local Date objects for Mon 00:00 and Sun 23:59 of the displayed week
    if (!item || !item.date) return false;
    var ymd = item.date.slice(0, 10);
    if (ymd.length !== 10) return false;
    var y = parseInt(ymd.slice(0, 4), 10);
    var m = parseInt(ymd.slice(5, 7), 10) - 1;
    var d = parseInt(ymd.slice(8, 10), 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return false;
    var itemDay = new Date(y, m, d);
    return itemDay.getTime() >= ws.getTime() && itemDay.getTime() <= we.getTime();
  }

  function colorFor(item) {
    if (item && item.color) return item.color;
    return KIND_COLORS[item && item.kind] || '#00E5FF';
  }

  function renderGrid() {
    var host = $('calGridHost');
    if (!host) return;
    host.replaceChildren();

    // Study placeholder
    if (state.tab === 'study') {
      var sWrap = el('div', 'cal-study');
      sWrap.appendChild(el('span', 'cal-study-mark', 'STUDY OPTIMIZER'));
      sWrap.appendChild(el('div', 'cal-study-title', 'Coming Soon'));
      sWrap.appendChild(el('div', 'cal-study-sub',
        'Study calendar will be added once the cron job syncs your assignments and class schedule.'
      ));
      host.appendChild(sWrap);
      updateRangeLabel();
      return;
    }

    // Empty data state — check whether Google is connected so the message
    // can either include the connect button (when not) or just explain the
    // quiet week (when connected).
    if (!state.items.length && !state.holidays.length) {
      var empty = el('div', 'cal-empty cal-empty-warn');
      var heading = el('div', 'cal-empty-title', 'Nothing scheduled this week.');
      empty.appendChild(heading);
      var oauthHost = el('div', 'cal-empty-oauth');
      empty.appendChild(oauthHost);
      host.appendChild(empty);
      // Probe OAuth so we can offer the connect link when relevant.
      fetchJSON('/oauth/status').then(function (s) {
        if (s && s.connected) {
          oauthHost.appendChild(el('div', 'cal-empty-sub',
            'No Google Calendar events and no upcoming Canvas assignments ' +
            'in this range. Toggle tabs above to check Classes, Meetings, ' +
            'or Assignments — or pick a different week with the arrows.'));
        } else {
          oauthHost.appendChild(el('div', 'cal-empty-sub',
            'Google Calendar is not connected. Connect it below to pull ' +
            'your schedule, meetings, and assignment reminders here.'));
          var link = el('a', 'cal-empty-cta', 'Connect Google Calendar');
          link.href = '/oauth/start';
          link.target = '_self';
          link.rel = 'noopener';
          oauthHost.appendChild(link);
        }
        updateRangeLabel();
      }).catch(function () {
        oauthHost.appendChild(el('div', 'cal-empty-sub',
          'Could not reach the dashboard server. Refresh the page or ' +
          'check that server.js is running.'));
        updateRangeLabel();
      });
      updateRangeLabel();
      return;
    }

    // Compute displayed week from anchor
    var anchor = state.anchor || new Date();
    var ws = startOfWeekMon(anchor);
    var we = addDays(ws, 6);
    var now = new Date();

    // Items in range, filtered by current tab
    var filtered = filterFor(state.tab).filter(function (e) { return inRange(e, ws, we); });

    // Determine hour bounds: default 8-22, expand for items that need it.
    var minH = 8, maxH = 22;
    filtered.forEach(function (e) {
      if (!e || e.allDay) return;
      if (typeof e.start !== 'string') return;
      var p = e.start.split(':');
      if (p.length < 2) return;
      var h = parseInt(p[0], 10);
      if (isNaN(h)) return;
      var endMin = h * 60 + parseInt(p[1], 10) + (typeof e.durationMin === 'number' ? e.durationMin : 60);
      var endH = Math.ceil(endMin / 60);
      if (h < minH) minH = h;
      if (endH > maxH) maxH = Math.min(endH, 24);
    });
    if (maxH <= minH) maxH = minH + 1;
    state.minH = minH;
    state.maxH = maxH;
    var hourCount = maxH - minH;
    var hourPx = 60;

    var week = el('div', 'cal-week');
    week.style.setProperty('--cal-hour-px', hourPx + 'px');

    // Time column (header spacer + time labels)
    var times = el('div', 'cal-times');
    times.appendChild(el('div', 'cal-times-spacer'));
    for (var h = minH; h < maxH; h++) {
      times.appendChild(el('span', 'cal-time-slot', time12(h + ':00')));
    }
    week.appendChild(times);

    // Per-day columns
    var todayIso = isoDay(now);
    for (var d = 0; d < 7; d++) {
      var dayDate = addDays(ws, d);
      var dayIso = isoDay(dayDate);
      var day = el('div', 'cal-day' + (dayIso === todayIso ? ' is-today' : ''));

      // Day header (MON + 6)
      var head = el('div', 'cal-day-head');
      head.appendChild(el('span', null, DAY_SHORT[d]));
      head.appendChild(el('span', 'cal-day-num', String(dayDate.getDate())));
      day.appendChild(head);

      // All-day strip
      var allDay = el('div', 'cal-all-day');
      var dayItems = filtered.filter(function (e) { return e.date === dayIso && (e.allDay || e.kind === 'assignment'); });
      dayItems.forEach(function (e) {
        var chip = el('span', 'cal-all-day-item cal-kind-' + (e.kind || 'meeting'));
        chip.textContent = e.title || '(untitled)';
        chip.title = e.title || '';
        allDay.appendChild(chip);
      });
      day.appendChild(allDay);

      // Time-positioned body
      var body = el('div', 'cal-day-body');
      body.style.height = (hourCount * hourPx) + 'px';

      // Holiday band (always visible when applicable)
      var dayHols = state.holidays.filter(function (h) { return h.date === dayIso; });
      dayHols.forEach(function (h) {
        var band = el('div', 'cal-holiday');
        band.title = h.title || 'Holiday';
        body.appendChild(band);
        if (h.title) {
          var lbl = el('div', 'cal-holiday-label');
          lbl.textContent = h.title;
          body.appendChild(lbl);
        }
      });

      // Timed events (skip all-day & assignment placeholders, which are in the strip)
      var timed = filtered.filter(function (e) {
        return e.date === dayIso && !e.allDay && e.kind !== 'assignment' && typeof e.start === 'string';
      });
      timed.forEach(function (e) {
        var p = String(e.start).split(':');
        if (p.length < 2) return;
        var sh = parseInt(p[0], 10);
        var sm = parseInt(p[1], 10);
        if (isNaN(sh) || isNaN(sm)) return;
        var dur = typeof e.durationMin === 'number' && e.durationMin > 0 ? e.durationMin : 60;
        var startMin = sh * 60 + sm;
        var endMin = Math.min(startMin + dur, maxH * 60);
        if (endMin <= minH * 60) return;
        if (startMin < minH * 60) startMin = minH * 60;
        var top = (startMin - minH * 60) / 60 * hourPx;
        var height = Math.max(18, (endMin - startMin) / 60 * hourPx - 2);
        var block = el('div', 'cal-block');
        block.style.top = top + 'px';
        block.style.height = height + 'px';
        block.style.setProperty('--cal-block-c', colorFor(e));
        var titleText = e.title || '(untitled)';
        block.title = titleText +
          (e.location ? ' \u00B7 ' + e.location : '') +
          ' (' + time12(e.start) + (e.durationMin ? '\u2013' + time12(addMinutesHHMM(e.start, e.durationMin)) : '') + ')';
        var b = el('b', null, titleText);
        block.appendChild(b);
        if (height > 30) {
          var t1 = el('span', 'cal-block-time', time12(e.start));
          block.appendChild(t1);
        }
        if (height > 56 && e.location) {
          var t2 = el('span', 'cal-block-loc', e.location);
          block.appendChild(t2);
        }
        body.appendChild(block);
      });

      // "Now" line — only on today's column, only when current minute is in range
      if (dayIso === todayIso) {
        var nowMin = now.getHours() * 60 + now.getMinutes();
        if (nowMin >= minH * 60 && nowMin <= maxH * 60) {
          var line = el('div', 'cal-now');
          line.style.top = ((nowMin - minH * 60) / 60 * hourPx) + 'px';
          body.appendChild(line);
        }
      }

      day.appendChild(body);
      week.appendChild(day);
    }
    host.appendChild(week);

    updateRangeLabel(ws, we);
  }

  function addMinutesHHMM(hhmm, add) {
    var p = String(hhmm).split(':');
    if (p.length < 2) return hhmm;
    var total = parseInt(p[0], 10) * 60 + parseInt(p[1], 10) + (add || 0);
    var h = Math.floor(total / 60);
    var m = total % 60;
    return h + ':' + (m < 10 ? '0' + m : m);
  }

  function updateRangeLabel(ws, we) {
    var lbl = $('calRange');
    if (!lbl) return;
    if (!ws) {
      var a = state.anchor || new Date();
      ws = startOfWeekMon(a);
      we = addDays(ws, 6);
    }
    lbl.textContent = monthRangeLabel(ws, we);
  }

  /* ---------- Month picker ---------- */
  function buildMonthPicker() {
    var sel = $('calMonth');
    if (!sel) return;
    sel.replaceChildren();
    var now = new Date();
    for (var i = 0; i < 24; i++) {
      var d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      var opt = document.createElement('option');
      opt.value = d.getFullYear() + '-' + (d.getMonth() + 1);
      opt.textContent = MONTH_SHORT[d.getMonth()] + ' ' + d.getFullYear();
      sel.appendChild(opt);
    }
    // Select the current month
    sel.value = now.getFullYear() + '-' + (now.getMonth() + 1);
  }

  /* ---------- Tabs ---------- */
  function setTab(key) {
    state.tab = key;
    var tabs = document.querySelectorAll('.cal-tab');
    tabs.forEach(function (t) {
      var on = t.getAttribute('data-tab') === key;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    renderGrid();
  }

  /* ---------- Wiring ---------- */
  function wire() {
    document.querySelectorAll('.cal-tab').forEach(function (t) {
      t.addEventListener('click', function () {
        var key = t.getAttribute('data-tab');
        if (key) setTab(key);
      });
    });

    var prev = $('calPrev');
    if (prev) prev.addEventListener('click', function () {
      state.anchor = addDays(state.anchor || new Date(), -7);
      renderGrid();
    });
    var next = $('calNext');
    if (next) next.addEventListener('click', function () {
      state.anchor = addDays(state.anchor || new Date(), 7);
      renderGrid();
    });
    var today = $('calToday');
    if (today) today.addEventListener('click', function () {
      state.anchor = new Date();
      renderGrid();
    });
    var refresh = $('calRefresh');
    if (refresh) refresh.addEventListener('click', function () { loadAggregated(); });

    var monthSel = $('calMonth');
    if (monthSel) monthSel.addEventListener('change', function () {
      var v = monthSel.value || '';
      var parts = v.split('-');
      if (parts.length !== 2) return;
      var y = parseInt(parts[0], 10);
      var m = parseInt(parts[1], 10) - 1;
      if (isNaN(y) || isNaN(m)) return;
      // Jump to the first week of the selected month (containing day 1)
      state.anchor = new Date(y, m, 1);
      renderGrid();
    });
  }

  /* ---------- Init ---------- */
  function init() {
    state.anchor = new Date();
    buildMonthPicker();
    wire();
    loadAggregated();
    // Refresh the "now" line every minute in case the page is left open across a day boundary.
    setInterval(function () {
      if (state.tab !== 'study') renderGrid();
    }, 60 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();