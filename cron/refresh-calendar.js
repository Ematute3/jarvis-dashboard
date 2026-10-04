#!/usr/bin/env node
/* ============================================================
   JARVIS Dashboard — calendar cache refresh cron.

   Runs once an hour under launchd (see
   cron/local.jarvis.dashboard.refresh.plist) so
   /api/calendar/aggregated stays warm with current Canvas
   assignments, Google Calendar events, and US holidays.

   Behavior:
     1. POST {JARVIS_URL}/api/cron/refresh-calendar — preferred
        path; lets the server invalidate its in-memory cache.
     2. If the server returns 404 (the cron endpoint is not
        implemented yet), fall back to GET
        {JARVIS_URL}/api/calendar/aggregated. The server caches
        internally on read.

   Override the URL with JARVIS_URL (default
   http://127.0.0.1:8765) so the same script works against a
   Tailscale IP from another machine.

   Exit codes:
     0 — refresh OK
     1 — network error, 4xx/5xx response, or invalid JSON

   No npm dependencies. Uses native fetch (Node 18+).
   ============================================================ */

'use strict';

const BASE_URL      = (process.env.JARVIS_URL || 'http://127.0.0.1:8765').replace(/\/+$/, '');
const CRON_PATH     = '/api/cron/refresh-calendar';
const FALLBACK_PATH = '/api/calendar/aggregated';
const TIMEOUT_MS    = 30000;

function log(line) {
  console.log(`[${new Date().toISOString()}] ${line}`);
}

// Best-effort event count across the response shapes the dashboard
// uses: an array, { events: [...] }, or { items: [...] }.
function countEvents(body) {
  if (!body || typeof body !== 'object') return 0;
  if (Array.isArray(body))               return body.length;
  if (Array.isArray(body.events))        return body.events.length;
  if (Array.isArray(body.items))         return body.items.length;
  return 0;
}

// POST JSON to the cron endpoint. Returns { ok, status, body }.
async function postJSON(url) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    '{}',
      signal:  ctrl.signal,
    });
    let body = null;
    try { body = await res.json(); } catch (_) { /* leave null */ }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: null, error: (err && err.message) || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// GET the aggregated endpoint. Returns { ok, status, count, body }.
async function getJSON(url) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res  = await fetch(url, { signal: ctrl.signal });
    let body   = null;
    try { body = await res.json(); } catch (_) { /* leave null */ }
    return { ok: res.ok, status: res.status, count: countEvents(body), body };
  } catch (err) {
    return { ok: false, status: 0, count: 0, body: null, error: (err && err.message) || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  log(`refreshing calendar cache at ${BASE_URL}`);

  const r1 = await postJSON(BASE_URL + CRON_PATH);
  if (r1.ok) {
    log(`POST ${CRON_PATH} -> ${r1.status}`);
    process.exit(0);
  }

  if (r1.status === 404) {
    log(`POST ${CRON_PATH} -> 404; falling back to GET ${FALLBACK_PATH}`);
    const r2 = await getJSON(BASE_URL + FALLBACK_PATH);
    if (r2.ok) {
      log(`GET ${FALLBACK_PATH} -> ${r2.status} events=${r2.count}`);
      process.exit(0);
    }
    const tail = r2.error ? ` ${r2.error}` : '';
    log(`GET ${FALLBACK_PATH} -> ${r2.status}${tail}`);
    process.exit(1);
  }

  const tail = r1.error ? ` ${r1.error}` : '';
  log(`POST ${CRON_PATH} -> ${r1.status}${tail}`);
  process.exit(1);
}

main().catch((err) => {
  log(`unexpected error: ${(err && err.message) || err}`);
  process.exit(1);
});