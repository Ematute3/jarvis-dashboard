/* ============================================================
   MASTER DASHBOARD · HOME EXTRAS (desktop + mobile)
   File: extras.js
   Everything here is computed from real data already loaded by
   academics.js (window.HomeData) or fetched from the real APIs:
     - greeting, date, day-progress bar (from the clock)
     - "next up" tiles with live countdowns (schedule, Canvas, Calendar)
     - weekly schedule grid with a "now" line          [desktop]
     - per-course assignment progress rings            [desktop]
     - upcoming events list                            [desktop]
     - inbox preview (real Gmail)                      [desktop]
   Each block only runs if its element exists on the page.
   No sample data: empty states say what's missing.
   ============================================================ */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var U = window.HomeUtil;
  var esc = U.esc;
  var DAY_SHORT = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  var PALETTE = ['#00E5FF', '#2979FF', '#56F0A8', '#FF9100', '#C792EA', '#F25F7F', '#FFD166', '#7EE2FF'];

  /* ---------- Formatting ---------- */
  function fmtDelta(ms) {
    var m = Math.max(0, Math.round(ms / 60000));
    if (m < 60) return m + 'm';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ' + (m % 60) + 'm';
    return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
  }
  function time12(hhmm) {
    var p = hhmm.split(':');
    var h = +p[0];
    return ((h + 11) % 12 + 1) + ':' + p[1] + (h >= 12 ? ' PM' : ' AM');
  }
  function atTime(date, hhmm) {
    var p = hhmm.split(':');
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), +p[0], +p[1]);
  }
  function dateFromISO(iso, hhmm) {
    var d = iso.split('-');
    var t = (hhmm || '00:00').split(':');
    return new Date(+d[0], +d[1] - 1, +d[2], +t[0], +t[1]);
  }
  function data() { return window.HomeData || { courses: [], schedule: [], upcoming: [], byCourse: {}, calendar: null }; }
  function courseLookup(id) {
    var cs = data().courses;
    for (var i = 0; i < cs.length; i++) if (String(cs[i].id) === String(id)) return cs[i];
    return null;
  }
  function colorFor(courseId) {
    var cs = data().courses;
    for (var i = 0; i < cs.length; i++) if (String(cs[i].id) === String(courseId)) return PALETTE[i % PALETTE.length];
    return PALETTE[0];
  }

  /* ---------- Greeting / date / day progress ---------- */
  function renderHero() {
    var now = new Date();
    var h = now.getHours();
    var g = $('heroGreeting');
    if (g) g.textContent = (h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening') + ', Evan';
    var d = $('heroDate');
    if (d) d.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    var pct = Math.round(((h * 60 + now.getMinutes()) / 1440) * 100);
    var fill = $('dayProgressFill');
    if (fill) fill.style.width = pct + '%';
    var txt = $('dayProgressText');
    if (txt) txt.textContent = pct + '% of today';
  }

  /* ---------- Next-up tiles ---------- */
  function setTile(id, o) {
    var el = $(id);
    if (!el) return;
    el.innerHTML =
      '<span class="next-label">' + o.label + '</span>' +
      '<span class="next-title">' + esc(o.title) + '</span>' +
      (o.loc ? '<span class="next-loc">' + esc(o.loc) + '</span>' : '') +
      (o.sub ? '<span class="next-sub">' + esc(o.sub) + '</span>' : '') +
      '<span class="next-when">' + esc(o.when || '') + '</span>';
    el.dataset.tone = o.tone || '';
  }

  function nextClass(schedule, now) {
    var best = null;
    schedule.forEach(function (e) {
      for (var add = 0; add < 60; add++) {
        var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add);
        if (U.jsDayToMon0(d.getDay()) !== e.day || !U.meetsOn(e, d)) continue;
        var start = atTime(d, e.start), end = atTime(d, e.end);
        if (end <= now) continue;
        if (!best || start < best.start) best = { entry: e, start: start, end: end, inProgress: start <= now };
        break;
      }
    });
    return best;
  }

  function renderNext() {
    if (!$('nextClass') && !$('nextDue') && !$('nextEvent')) return;
    var D = data();
    var now = new Date();

    var nc = nextClass(D.schedule, now);
    if (!D.schedule.length) {
      setTile('nextClass', { label: 'NEXT CLASS', title: 'No schedule saved', when: '' });
    } else if (!nc) {
      setTile('nextClass', { label: 'NEXT CLASS', title: 'Nothing scheduled', when: '' });
    } else {
      var course = courseLookup(nc.entry.courseId);
      setTile('nextClass', {
        label: nc.inProgress ? 'IN CLASS NOW' : 'NEXT CLASS',
        title: course ? U.shortLabel(course) : nc.entry.label,
        loc: nc.entry.location || '',
        sub: nc.entry.label + ' · ' + time12(nc.entry.start) + '–' + time12(nc.entry.end),
        when: nc.inProgress ? 'ends in ' + fmtDelta(nc.end - now)
          : (nc.start.toDateString() === now.toDateString() ? 'today' : DAY_SHORT[nc.entry.day]) + ' · in ' + fmtDelta(nc.start - now),
        tone: nc.inProgress ? 'live' : '',
      });
    }

    var due = D.upcoming[0];
    if (!due) {
      setTile('nextDue', { label: 'NEXT DUE', title: 'Nothing due', sub: D.courses.length ? 'No upcoming Canvas assignments' : 'Connect Canvas in Settings', when: '' });
    } else {
      var dueAt = new Date(due.a.dueDate);
      setTile('nextDue', {
        label: 'NEXT DUE',
        title: due.a.title,
        sub: due.label,
        when: 'in ' + fmtDelta(dueAt - now) + ' · ' + dueAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        tone: U.urgencyFor(due.a.dueDate),
      });
    }

    var cal = D.calendar;
    if (!cal) {
      setTile('nextEvent', { label: 'NEXT EVENT', title: 'Loading…', when: '' });
    } else if (cal.error) {
      setTile('nextEvent', { label: 'NEXT EVENT', title: 'Calendar not connected', sub: 'Open Settings to connect Google', when: '' });
    } else {
      var ev = upcomingEvents(cal.events, now)[0];
      if (!ev) {
        setTile('nextEvent', { label: 'NEXT EVENT', title: 'Nothing coming up', sub: 'Your calendar is clear', when: '' });
      } else {
        setTile('nextEvent', {
          label: 'NEXT EVENT',
          title: ev.title,
          loc: ev.location || '',
          when: ev.start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + (ev.allDay ? 'All day' : time12(ev.startStr)) + ' · ' + (ev.allDay ? (ev.start <= now ? 'today' : 'in ' + fmtDelta(ev.start - now)) : 'in ' + fmtDelta(ev.start - now)),
        });
      }
    }
  }

  function upcomingEvents(events, now) {
    return (events || [])
      .map(function (e) { return { title: e.title, location: e.location, date: e.date, startStr: e.start, start: dateFromISO(e.date, e.start), durationMin: e.durationMin, allDay: !!e.allDay || e.durationMin >= 1440 }; })
      .filter(function (e) { return e.start.getTime() + (e.durationMin || 0) * 60000 > now.getTime(); })
      .sort(function (a, b) { return a.start - b.start; });
  }

  /* ---------- Weekly schedule grid ---------- */
  var HOUR_PX = 40;

  function renderWeek() {
    var host = $('weekGrid');
    if (!host) return;
    var D = data();
    var sched = D.schedule;
    if (!sched.length) {
      host.innerHTML = '<div class="wk-empty">No weekly schedule saved yet.</div>';
      return;
    }
    var minH = 8, maxH = 17, maxDay = 4;
    sched.forEach(function (e) {
      minH = Math.min(minH, Math.floor(U.timeToMinutes(e.start) / 60));
      maxH = Math.max(maxH, Math.ceil(U.timeToMinutes(e.end) / 60));
      maxDay = Math.max(maxDay, e.day);
    });
    var days = maxDay + 1;
    var bodyH = (maxH - minH) * HOUR_PX;
    var now = new Date();
    var today = U.jsDayToMon0(now.getDay());

    var html = '<div class="wk" style="--days:' + days + ';--body-h:' + bodyH + 'px;--hour-px:' + HOUR_PX + 'px">';
    html += '<div class="wk-times"><div class="wk-dayname">&nbsp;</div><div class="wk-timecol">';
    for (var h = minH; h < maxH; h++) html += '<span style="height:' + HOUR_PX + 'px">' + ((h + 11) % 12 + 1) + (h >= 12 ? 'p' : 'a') + '</span>';
    html += '</div></div>';
    for (var d = 0; d < days; d++) {
      html += '<div class="wk-day' + (d === today ? ' is-today' : '') + '"><div class="wk-dayname">' + DAY_SHORT[d] + '</div><div class="wk-body" data-day="' + d + '">';
      sched.filter(function (e) { return e.day === d; }).forEach(function (e) {
        var s = U.timeToMinutes(e.start), en = U.timeToMinutes(e.end);
        var top = (s - minH * 60) / 60 * HOUR_PX;
        var height = (en - s) / 60 * HOUR_PX - 2;
        var course = courseLookup(e.courseId);
        html += '<div class="wk-block" style="top:' + top + 'px;height:' + height + 'px;--c:' + colorFor(e.courseId) + '" title="' + esc(e.label + ' ' + time12(e.start) + '–' + time12(e.end) + (e.location ? ' · ' + e.location : '')) + '">' +
          '<b>' + esc(course ? U.shortLabel(course) : e.label) + '</b>' +
          (height > 34 ? '<span>' + esc(time12(e.start)) + '</span>' : '') +
          (height > 58 && e.locationShort ? '<span class="wk-loc">' + esc(e.locationShort) + '</span>' : '') + '</div>';
      });
      html += '</div></div>';
    }
    html += '</div>';
    host.innerHTML = html;
    host.dataset.minH = minH;
    host.dataset.maxH = maxH;
    updateNowLine();
  }

  function updateNowLine() {
    var host = $('weekGrid');
    if (!host || !host.dataset.minH) return;
    var old = host.querySelector('.wk-now');
    if (old) old.remove();
    var now = new Date();
    var minutes = now.getHours() * 60 + now.getMinutes();
    var minH = +host.dataset.minH, maxH = +host.dataset.maxH;
    if (minutes < minH * 60 || minutes > maxH * 60) return;
    var body = host.querySelector('.wk-body[data-day="' + U.jsDayToMon0(now.getDay()) + '"]');
    if (!body) return;
    var line = document.createElement('div');
    line.className = 'wk-now';
    line.style.top = ((minutes - minH * 60) / 60 * HOUR_PX) + 'px';
    body.appendChild(line);
  }

  /* ---------- Course progress rings (real Canvas assignment status) ---------- */
  function renderRings() {
    var host = $('courseRings');
    if (!host) return;
    var D = data();
    var meta = $('courseRingsMeta');
    if (meta) meta.textContent = D.courses.length + ' CLASSES';
    if (!D.courses.length) {
      host.innerHTML = '<div class="wk-empty">No classes yet — connect Canvas in Settings.</div>';
      return;
    }
    host.innerHTML = D.courses.map(function (c, i) {
      var list = D.byCourse[c.id] || [];
      var total = list.length;
      var done = list.filter(function (a) { return a.status === 'submitted' || a.status === 'graded'; }).length;
      var pct = total ? Math.round(done / total * 100) : 0;
      var sub = c.source === 'manual' ? 'not on Canvas' : (total ? done + '/' + total + ' done' : 'no work yet');
      return '<div class="ring-item" title="' + esc(c.name) + '">' +
        '<div class="ring-wrap"><svg viewBox="0 0 36 36" class="ring">' +
        '<circle class="ring-bg" cx="18" cy="18" r="15.9155"></circle>' +
        '<circle class="ring-fg" cx="18" cy="18" r="15.9155" data-pct="' + pct + '" style="stroke:' + PALETTE[i % PALETTE.length] + ';stroke-dasharray:0 100"></circle>' +
        '</svg><span class="ring-pct">' + (total ? pct + '%' : '—') + '</span></div>' +
        '<span class="ring-name">' + esc(U.shortLabel(c)) + '</span>' +
        '<span class="ring-sub">' + esc(sub) + '</span></div>';
    }).join('');
    requestAnimationFrame(function () {
      host.querySelectorAll('.ring-fg').forEach(function (el) {
        el.style.strokeDasharray = el.dataset.pct + ' 100';
      });
    });
  }

  /* ---------- Upcoming events ---------- */
  function renderEvents() {
    var host = $('eventsList');
    if (!host) return;
    var cal = data().calendar;
    var meta = $('eventsMeta');
    if (!cal) return;
    if (cal.error) {
      host.innerHTML = '<li class="ev-empty">' + esc(cal.error) + '</li>';
      if (meta) meta.textContent = 'NOT CONNECTED';
      return;
    }
    var list = upcomingEvents(cal.events, new Date()).slice(0, 5);
    if (meta) meta.textContent = list.length + ' UPCOMING';
    if (!list.length) {
      host.innerHTML = '<li class="ev-empty">Nothing coming up on your Google Calendar.</li>';
      return;
    }
    host.innerHTML = list.map(function (e) {
      return '<li class="ev-row"><span class="ev-date"><b>' + e.start.getDate() + '</b>' +
        e.start.toLocaleDateString('en-US', { month: 'short' }).toUpperCase() + '</span>' +
        '<span class="ev-main"><span class="ev-title">' + esc(e.title) + '</span>' +
        '<span class="ev-sub">' + esc(e.allDay ? 'All day' : time12(e.startStr)) + (e.location ? ' · ' + esc(e.location) : '') + '</span></span></li>';
    }).join('');
  }

  /* ---------- Mini month calendar (real event + due dates) ---------- */
  function localISO(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function renderMiniMonth() {
    var host = $('miniMonth');
    if (!host) return;
    var D = data();
    var now = new Date();
    var y = now.getFullYear(), m = now.getMonth();
    var events = {}, due = {};
    if (D.calendar && D.calendar.events) D.calendar.events.forEach(function (e) { events[e.date] = true; });
    (D.upcoming || []).forEach(function (x) { due[localISO(new Date(x.a.dueDate))] = true; });
    var offset = (new Date(y, m, 1).getDay() + 6) % 7;
    var days = new Date(y, m + 1, 0).getDate();
    var html = '<div class="mm-head"><span>' + now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase() +
      '</span><span class="mm-legend"><i class="dot-ev"></i>event <i class="dot-due"></i>due</span></div><div class="mm-grid">';
    ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach(function (d) { html += '<span class="mm-dow">' + d + '</span>'; });
    for (var i = 0; i < offset; i++) html += '<span class="mm-day other"></span>';
    for (var d = 1; d <= days; d++) {
      var iso = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      html += '<span class="mm-day' + (d === now.getDate() ? ' is-today' : '') + '">' + d +
        (events[iso] ? '<i class="dot-ev"></i>' : '') + (due[iso] ? '<i class="dot-due"></i>' : '') + '</span>';
    }
    host.innerHTML = html + '</div>';
  }

  /* ---------- Inbox preview (real Gmail) ---------- */
  function senderName(from) {
    var m = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(from || '');
    return (m ? m[1] : from || 'Unknown sender').trim();
  }
  function renderInbox() {
    var host = $('inboxList');
    if (!host) return;
    var meta = $('inboxMeta');
    fetch('/api/gmail/messages?limit=6', { credentials: 'same-origin' })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok || !Array.isArray(res.d.messages)) {
          host.innerHTML = '<li class="ev-empty">' + esc(res.d && res.d.error ? res.d.error : 'Could not load your inbox.') + '</li>';
          if (meta) meta.textContent = 'NOT CONNECTED';
          return;
        }
        var unread = res.d.messages.filter(function (m) { return m.unread; }).length;
        if (meta) meta.textContent = unread + ' UNREAD';
        if (!res.d.messages.length) {
          host.innerHTML = '<li class="ev-empty">Inbox is clear.</li>';
          return;
        }
        host.innerHTML = res.d.messages.map(function (m) {
          return '<li class="mail-row' + (m.unread ? ' is-unread' : '') + '"><span class="mail-dot"></span>' +
            '<span class="mail-main"><span class="mail-from">' + esc(senderName(m.from)) + '</span>' +
            '<span class="mail-subj">' + esc(m.subject) + '</span></span></li>';
        }).join('');
      })
      .catch(function () {
        host.innerHTML = '<li class="ev-empty">Could not reach the dashboard server.</li>';
      });
  }

  /* ---------- Wiring ---------- */
  function refreshAll() { renderNext(); renderWeek(); renderRings(); renderEvents(); renderMiniMonth(); }
  document.addEventListener('home:schedule', function () { renderNext(); renderWeek(); });
  document.addEventListener('home:assignments', function () { renderNext(); renderRings(); renderMiniMonth(); });
  document.addEventListener('home:calendar', function () { renderNext(); renderEvents(); renderMiniMonth(); });

  function init() {
    renderHero();
    renderMiniMonth();
    if (window.HomeData) refreshAll();
    renderInbox();
    setInterval(function () { renderNext(); }, 30 * 1000);
    setInterval(function () { renderHero(); updateNowLine(); }, 60 * 1000);
    setInterval(renderInbox, 2 * 60 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
