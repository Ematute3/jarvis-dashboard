/* ============================================================
   MASTER DASHBOARD · NEWS
   File: news.js
   Real headlines only, from /api/news (Google News RSS aggregated
   server-side). No fallback or placeholder stories: if the feed can't
   be reached, the UI says so.

   Two surfaces:
     - center HUD tile (#newsTicker): rotates 3 headlines every 30s
     - home-grid widget (#homeNewsList): today's top stories, one per
       category, refreshed every 30 minutes
   Every headline links to the article.
   ============================================================ */

(function () {
  'use strict';

  var WEIGHTS = { finance: 4, tech: 3, education: 2, sports: 1 };
  var WIDGET_ORDER = ['finance', 'tech', 'education', 'sports', 'finance'];

  var headlines = [];
  var cursor = 0;
  var rotateTimer = null;
  var fadeTimer = null;
  var loaded = false;
  var _loadError = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function safeHref(url) {
    return /^https?:\/\//i.test(url || '') ? url : null;
  }

  /* ---------- Data ---------- */
  function loadHeadlines() {
    return fetch('/api/news', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function (data) {
        if (Array.isArray(data.headlines) && data.headlines.length) {
          headlines = data.headlines;
          loaded = true;
        }
      })
      .catch(function (e) { _loadError = true; console.warn('[news] fetch failed:', e.message); });
  }

  /* ---------- Center HUD tile ---------- */
  function pickWeighted(candidates) {
    var total = candidates.reduce(function (sum, h) { return sum + (WEIGHTS[h.category] || 1); }, 0);
    var r = Math.random() * total;
    for (var i = 0; i < candidates.length; i++) {
      r -= (WEIGHTS[candidates[i].category] || 1);
      if (r <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }

  function tileHtml(h) {
    var href = safeHref(h.link);
    var ticker = h.ticker ? '<span class="t-ticker" title="You own ' + esc(h.ticker) + '">' + esc(h.ticker) + '</span> ' : '';
    var text = ticker + esc(h.text) + ' <span class="t-src">· ' + esc(h.source) + '</span>';
    var body = href
      ? '<a class="t-link" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + text + '</a>'
      : text;
    return '<li data-cat="' + esc(h.category) + '"><span class="t-dot"></span><span class="t-time">' +
      esc(h.time || '--:--') + '</span><span class="t-text">' + body + '</span></li>';
  }

  function renderTile(picks, message) {
    var host = document.getElementById('newsTicker');
    if (!host) return;
    var html = message
      ? '<li><span class="t-text">' + esc(message) + '</span></li>'
      : picks.map(tileHtml).join('');
    host.classList.add('nt-fade-out');
    if (fadeTimer) clearTimeout(fadeTimer);
    fadeTimer = setTimeout(function () {
      host.innerHTML = html;
      host.classList.remove('nt-fade-out');
    }, 220);
  }

  function rotateTile() {
    if (!headlines.length) {
      renderTile([], 'News unavailable — check your internet connection.');
      return;
    }
    var window8 = [];
    for (var i = 0; i < 8; i++) window8.push(headlines[(cursor + i) % headlines.length]);
    var picks = [];
    for (var n = 0; n < 3; n++) {
      var avail = window8.filter(function (c) { return picks.indexOf(c) === -1; });
      if (!avail.length) break;
      picks.push(pickWeighted(avail));
    }
    cursor = (cursor + 3) % headlines.length;
    renderTile(picks);
  }

  /* ---------- Home-grid widget ---------- */
  function renderWidget() {
    var list = document.getElementById('homeNewsList');
    var dateEl = document.getElementById('homeNewsDate');
    if (!list) return;
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
    }
    if (!headlines.length) {
      var emptyMsg = _loadError
        ? "Couldn't reach the news feed — try again later."
        : 'No headlines right now.';
      list.innerHTML = '<li class="news-empty">' + emptyMsg + '</li>';
      return;
    }
    // One top story per category, in a fixed order, so the widget reads as
    // a small daily front page instead of five stories on one topic.
    var used = {};
    var picks = [];
    WIDGET_ORDER.forEach(function (cat) {
      var found = headlines.filter(function (h) { return h.category === cat && !used[h.id]; })[0];
      if (found) { used[found.id] = true; picks.push(found); }
    });
    list.innerHTML = picks.map(function (h) {
      var href = safeHref(h.link);
      var inner = '<span class="news-headline">' + esc(h.text) + '</span>' +
        '<span class="news-src">' + esc(h.source) + '</span>';
      return '<li>' + (href
        ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + inner + '</a>'
        : inner) + '</li>';
    }).join('');
  }

  /* ---------- Boot ---------- */
  function refresh() {
    return loadHeadlines().then(renderWidget);
  }

  function start() {
    var hasTile = !!document.getElementById('newsTicker');
    refresh().then(function () {
      if (hasTile) {
        rotateTile();
        if (rotateTimer) clearInterval(rotateTimer);
        rotateTimer = setInterval(rotateTile, 30000);
      }
    });
    setInterval(refresh, 30 * 60 * 1000);
  }

  window.NewsTicker = { refresh: refresh, isLoaded: function () { return loaded; }, isError: function () { return _loadError; } };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
