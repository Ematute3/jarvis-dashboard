/* By Class: per-course briefing from /api/plan (Canvas assignments + module pages + syllabus dates). */
(function () {
  'use strict';

  var HEX = { cyan: '#00E5FF', amber: '#FF9100', magenta: '#FF4FB8', violet: '#A86CFF', green: '#6CFFB0', blue: '#2979FF' };
  var EXAM = /midterm|final|exam|quiz/i;
  var state = { data: null, only: 'all' };

  function $(id) { return document.getElementById(id); }

  function text(v) {
    var n = v == null ? '' : String(v);
    return n;
  }

  function hex(h) { return HEX[h] || h || '#00E5FF'; }

  function parse(ds) {
    var p = ds.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function dayDiff(ds, today) {
    return Math.round((parse(ds) - parse(today)) / 86400000);
  }

  function fmt(ds) {
    return parse(ds).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function t12(hhmm) {
    var p = hhmm.split(':');
    var h = +p[0];
    return ((h + 11) % 12 + 1) + ':' + p[1] + (h >= 12 ? ' PM' : ' AM');
  }

  function whenText(ds, today) {
    var n = dayDiff(ds, today);
    return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n > 0 ? 'in ' + n + ' days' : Math.abs(n) + ' days ago';
  }

  function setText(node, txt) { node.textContent = text(txt); }

  function appendText(parent, txt) { parent.appendChild(document.createTextNode(text(txt))); }

  function buildItem(item, today) {
    var over = item.date && item.date < today;
    var li = document.createElement('li');
    li.className = 'pl-item' + (over ? ' is-over' : '');

    var dateCell = document.createElement('div');
    dateCell.className = 'pl-date';
    if (item.date) {
      var day = document.createElement('b');
      day.textContent = parse(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      dateCell.appendChild(day);
      if (item.time) {
        dateCell.appendChild(document.createTextNode(t12(item.time)));
      } else {
        dateCell.appendChild(document.createTextNode(parse(item.date).toLocaleDateString('en-US', { weekday: 'short' })));
      }
    } else {
      var dash = document.createElement('b');
      dash.textContent = '\u2014';
      dateCell.appendChild(dash);
      dateCell.appendChild(document.createTextNode('no date'));
    }
    li.appendChild(dateCell);

    var mid = document.createElement('div');
    if (item.url) {
      var link = document.createElement('a');
      link.className = 'pl-title-row';
      link.href = text(item.url);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = text(item.title);
      mid.appendChild(link);
    } else {
      var span = document.createElement('span');
      span.className = 'pl-title-row';
      span.textContent = text(item.title);
      mid.appendChild(span);
    }
    if (item.detail) {
      var detail = document.createElement('div');
      detail.className = 'pl-detail';
      detail.textContent = text(item.detail);
      mid.appendChild(detail);
    }
    var tags = document.createElement('div');
    tags.className = 'pl-tags';
    var kindTag = document.createElement('span');
    kindTag.className = 'pl-tag' + (EXAM.test(text(item.title)) ? ' exam' : '');
    kindTag.textContent = text(item.kind);
    tags.appendChild(kindTag);
    var sourceLabel = text(item.source).replace(/^Module: /, '');
    if (sourceLabel.toLowerCase() !== text(item.kind).toLowerCase()) {
      var srcTag = document.createElement('span');
      srcTag.className = 'pl-tag';
      srcTag.textContent = sourceLabel;
      tags.appendChild(srcTag);
    }
    if (over) {
      var overdueTag = document.createElement('span');
      overdueTag.className = 'pl-tag exam';
      overdueTag.textContent = 'overdue';
      tags.appendChild(overdueTag);
    }
    mid.appendChild(tags);
    li.appendChild(mid);

    var pts = document.createElement('div');
    pts.className = 'pl-pts';
    if (item.points) {
      pts.textContent = text(item.points) + ' pts';
    }
    li.appendChild(pts);

    return li;
  }

  function buildSection(cls, label, items, today, open) {
    if (!items.length) return null;
    var det = document.createElement('details');
    det.className = 'pl-sec ' + cls;
    if (open) det.open = true;
    var sum = document.createElement('summary');
    var labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    sum.appendChild(labelSpan);
    var countSpan = document.createElement('span');
    countSpan.textContent = items.length;
    sum.appendChild(countSpan);
    det.appendChild(sum);
    var ul = document.createElement('ul');
    ul.className = 'pl-list';
    items.forEach(function (it) { ul.appendChild(buildItem(it, today)); });
    det.appendChild(ul);
    return det;
  }

  function buildCard(c, today) {
    var color = hex(c.color);
    var overdue = c.items.filter(function (i) { return i.date && i.date < today; });
    var upcoming = c.items.filter(function (i) { return i.date && i.date >= today; });
    var undated = c.items.filter(function (i) { return !i.date; });
    var nc = c.nextClass;
    var before = [];
    if (nc) {
      before = upcoming.filter(function (i) { return i.date <= nc.date; });
      upcoming = upcoming.filter(function (i) { return i.date > nc.date; });
    }
    var week = upcoming.filter(function (i) { return dayDiff(i.date, today) <= 7; });
    var later = upcoming.filter(function (i) { return dayDiff(i.date, today) > 7; });

    var article = document.createElement('article');
    article.className = 'pl-card';
    article.style.setProperty('--c', color);

    var head = document.createElement('div');
    head.className = 'pl-card-head';

    var top = document.createElement('div');
    top.className = 'pl-card-top';

    var name = document.createElement('h2');
    name.className = 'pl-name';
    name.textContent = text(c.name);
    top.appendChild(name);

    if (c.score != null) {
      var score = document.createElement('span');
      score.className = 'pl-score';
      score.textContent = Math.round(c.score * 10) / 10 + '%';
      top.appendChild(score);
    }
    head.appendChild(top);

    var who = document.createElement('div');
    who.className = 'pl-who';
    var instructor = c.instructor && c.instructor !== '\u2014' ? c.instructor : '';
    who.textContent = text(instructor);
    head.appendChild(who);

    var next = document.createElement('div');
    next.className = 'pl-next';
    if (nc) {
      var lbl = document.createElement('span');
      lbl.textContent = 'NEXT CLASS';
      next.appendChild(lbl);
      var when = document.createElement('b');
      if (nc.date === today) {
        when.className = 'today';
        when.textContent = 'Today';
      } else {
        when.textContent = fmt(nc.date);
      }
      next.appendChild(when);
      var span2 = document.createElement('span');
      span2.textContent = t12(nc.start) + '\u2013' + t12(nc.end);
      next.appendChild(span2);
      if (nc.location) {
        var loc = document.createElement('span');
        loc.textContent = text(nc.location);
        next.appendChild(loc);
      }
    } else {
      var empty = document.createElement('span');
      empty.textContent = 'No class meeting time on your schedule';
      next.appendChild(empty);
    }
    head.appendChild(next);

    article.appendChild(head);

    var sections = [
      buildSection('is-over', 'OVERDUE', overdue, today, true),
      buildSection('is-before', nc ? 'DO BEFORE NEXT CLASS' : 'DO FIRST', before, today, true),
      buildSection('', 'NEXT 7 DAYS', week, today, true),
      buildSection('', 'LATER', later, today, !week.length && !before.length && !overdue.length),
      buildSection('', 'NO DATE POSTED YET', undated, today, false)
    ];
    sections.forEach(function (s) { if (s) article.appendChild(s); });

    if (!c.items.length) {
      var none = document.createElement('div');
      none.className = 'pl-none';
      none.textContent = 'Nothing posted yet. Canvas has no assignments or dated modules for this class, so there\u2019s nothing to do right now.';
      article.appendChild(none);
    }

    return article;
  }

  function buildPill(p) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pl-pill' + (state.only === p.id ? ' is-active' : '');
    btn.dataset.c = text(p.id);
    if (p.color) {
      btn.style.setProperty('--c', hex(p.color));
      var dot = document.createElement('i');
      btn.appendChild(dot);
    }
    btn.appendChild(document.createTextNode(text(p.name)));
    return btn;
  }

  function render() {
    var d = state.data;
    var today = d.today;

    var pills = $('pl-pills');
    pills.replaceChildren();
    var pillData = [{ id: 'all', name: 'All classes' }].concat(d.courses.map(function (c) {
      return { id: String(c.id), name: c.name, color: c.color };
    }));
    pillData.forEach(function (p) { pills.appendChild(buildPill(p)); });

    var grid = $('pl-grid');
    grid.replaceChildren();
    var list = d.courses.filter(function (c) { return state.only === 'all' || String(c.id) === state.only; });
    if (list.length) {
      list.forEach(function (c) { grid.appendChild(buildCard(c, today)); });
    } else {
      var empty = document.createElement('div');
      empty.className = 'pl-empty';
      empty.textContent = 'No classes found.';
      grid.appendChild(empty);
    }

    var todo = d.courses.reduce(function (n, c) { return n + c.items.length; }, 0);
    var sub = $('pl-subtitle');
    sub.textContent = d.courses.length + ' CLASSES \u00b7 ' + todo + ' THINGS TO KNOW ABOUT';
  }

  function load() {
    fetch('/api/plan', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.error) {
          $('pl-status').textContent = 'NOT CONNECTED';
          var grid = $('pl-grid');
          grid.replaceChildren();
          var empty = document.createElement('div');
          empty.className = 'pl-empty';
          empty.textContent = text(d.error);
          grid.appendChild(empty);
          return;
        }
        state.data = d;
        $('pl-status').textContent = 'SYNCED';
        render();
      })
      .catch(function () {
        $('pl-status').textContent = 'OFFLINE';
        var grid = $('pl-grid');
        grid.replaceChildren();
        var offline = document.createElement('div');
        offline.className = 'pl-empty';
        offline.textContent = 'Couldn\u2019t reach the dashboard server.';
        grid.appendChild(offline);
      });
  }

  $('pl-pills').addEventListener('click', function (e) {
    var b = e.target.closest('[data-c]');
    if (!b || !state.data) return;
    state.only = b.dataset.c;
    render();
  });

  load();
  setInterval(load, 5 * 60 * 1000);
})();