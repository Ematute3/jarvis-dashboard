/* ============================================================
   MASTER DASHBOARD · HOME PAGE · APP
   File: app.js
   Clock, portfolio tiles (live prices + recorded daily snapshots),
   hover text scramble. Everything else on the home page lives in
   academics.js, news.js and goals.js.
   ============================================================ */

(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const pad = (n) => String(n).padStart(2, '0');

  /* ---------- System clock ---------- */
  function tickClock() {
    const el = $('#systemTime');
    if (!el) return;
    const now = new Date();
    let h = now.getHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    el.textContent = `${pad(h)}:${pad(now.getMinutes())}:${pad(now.getSeconds())} ${ampm}`;
  }

  /* ---------- Sparkline from recorded daily snapshots ----------
     Only draws when there are at least 2 real snapshots; otherwise the
     SVG stays hidden — no placeholder shape. */
  function drawSpark(svgEl, lineEl, values, height) {
    if (!svgEl || !lineEl) return;
    if (!values || values.length < 2) { svgEl.setAttribute('hidden', ''); return; }
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const span = max - min || 1;
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * 200;
      const y = height - 4 - ((v - min) / span) * (height - 8);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    lineEl.setAttribute('points', pts.join(' '));
    svgEl.removeAttribute('hidden');
  }

  function loadSparklines() {
    fetch('/api/portfolio/history', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : []))
      .then((history) => {
        const values = (Array.isArray(history) ? history : []).map((p) => p.value);
        drawSpark($('#portfolioSparkSvg'), $('#portfolioSpark'), values, 40);
        drawSpark($('#portSparkSvg'), $('#portSpark'), values, 50);
      })
      .catch(() => { /* leave hidden */ });
  }

  /* ---------- Portfolio tiles ---------- */
  function renderPortfolio() {
    const valueEl = $('#portfolioValue');
    const deltaEl = $('#portfolioDelta');
    if (!valueEl || !deltaEl) return;

    function update() {
      const pd = window.PortfolioData;
      if (!pd) return;
      const hasHoldings = pd.enrichedHoldings().length > 0;
      const total = pd.totalMarketValue();
      const dayPct = pd.totalDayChangePct();
      const pctText = hasHoldings && total > 0
        ? (dayPct >= 0 ? '+' : '') + dayPct.toFixed(2) + '%'
        : '—';

      valueEl.textContent = hasHoldings ? pd.formatUSD(total) : '$--.--';
      deltaEl.textContent = pctText;
      deltaEl.style.color = dayPct >= 0 ? 'var(--c-cyan)' : 'var(--c-orange)';

      const fmtSigned = (n) => (n >= 0 ? '+' : '-') + pd.formatUSD(Math.abs(n));
      const setStat = (id, text, cls) => {
        const el = $(id);
        if (!el) return;
        el.textContent = text;
        el.classList.toggle('is-up', cls === 'up');
        el.classList.toggle('is-down', cls === 'down');
      };
      const nPos = pd.enrichedHoldings().length;
      setStat('#portPositions', nPos ? String(nPos) : '—');
      setStat('#portDay', hasHoldings && total > 0 ? fmtSigned(pd.totalDayChange()) : '—', pd.totalDayChange() >= 0 ? 'up' : 'down');
      setStat('#portGain', hasHoldings && pd.totalCost() > 0 ? fmtSigned(pd.totalGain()) : '—', pd.totalGain() >= 0 ? 'up' : 'down');

      const note = $('#portfolioNote');
      if (note) {
        const n = pd.enrichedHoldings().length;
        if (pd.loadError && n === 0) {
          note.textContent = "Couldn't load portfolio \u2014 retrying.";
          note.classList.add('is-error');
          note.classList.remove('is-warn');
          note.style.color = 'var(--c-orange-soft)';
        } else if (pd.loadError && n > 0) {
          note.textContent = 'Live prices may be stale.';
          note.classList.add('is-warn');
          note.classList.remove('is-error');
          note.style.color = 'var(--c-orange-soft)';
        } else {
          note.textContent = n
            ? n + ' position' + (n === 1 ? '' : 's') + ' tracked \u00b7 prices update every 30s' + (pd.unknownCostCount() ? ' \u00b7 gain/loss covers ' + (n - pd.unknownCostCount()) + ' with cost basis' : '')
            : 'No holdings yet \u2014 add your positions to start tracking.';
          note.classList.remove('is-error', 'is-warn');
          note.style.color = '';
        }
      }

      const portVal = $('#portVal');
      if (portVal) portVal.textContent = hasHoldings ? pd.formatUSD(total) : '$--.--';
      const portChange = $('#portChange');
      if (portChange) {
        portChange.textContent = pctText;
        portChange.classList.toggle('up', dayPct >= 0);
        portChange.classList.toggle('down', dayPct < 0);
      }
    }

    update();
    if (window.PortfolioData) window.PortfolioData.onUpdate(update);
    loadSparklines();
  }

  /* ---------- Subtle text scramble on hover ---------- */
  const SCRAMBLE_CHARS = '!@#$%^&*<>?/\\|=+';
  function scramble(el) {
    if (!el || el.dataset.scrambling === '1') return;
    const original = el.textContent;
    if (original.length < 3) return;
    el.dataset.original = original;
    el.dataset.scrambling = '1';

    let frame = 0;
    const maxFrames = 6;
    const interval = setInterval(() => {
      el.textContent = original.split('').map((ch, i) => {
        if (i < frame) return original[i];
        if (ch === ' ') return ' ';
        return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
      }).join('');
      frame++;
      if (frame > maxFrames) {
        clearInterval(interval);
        el.dataset.intervalId = '';
        el.textContent = original;
        el.dataset.scrambling = '0';
      }
    }, 40);
    el.dataset.intervalId = String(interval);
  }

  function cancel(el) {
    if (!el) return;
    if (el.dataset.intervalId) {
      clearInterval(Number(el.dataset.intervalId));
      el.dataset.intervalId = '';
    }
    if (el.dataset.original != null) {
      el.textContent = el.dataset.original;
    }
    el.dataset.scrambling = '0';
  }

  function bindScramble() {
    $$('.widget-title, .panel-title, .module-name').forEach((el) => {
      el.addEventListener('mouseenter', () => scramble(el));
      el.addEventListener('mouseleave', () => cancel(el));
    });
  }

  /* ---------- Init ---------- */
  function init() {
    tickClock();
    setInterval(tickClock, 1000);
    renderPortfolio();
    bindScramble();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
