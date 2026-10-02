/* ============================================================
   MASTER DASHBOARD · SHARED PORTFOLIO DATA
   File: portfolio-shared.js
   Live data layer for the portfolio used by:
     - System Telemetry tile  (index.html, app.js renderPortfolio)
     - Home grid widget        (index.html, #portVal)
     - Portfolio tracker page  (portfolio.html, portfolio.js)
   Loaded BEFORE app.js and portfolio.js on both pages.

   Data flow:
     /api/holdings       → ticker, shares, cost  (persistent)
     /api/prices         → live price, day change (Finnhub via fetch_prices.py)
     /api/price-history  → timeseries for chart
   ============================================================ */

(function () {
  'use strict';

  // In-memory cache, populated by load(). Falls back to an empty list
  // if the API is unreachable so the UI still renders (just shows $0.00).
  var _holdings = [];
  var _quotes = [];
  var _fetchedAt = null;
  var _loadError = false;
  var _onUpdate = [];

  function fetchJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // Merge holdings + live quotes into a single array of enriched holdings.
  function enrichedHoldings() {
    var quoteMap = {};
    _quotes.forEach(function (q) { quoteMap[q.ticker] = q; });
    return _holdings.map(function (h) {
      var q = quoteMap[h.ticker] || {};
      return {
        ticker: h.ticker,
        shares: h.shares,
        cost:   (typeof h.cost === 'number' && h.cost > 0) ? h.cost : null,
        account: h.account || '',
        price:  q.price || 0,
        change: q.change || 0,
        chg_pct: q.chg_pct || 0,
        high:   q.high || 0,
        low:    q.low || 0,
        open:   q.open || 0,
        prev_close: q.prev_close || 0,
      };
    });
  }

  function hasCost(h)    { return typeof h.cost === 'number' && h.cost > 0; }
  function marketValue(h) { return h.shares * h.price; }
  // Gain/loss only exists where the cost basis is known (some accounts don't show it).
  function costTotal(h)   { return hasCost(h) ? h.shares * h.cost : 0; }
  function gainDollar(h)  { return hasCost(h) && h.price ? (h.price - h.cost) * h.shares : null; }
  function gainPct(h) {
    return hasCost(h) && h.price ? ((h.price - h.cost) / h.cost) * 100 : null;
  }
  function totalMarketValue() {
    return enrichedHoldings().reduce(function (a, h) { return a + marketValue(h); }, 0);
  }
  function withCost() { return enrichedHoldings().filter(hasCost); }
  function totalCost() {
    return withCost().reduce(function (a, h) { return a + costTotal(h); }, 0);
  }
  function totalGain() {
    return withCost().reduce(function (a, h) { return a + marketValue(h) - costTotal(h); }, 0);
  }
  function totalGainPct() {
    var c = totalCost();
    return c > 0 ? (totalGain() / c) * 100 : 0;
  }
  function unknownCostCount() { return enrichedHoldings().filter(function (h) { return !hasCost(h); }).length; }
  // Day change: sum of (change * shares) across all holdings
  function totalDayChange() {
    return enrichedHoldings().reduce(function (a, h) {
      return a + (h.change || 0) * h.shares;
    }, 0);
  }
  function totalDayChangePct() {
    var prevClose = enrichedHoldings().reduce(function (a, h) {
      return a + (h.prev_close || h.price) * h.shares;
    }, 0);
    return prevClose > 0 ? (totalDayChange() / prevClose) * 100 : 0;
  }

  function formatUSD(n, decimals) {
    if (decimals == null) decimals = 2;
    if (!isFinite(n)) return '$0.00';
    var abs = Math.abs(n);
    var sign = n < 0 ? '-' : '';
    return sign + '$' + abs.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  // Load holdings + prices from the API. Returns a Promise.
  function load() {
    return Promise.all([
      fetchJSON('/api/holdings'),
      fetchJSON('/api/prices'),
    ]).then(function (results) {
      var holdingsData = results[0];
      var pricesData   = results[1];
      _holdings = Array.isArray(holdingsData) ? holdingsData : (holdingsData.holdings || []);
      _quotes   = pricesData.quotes || [];
      _fetchedAt = pricesData.fetched_at || null;
      _loadError = false;
      _notify();
      return enrichedHoldings();
    }).catch(function (err) {
      _loadError = true;
      console.warn('[PortfolioData] load failed:', err && err.message);
      return [];
    });
  }

  // Poll prices every 30s (dashboard open in browser).
  var _pollTimer = null;
  function startPolling(intervalSec) {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(function () {
      fetchJSON('/api/prices').then(function (pricesData) {
        _quotes = pricesData.quotes || [];
        _fetchedAt = pricesData.fetched_at || null;
        _loadError = false;
        _notify();
      }).catch(function (err) {
        _loadError = true;
        console.warn('[PortfolioData] price poll failed:', err && err.message);
      });
    }, Math.max(10, typeof intervalSec === 'number' ? intervalSec : 30) * 1000);
  }

  function onUpdate(fn) { _onUpdate.push(fn); }
  function _notify() {
    _onUpdate.forEach(function (fn) {
      try { fn(); } catch (e) { console.warn('[PortfolioData] onUpdate error:', e); }
    });
  }

  window.PortfolioData = {
    holdings: [],  // deprecated — use enrichedHoldings() for live data
    baseValue: 0,  // deprecated — use totalMarketValue()
    load: load,
    startPolling: startPolling,
    onUpdate: onUpdate,
    enrichedHoldings: enrichedHoldings,
    marketValue: marketValue,
    costTotal: costTotal,
    gainDollar: gainDollar,
    gainPct: gainPct,
    totalMarketValue: totalMarketValue,
    totalCost: totalCost,
    totalGain: totalGain,
    totalGainPct: totalGainPct,
    unknownCostCount: unknownCostCount,
    hasCost: hasCost,
    totalDayChange: totalDayChange,
    totalDayChangePct: totalDayChangePct,
    formatUSD: formatUSD,
    get fetchedAt() { return _fetchedAt; },
    get loadError() { return _loadError; },
  };

  // Auto-load on DOMContentLoaded so the value is correct on first paint.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      load().then(function () { startPolling(30); });
    });
  } else {
    load().then(function () { startPolling(30); });
  }
})();
