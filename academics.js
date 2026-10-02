/* ============================================================
   MASTER DASHBOARD · HOME PAGE ACADEMICS
   File: academics.js
   Timetable Stream, Course Matrix, Assignment List, notification
   panel and the TODAY / SCHOOL widgets on index.html, all from real data:
     /api/schedule      — user-entered weekly meeting times
     /api/courses/all   — real Canvas courses + manual blank-slate courses
     /api/canvas/courses/:id/assignments — real Canvas assignments
   Every section degrades to an honest empty state if nothing is
   configured yet — no fabricated fallback data.
   ============================================================ */

(function () {
  'use strict';

  var DAY_NAMES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function jsDayToMon0(jsDay) { return (jsDay + 6) % 7; } // JS: 0=Sun..6=Sat -> 0=Mon..6=Sun
  function isoOf(d) {
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  // A class only meets inside the term and not on holidays (dates come from the server).
  function meetsOn(e, d) {
    var iso = isoOf(d);
    if (e.termStart && iso < e.termStart) return false;
    if (e.termEnd && iso > e.termEnd) return false;
    return (e.skipDates || []).indexOf(iso) === -1;
  }

  function timeToMinutes(hhmm) {
    var parts = hhmm.split(':');
    return (+parts[0]) * 60 + (+parts[1]);
  }

  // ---------- Data loading ----------
  function loadJSON(url) {
    return fetch(url, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function shortLabel(course) {
    if (course.source === 'manual') {
      return (course.code || course.name || '?').slice(0, 14);
    }
    var parts = (course.code || '').split('_');
    if (parts.length >= 2) {
      var subject = parts[0];
      var catalog = parts[1].replace(/^0+/, '') || parts[1];
      return subject + ' ' + catalog;
    }
    return (course.code || course.name || '?').slice(0, 14);
  }

  function courseById(courses, id) {
    for (var i = 0; i < courses.length; i++) {
      // Schedule entries store courseId as whatever was posted — Canvas ids
      // are numbers, manual ids are strings, so compare loosely.
      if (String(courses[i].id) === String(id)) return courses[i];
    }
    return null;
  }

  // ---------- Timetable Stream ----------
  function renderSchedule(schedule, courses) {
    var list = document.getElementById('scheduleStream');
    var meta = document.getElementById('scheduleMeta');
    if (!list) return;

    var now = new Date();
    var today = jsDayToMon0(now.getDay());
    var nowMin = now.getHours() * 60 + now.getMinutes();

    if (meta) meta.textContent = DAY_NAMES[today];

    var todays = (schedule || [])
      .filter(function (e) { return e.day === today && meetsOn(e, now); })
      .sort(function (a, b) { return timeToMinutes(a.start) - timeToMinutes(b.start); });

    list.innerHTML = '';
    if (!todays.length) {
      list.innerHTML = '<li class="telemetry-row"><span class="t-class">No classes today.</span></li>';
      return;
    }

    todays.forEach(function (e) {
      var startMin = timeToMinutes(e.start);
      var endMin = timeToMinutes(e.end);
      var status = nowMin >= endMin ? 'done' : (nowMin >= startMin ? 'active' : 'queued');
      var stateText = status === 'done' ? 'CLEARED' : status === 'active' ? 'LIVE' : 'QUEUED';

      var course = courseById(courses, e.courseId);
      var li = document.createElement('li');
      li.className = 'telemetry-row' + (status === 'active' ? ' active' : '');
      li.dataset.status = status;
      li.innerHTML =
        '<span class="t-time">' + escapeHtml(e.start) + '</span>' +
        '<span class="t-class">' + escapeHtml(course ? shortLabel(course) : e.label) +
          (e.locationShort ? '<small class="t-loc">' + escapeHtml(e.locationShort) + '</small>' : '') + '</span>' +
        '<span class="t-state">' + stateText + '</span>';
      list.appendChild(li);
    });
  }

  // ---------- Course Matrix ----------
  function gradeLabel(course) {
    if (typeof course.currentScorePct === 'number') return Math.round(course.currentScorePct) + '%';
    return '\u2014';
  }
  function gradeIsAlert(course) {
    return typeof course.currentScorePct === 'number' && course.currentScorePct < 70;
  }

  function renderCourseMatrix(courses) {
    var grid = document.querySelector('.course-grid');
    var meta = document.getElementById('courseMeta');
    if (!grid) return;
    if (meta) meta.textContent = courses.length + ' CLASSES';

    grid.innerHTML = '';
    if (!courses.length) {
      grid.innerHTML = '<li class="course-cell"><div class="course-meta"><span class="course-name">No classes yet \u2014 connect Canvas in Settings.</span></div></li>';
      return;
    }
    courses.forEach(function (c) {
      var li = document.createElement('li');
      li.className = 'course-cell';
      li.dataset.course = c.id;
      li.title = c.name;
      li.innerHTML =
        '<span class="course-name">' + escapeHtml(shortLabel(c)) + '</span>' +
        '<span class="course-grade' + (gradeIsAlert(c) ? ' alert' : '') + '">' + gradeLabel(c) + '</span>';
      grid.appendChild(li);
    });
  }

  // ---------- Assignment Telemetry ----------
  function formatDueIn(iso) {
    var d = new Date(iso);
    var diffH = (d - Date.now()) / 3600000;
    if (diffH < 0) return 'OVERDUE';
    if (diffH < 24) return 'DUE ' + Math.round(diffH) + 'H';
    return 'DUE ' + Math.round(diffH / 24) + 'D';
  }
  function urgencyFor(iso) {
    var diffH = (new Date(iso) - Date.now()) / 3600000;
    if (diffH < 24) return 'urgent';
    if (diffH < 72) return 'soon';
    return 'ok';
  }

  // Collects every upcoming Canvas assignment (soonest first). The module,
  // the home-grid widget and the notification panel each show a slice.
  async function collectUpcomingAssignments(courses) {
    var canvasCourses = courses.filter(function (c) { return c.source === 'canvas'; });
    var results = await Promise.all(canvasCourses.map(function (c) {
      return loadJSON('/api/canvas/courses/' + encodeURIComponent(c.id) + '/assignments');
    }));
    var all = [];
    var byCourse = {};
    results.forEach(function (data, i) {
      if (!Array.isArray(data)) return;
      byCourse[canvasCourses[i].id] = data;
      data.forEach(function (a) { all.push({ a: a, label: shortLabel(canvasCourses[i]) }); });
    });
    var now = Date.now();
    var upcoming = all
      .filter(function (x) { return x.a.dueDate && new Date(x.a.dueDate).getTime() > now; })
      .sort(function (x, y) { return new Date(x.a.dueDate) - new Date(y.a.dueDate); });
    return { upcoming: upcoming, byCourse: byCourse };
  }

  function renderAssignmentList(upcoming) {
    var list = document.querySelector('.assign-list');
    if (!list) return;
    var top = upcoming.slice(0, parseInt(list.dataset.limit, 10) || 6);
    var meta = document.getElementById('assignMeta');
    if (meta) {
      var week = upcoming.filter(function (x) { return (new Date(x.a.dueDate) - Date.now()) / 86400000 <= 7; }).length;
      meta.textContent = week + ' DUE THIS WEEK';
    }
    list.innerHTML = '';
    if (!top.length) {
      list.innerHTML = '<li class="assign-row"><span class="a-title">No upcoming assignments found.</span></li>';
      return;
    }
    top.forEach(function (x) {
      var li = document.createElement('li');
      li.className = 'assign-row';
      li.dataset.urgency = urgencyFor(x.a.dueDate);
      li.innerHTML =
        '<span class="a-dot"></span>' +
        '<span class="a-title">' + escapeHtml(x.a.title) + '</span>' +
        '<span class="a-class">' + escapeHtml(x.label) + '</span>' +
        '<span class="a-due">' + formatDueIn(x.a.dueDate) + '</span>';
      list.appendChild(li);
    });
  }

  // ---------- Notification panel: the same real assignment list ----------
  function renderNotifications(upcoming) {
    var list = document.getElementById('notifList');
    var badge = document.getElementById('notifBadge');
    if (!list) return;
    var dueSoon = upcoming.filter(function (x) {
      return (new Date(x.a.dueDate) - Date.now()) / 3600000 < 72;
    }).length;
    if (badge) {
      badge.textContent = dueSoon;
      if (dueSoon > 0) badge.removeAttribute('hidden'); else badge.setAttribute('hidden', '');
    }
    list.innerHTML = '';
    if (!upcoming.length) {
      list.innerHTML = '<li class="notif-item"><span class="notif-body">No upcoming assignments.</span></li>';
      return;
    }
    upcoming.slice(0, 8).forEach(function (x) {
      var urgent = urgencyFor(x.a.dueDate) !== 'ok';
      var li = document.createElement('li');
      li.className = 'notif-item';
      li.innerHTML =
        '<span class="notif-dot' + (urgent ? ' accent' : '') + '"></span>' +
        '<span class="notif-body"><b>' + escapeHtml(x.label) + '</b> ' + escapeHtml(x.a.title) +
        ' — ' + formatDueIn(x.a.dueDate).toLowerCase() + '</span>';
      list.appendChild(li);
    });
  }

  // ---------- Home-grid widgets: TODAY (calendar) + SCHOOL (assignments) ----------
  function renderHomeToday(cal) {
    var list = document.getElementById('homeTodayList');
    var hint = document.getElementById('homeTodayHint');
    if (!list) return;
    list.innerHTML = '';
    if (cal.error) {
      // Never show placeholder events — say what to do instead.
      list.innerHTML = '<li>' + escapeHtml(cal.error) + '</li>';
      if (hint) hint.textContent = 'Calendar not connected';
      return;
    }
    var d = new Date();
    var todayStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    var todays = (cal.events || [])
      .filter(function (e) { return e.date === todayStr; })
      .sort(function (a, b) { return timeToMinutes(a.start) - timeToMinutes(b.start); })
      .slice(0, 3);
    if (!todays.length) {
      list.innerHTML = '<li>Nothing on your calendar today.</li>';
    } else {
      todays.forEach(function (e) {
        var li = document.createElement('li');
        li.innerHTML = '<span class="t-time">' + (e.allDay || e.durationMin >= 1440 ? 'ALL DAY' : escapeHtml(e.start)) + '</span><span>' + escapeHtml(e.title) + '</span>';
        list.appendChild(li);
      });
    }
    if (hint) hint.textContent = todays.length + ' event' + (todays.length === 1 ? '' : 's') + ' today';
  }

  // Calendar fetch that keeps the server's "how to fix it" message.
  function loadCalendar() {
    return fetch('/api/calendar/events', { credentials: 'same-origin' })
      .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
      .then(function (res) {
        if (!res.ok || !Array.isArray(res.data.events)) {
          return { error: res.data && res.data.error ? res.data.error : 'Could not load your calendar.' };
        }
        // Class meetings are on Google Calendar too, but the dashboard already shows them from the schedule.
        return { events: res.data.events.filter(function (e) { return !e.isClass; }) };
      })
      .catch(function () { return { error: 'Could not reach the dashboard server.' }; });
  }

  // Helpers and loaded data are shared with extras.js (desktop/mobile extras).
  window.HomeUtil = {
    esc: escapeHtml,
    shortLabel: shortLabel,
    timeToMinutes: timeToMinutes,
    jsDayToMon0: jsDayToMon0,
    meetsOn: meetsOn,
    urgencyFor: urgencyFor,
  };

  // ---------- Boot ----------
  async function boot() {
    var courses = (await loadJSON('/api/courses/all')) || [];
    var schedule = (await loadJSON('/api/schedule')) || [];
    window.HomeData = { courses: courses, schedule: schedule, upcoming: [], byCourse: {}, calendar: null };
    renderSchedule(schedule, courses);
    renderCourseMatrix(courses);
    document.dispatchEvent(new CustomEvent('home:schedule'));

    // Calendar and assignments load in parallel.
    var calendarPromise = loadCalendar();
    var got = await collectUpcomingAssignments(courses);
    renderAssignmentList(got.upcoming);
    renderNotifications(got.upcoming);
    window.HomeData.upcoming = got.upcoming;
    window.HomeData.byCourse = got.byCourse;
    document.dispatchEvent(new CustomEvent('home:assignments'));

    var cal = await calendarPromise;
    renderHomeToday(cal);
    window.HomeData.calendar = cal;
    document.dispatchEvent(new CustomEvent('home:calendar'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
