/* ============================================================
   JARVIS Dashboard Backend
   Standalone Express server that replaces the JARVIS backend
   for the chat, calendar, and email flows.

   Responsibilities:
     1. Serve the dashboard's static files (so one `npm start`
        gives you a working app — no separate dev server).
     2. Handle Google OAuth (loopback flow) for Calendar + Gmail.
     3. Proxy /api/chat to MiniMax with tool execution.
     4. Implement /api/calendar/events/new (calendar.events.insert).
     5. Implement /api/gmail/messages with server-side `q`.
     6. Implement /api/gmail/mark-read.
     7. Stub every other dashboard endpoint with honest empty
        states so the UI still renders cleanly.

   Optional integrations (configured via /api/config or .env):
     - Canvas: when canvasApiKey is set, /api/courses/all and
       /api/canvas/courses/:id/assignments hit the real Canvas
       instance at canvasBaseUrl. When unset, the endpoints
       return their empty-state shape.
     - Legacy JARVIS proxy: when jarvisApiBase is set, a single
       wildcard middleware on /api/* forwards any request not
       implemented authoritatively here (config, chat, calendar/
       events/new, gmail/mark-read, gmail/messages, goals/*,
       oauth/*) upstream to the legacy backend. Per-endpoint
       proxyToJarvis() calls remain as a defensive fallback for
       when jarvisApiBase is empty. When unset, every endpoint
       falls through to its local stub.
     - Custom system prompt: config.get('systemPrompt') is
       prepended to the built-in DEFAULT_SYSTEM_PROMPT on every
       /api/chat call. Empty string = use the built-in default.

   Start:    npm install && npm start
   Then:     http://localhost:8765/

   See .env.example for required configuration.
   ============================================================ */

'use strict';

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

require('dotenv').config();

const express      = require('express');
const cookieParser = require('cookie-parser');
const { google }   = require('googleapis');

const config = require('./config');

// --- Config (runtime-config.json, hot-reload via /api/config) ----------
const PORT = parseInt(process.env.PORT || '8765', 10);
const ROOT = __dirname;

const TOKEN_STORE_PATH = path.resolve(
  ROOT,
  process.env.TOKEN_STORE_PATH || './tokens.json'
);
const GOALS_FILE = path.join(ROOT, 'data', 'goals.json');

// --- Bootstrap: on first run, copy env vars into runtime-config.json ---
// When runtime-config.json doesn't exist yet, env vars (from .env) are
// the source of truth. We write any set env values into runtime-config
// once, so subsequent /api/config edits persist and take effect without
// a server restart. After bootstrap, runtime code reads ONLY via
// config.get(...).
(function bootstrapRuntimeConfig() {
  const cur = config.getAll();
  const patch = {};
  if (!cur.minimaxApiKey      && process.env.MINIMAX_API_KEY)      patch.minimaxApiKey      = process.env.MINIMAX_API_KEY;
  if (!cur.minimaxBaseUrl     && process.env.MINIMAX_BASE_URL)     patch.minimaxBaseUrl     = process.env.MINIMAX_BASE_URL;
  if (!cur.minimaxModel       && process.env.MINIMAX_MODEL)        patch.minimaxModel       = process.env.MINIMAX_MODEL;
  if (!cur.googleClientId     && process.env.GOOGLE_CLIENT_ID)     patch.googleClientId     = process.env.GOOGLE_CLIENT_ID;
  if (!cur.googleClientSecret && process.env.GOOGLE_CLIENT_SECRET) patch.googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!cur.googleRedirectUri) {
    patch.googleRedirectUri = process.env.GOOGLE_REDIRECT_URI
      || `http://127.0.0.1:${PORT}/oauth/callback`;
  }
  if (!cur.toolMaxIterations  && process.env.TOOL_MAX_ITERATIONS)  patch.toolMaxIterations  = parseInt(process.env.TOOL_MAX_ITERATIONS, 10);
  if (Object.keys(patch).length > 0) config.save(patch);
})();

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.modify',
];

// --- System prompt ------------------------------------------------------
const DEFAULT_SYSTEM_PROMPT = `You are JARVIS, Evan's personal dashboard assistant.

You can read Evan's Canvas courses and upcoming assignments, scan his recent Gmail inbox, list and create Google Calendar events, and manage a small goals list he keeps in the dashboard.

Capabilities:
- Read courses and assignments from Canvas.
- Read the recent inbox from Gmail.
- Read and write Google Calendar events.
- Manage a small goals list.

Tone: concise — one to three sentences for most answers. Be helpful, and willing to say "I don't see anything in your data about that."

Behavior:
- Confirm before destructive actions (deleting events, marking many emails read).
- Never invent data; if a tool returns empty results, tell the user that plainly.
- Never expose API keys, tokens, or internal endpoint URLs.`;

// Returns the prompt used for /api/chat. If the user has set a
// non-empty `systemPrompt` via /api/config, it is prepended in front of
// the built-in default so the LLM honors the user's instructions first
// while still knowing the server's capabilities. Empty string = revert
// to the built-in default.
function buildSystemPrompt() {
  const custom = config.get('systemPrompt');
  const base   = DEFAULT_SYSTEM_PROMPT;
  return custom ? custom + '\n\n---\n\n' + base : base;
}

// --- Helpers ------------------------------------------------------------

// Atomic write: write to .tmp with mode 0o600, then rename. Survives
// mid-write crashes. Mode is set on the tmp file before rename so the
// final path inherits it — this is critical for tokens.json, where the
// access + refresh tokens must be owner-readable only.
function atomicWriteJSON(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

function readJSON(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const txt = fs.readFileSync(filePath, 'utf8');
    return txt ? JSON.parse(txt) : fallback;
  } catch (_) {
    return fallback;
  }
}

function loadTokens()   { return readJSON(TOKEN_STORE_PATH, null); }
function saveTokens(t) { return atomicWriteJSON(TOKEN_STORE_PATH, t); }

function oauth2Client() {
  return new google.auth.OAuth2(
    config.get('googleClientId'),
    config.get('googleClientSecret'),
    config.get('googleRedirectUri')
  );
}

// Return an authed client if we have tokens, else null. Caller is
// responsible for sending the not-connected response.
function authedClientOrNull() {
  const tokens = loadTokens();
  if (!tokens) return null;
  const c = oauth2Client();
  c.setCredentials(tokens);
  // googleapis will auto-refresh when expiry_date approaches if a
  // refresh_token is present in the credentials.
  return c;
}

// Tool-call loop cap. Re-reads from runtime-config.json on every call
// so /api/config changes take effect immediately.
function toolMaxIterations() {
  const v = parseInt(config.get('toolMaxIterations'), 10);
  return Number.isFinite(v) && v > 0 ? v : 10;
}

// Internal fetch — used by /api/chat's tool loop to call our own server.
// Goes through 127.0.0.1 so we don't depend on a hostname resolving.
function internalFetch(pathname, init = {}) {
  const url = `http://127.0.0.1:${PORT}${pathname}`;
  return fetch(url, init);
}

// --- Canvas API helper --------------------------------------------------
// Returns { ok: true, data } on success (data is the parsed JSON body),
// or { ok: false, error } when unconfigured or the upstream fails. The
// "not configured" message tells the user where to fix it in the UI.
async function canvasFetch(path, init = {}) {
  const apiKey = config.get('canvasApiKey');
  if (!apiKey) {
    return {
      ok: false,
      error: 'Canvas API not configured. Add a Canvas API key in /settings.html.',
    };
  }
  const baseUrl = config.get('canvasBaseUrl') || 'https://elearn.ucr.edu';
  const headers = Object.assign(
    { 'Accept': 'application/json' },
    (init && init.headers) || {}
  );
  if (!Object.keys(headers).some((k) => k.toLowerCase() === 'authorization')) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  let upstream;
  try {
    upstream = await fetch(`${baseUrl}${path}`, Object.assign({}, init, { headers }));
  } catch (err) {
    return { ok: false, error: `Canvas network error: ${(err && err.message) || err}` };
  }
  let data = null;
  try { data = await upstream.json(); }
  catch (_) { data = null; }
  if (!upstream.ok) {
    const detail = data && (data.message || data.errors) ? ` — ${JSON.stringify(data)}` : '';
    return { ok: false, error: `Canvas HTTP ${upstream.status}${detail}` };
  }
  return { ok: true, data };
}

// --- Legacy JARVIS proxy ------------------------------------------------
// If jarvisApiBase is set, forward this request to the legacy JARVIS
// backend and stream its response back. Returns true when the request
// was handled (caller should return). Returns false when no proxy is
// configured — callers fall through to their local stub.
async function proxyToJarvis(req, res) {
  const base = config.get('jarvisApiBase');
  if (!base) return false;
  const url = base + req.originalUrl;
  const headers = { 'Accept': 'application/json' };
  const k = config.get('jarvisApiKey');
  if (k) headers.Authorization = 'Bearer ' + k;
  let upstream;
  try {
    upstream = await fetch(url, { method: req.method, headers });
  } catch (err) {
    res.status(502).json({ error: `Upstream JARVIS network error: ${(err && err.message) || err}` });
    return true;
  }
  res.status(upstream.status);
  const ct = upstream.headers.get('content-type');
  if (ct) res.setHeader('content-type', ct);
  else res.setHeader('content-type', 'application/json');
  const body = await upstream.text();
  res.send(body);
  return true;
}

// --- Goals storage ------------------------------------------------------

function loadGoals() {
  const v = readJSON(GOALS_FILE, []);
  return Array.isArray(v) ? v : [];
}

function saveGoals(goals) {
  atomicWriteJSON(GOALS_FILE, goals);
}

function nextGoalId(goals) {
  let max = 0;
  for (const g of goals) {
    if (!g || typeof g.id !== 'string') continue;
    const m = g.id.match(/^g-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'g-' + (max + 1);
}

// --- Calendar event shaping ---------------------------------------------
// Google Calendar returns { start: {dateTime|date} }. The dashboard wants
// { id, title, date: 'YYYY-MM-DD', start: 'HH:MM', durationMin, location,
//   isClass }. We set isClass=false everywhere; the schedule feed is the
// authoritative source for class meetings.

function shapeCalendarEvent(ev) {
  if (!ev || !ev.id) return null;
  const start = ev.start || {};
  const end   = ev.end   || {};
  const allDay = !!start.date || !!ev.allDay;

  let date, startHHMM, durationMin;
  if (allDay) {
    date = (start.date || '').slice(0, 10) || '';
    startHHMM = '00:00';
    durationMin = 1440;
  } else {
    const sdt = start.dateTime || '';
    const edt = end.dateTime || sdt;
    date = sdt.slice(0, 10);
    startHHMM = sdt.slice(11, 16);
    const s = new Date(sdt);
    const e = new Date(edt);
    durationMin = Math.max(0, Math.round((e - s) / 60000));
  }

  return {
    id: ev.id,
    title: ev.summary || '(untitled)',
    date,
    start: startHHMM,
    durationMin,
    location: ev.location || '',
    isClass: false,
  };
}

// --- Gmail helpers ------------------------------------------------------

function getHeader(headers, name) {
  if (!Array.isArray(headers)) return '';
  for (const h of headers) {
    if (h && h.name && h.name.toLowerCase() === name.toLowerCase()) {
      return h.value || '';
    }
  }
  return '';
}

// --- Express app --------------------------------------------------------

const app = express();

app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

// Loose CORS for local dev.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// --- Legacy JARVIS wildcard proxy --------------------------------------
// When jarvisApiBase is configured, forward every /api/* request to the
// legacy JARVIS backend and stream its response back. A short allow-list
// of "do NOT proxy" paths is checked first — these are the endpoints
// this server implements authoritatively (local config, MiniMax chat,
// Google Calendar/Gmail write actions, file-backed goals, the OAuth
// flow itself). When jarvisApiBase is empty, the middleware falls
// through to the per-endpoint handlers (which themselves call
// proxyToJarvis() as a defensive no-op).
//
// The legacy backend does not require a bearer token by default, so
// jarvisApiKey is usually empty. If it is set, send it as
// Authorization: Bearer <key>. The full req.originalUrl is forwarded
// (including query string) so e.g. /api/canvas/courses/234111/
// assignments?per_page=50 reaches the upstream intact.
app.use('/api', async (req, res, next) => {
  const base = config.get('jarvisApiBase');
  if (!base) return next(); // fall through to local handler
  // Don't proxy endpoints this server implements authoritatively.
  if (req.path === '/config' && (req.method === 'GET' || req.method === 'PUT')) return next();
  if (req.path === '/chat') return next();
  if (req.path.startsWith('/calendar/events/new')) return next();
  if (req.path === '/calendar/aggregated') return next(); // built locally from schedule + gcal + canvas + holidays
  if (req.path === '/holidays') return next();            // static OPM + CA + UCR tables, served locally
  if (req.path === '/cron/refresh-calendar') return next(); // drops the local 60s caches
  if (req.path.startsWith('/gmail/mark-read')) return next();
  if (req.path.startsWith('/gmail/messages') && req.method === 'GET') return next();
  if (req.path.startsWith('/goals')) return next(); // file-backed, local
  if (req.path.startsWith('/oauth/')) return next();
  // Everything else: proxy.
  try {
    const url = base + req.originalUrl;
    const headers = { 'Accept': 'application/json' };
    const k = config.get('jarvisApiKey');
    if (k) headers.Authorization = 'Bearer ' + k;
    const upstream = await fetch(url, { method: req.method, headers });
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('content-type', ct);
    const body = await upstream.text();
    res.send(body);
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Legacy JARVIS unreachable at ' + base + '.' });
  }
});

// --- OAuth --------------------------------------------------------------

app.get('/oauth/start', (req, res) => {
  if (!config.get('googleClientId') || !config.get('googleClientSecret')) {
    return res
      .status(500)
      .send('Google OAuth not configured. Set googleClientId and googleClientSecret via the settings page (or .env on first run).');
  }
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
  });
  const client = oauth2Client();
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES,
    state,
  });
  res.redirect(url);
});

app.get('/oauth/callback', async (req, res) => {
  const state = req.query.state;
  const code  = req.query.code;
  const cookieState = req.cookies.oauth_state;
  if (!state || !code || !cookieState || state !== cookieState) {
    return res.status(400).send('OAuth state mismatch.');
  }
  res.clearCookie('oauth_state');
  try {
    const client = oauth2Client();
    const { tokens } = await client.getToken(code);
    saveTokens(tokens);
    res.redirect('/');
  } catch (err) {
    res.status(500).send('OAuth exchange failed: ' + (err.message || err));
  }
});

app.get('/oauth/status', (req, res) => {
  const tokens = loadTokens();
  if (!tokens) return res.json({ connected: false, scopes: [] });
  const scopeStr = tokens.scope || '';
  const scopes = typeof scopeStr === 'string'
    ? scopeStr.split(/\s+/).filter(Boolean)
    : [];
  res.json({ connected: true, scopes });
});

// --- Stub API routes (honest empty states) -----------------------------
// Each "legacy" endpoint first asks proxyToJarvis() whether a proxy
// base URL is configured. If yes, the upstream response is streamed
// back. If no, the local honest-empty stub runs.

app.get('/api/schedule', async (req, res) => {
  if (await proxyToJarvis(req, res)) return;
  res.json([]);
});

app.get('/api/courses/all', async (req, res) => {
  if (await proxyToJarvis(req, res)) return;
  const r = await canvasFetch('/api/v1/courses?per_page=50');
  if (!r.ok) return res.json({ error: r.error });
  const list = Array.isArray(r.data) ? r.data : [];
  const courses = list.map((c) => ({
    id: c.id,
    code: c.course_code || c.name || '',
    name: c.name || c.course_code || '',
    source: 'canvas',
    currentScorePct: null,
  }));
  res.json(courses);
});

app.get('/api/plan', async (req, res) => {
  res.json({ error: 'No classes to plan from yet.' });
});

app.get('/api/news', async (req, res) => {
  res.json({});
});

app.get('/api/holdings', async (req, res) => {
  res.json([]);
});

app.get('/api/prices', async (req, res) => {
  res.json({ quotes: [], fetched_at: null });
});

app.get('/api/portfolio/history', async (req, res) => {
  res.json([]);
});

app.get('/api/canvas/courses/:id/assignments', async (req, res) => {
  if (await proxyToJarvis(req, res)) return;
  const id = encodeURIComponent(req.params.id);
  const r = await canvasFetch(`/api/v1/courses/${id}/assignments?per_page=50`);
  if (!r.ok) return res.json({ error: r.error });
  const list = Array.isArray(r.data) ? r.data : [];
  const assignments = list.map((a) => {
    let status = 'unsubmitted';
    if (a && a.workflow_state === 'submitted') {
      status = 'graded';
      if (a.submitted_at && (a.grade === null || a.grade === undefined || a.grade === '')) {
        status = 'submitted';
      }
    }
    return {
      id: a.id,
      title: a.name || '',
      dueDate: a.due_at || null,
      status,
    };
  });
  res.json(assignments);
});

// --- Config API ---------------------------------------------------------
// GET  /api/config — returns the current config with secrets masked.
// PUT  /api/config — accepts a partial patch of allowed keys.

app.get('/api/config', (req, res) => {
  const c = config.getAll();
  res.json({
    minimaxApiKey:         config.mask(c.minimaxApiKey),
    minimaxApiKeySet:      !!c.minimaxApiKey,
    minimaxBaseUrl:        c.minimaxBaseUrl,
    minimaxModel:          c.minimaxModel,
    googleClientId:        config.mask(c.googleClientId),
    googleClientIdSet:     !!c.googleClientId,
    googleClientSecret:    config.mask(c.googleClientSecret),
    googleClientSecretSet: !!c.googleClientSecret,
    googleRedirectUri:     c.googleRedirectUri,
    toolMaxIterations:     c.toolMaxIterations,
    canvasApiKey:          config.mask(c.canvasApiKey),
    canvasApiKeySet:       !!c.canvasApiKey,
    canvasBaseUrl:         c.canvasBaseUrl,
    jarvisApiBase:         c.jarvisApiBase,
    jarvisApiKey:          config.mask(c.jarvisApiKey),
    jarvisApiKeySet:       !!c.jarvisApiKey,
    systemPrompt:          c.systemPrompt,
    configPath:            config.CONFIG_PATH,
  });
});

app.put('/api/config', (req, res) => {
  const allowed = [
    'minimaxApiKey', 'minimaxBaseUrl', 'minimaxModel',
    'googleClientId', 'googleClientSecret', 'googleRedirectUri',
    'toolMaxIterations',
    'canvasApiKey', 'canvasBaseUrl',
    'jarvisApiBase', 'jarvisApiKey',
    'systemPrompt',
  ];
  const patch = {};
  for (const k of allowed) {
    if (k in req.body && (typeof req.body[k] === 'string' || typeof req.body[k] === 'number')) {
      patch[k] = req.body[k];
    }
  }
  config.save(patch);
  res.json({ ok: true });
});

// --- Goals API ----------------------------------------------------------

app.get('/api/goals', (req, res) => {
  res.json(loadGoals());
});

app.post('/api/goals', (req, res) => {
  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return res.status(400).json({ ok: false, error: 'name is required.' });
  const goals = loadGoals();
  const goal = { id: nextGoalId(goals), name, progress: 0 };
  goals.push(goal);
  saveGoals(goals);
  res.json({ ok: true, goals });
});

app.post('/api/goals/:id', (req, res) => {
  const goals = loadGoals();
  const idx = goals.findIndex((g) => g.id === req.params.id);
  if (idx < 0) return res.status(404).json({ ok: false, error: 'goal not found.' });
  const body = req.body || {};
  let progress = parseInt(body.progress, 10);
  if (!Number.isFinite(progress)) {
    return res.status(400).json({ ok: false, error: 'progress must be a number.' });
  }
  progress = Math.max(0, Math.min(100, progress));
  goals[idx].progress = progress;
  saveGoals(goals);
  res.json({ ok: true, goals });
});

app.delete('/api/goals/:id', (req, res) => {
  const goals = loadGoals();
  const idx = goals.findIndex((g) => g.id === req.params.id);
  if (idx < 0) return res.status(404).json({ ok: false, error: 'goal not found.' });
  goals.splice(idx, 1);
  saveGoals(goals);
  res.json({ ok: true, goals });
});

// --- Calendar API -------------------------------------------------------

app.get('/api/calendar/events', async (req, res) => {
  if (await proxyToJarvis(req, res)) return;
  const auth = authedClientOrNull();
  if (!auth) return res.json({ error: 'Google Calendar not connected.' });
  try {
    const calendar = google.calendar({ version: 'v3', auth });
    const r = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults: 50,
      singleEvents: true,
      orderBy: 'startTime',
    });
    const items = Array.isArray(r.data.items) ? r.data.items : [];
    const events = items.map(shapeCalendarEvent).filter(Boolean);
    res.json({ events });
  } catch (err) {
    res.json({ error: 'Could not load your calendar.' });
  }
});

// Accepts two body shapes:
//   { summary, description?, start: {dateTime, timeZone}, end: {dateTime, timeZone}, attendees? }
//   { summary, description?, date: 'YYYY-MM-DD', start: 'HH:MM', end: 'HH:MM' }
app.post('/api/calendar/events/new', async (req, res) => {
  const auth = authedClientOrNull();
  if (!auth) return res.json({ ok: false, error: 'Google Calendar not connected.' });
  const body = req.body || {};
  const summary     = typeof body.summary     === 'string' ? body.summary.trim()     : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';

  let startObj, endObj;
  if (body.start && typeof body.start === 'object') {
    startObj = body.start;
    endObj   = body.end && typeof body.end === 'object' ? body.end : {};
  } else {
    const date    = typeof body.date  === 'string' ? body.date  : '';
    const startHH = typeof body.start === 'string' ? body.start : '';
    const endHH   = typeof body.end   === 'string' ? body.end   : '';
    if (!date || !startHH || !endHH) {
      return res.json({
        ok: false,
        error: 'summary, date, start, end are required.',
      });
    }
    const tz = body.timeZone || 'America/Los_Angeles';
    startObj = { dateTime: `${date}T${startHH}:00`, timeZone: tz };
    endObj   = { dateTime: `${date}T${endHH}:00`,   timeZone: tz };
  }

  if (!summary) return res.json({ ok: false, error: 'summary is required.' });

  try {
    const calendar = google.calendar({ version: 'v3', auth });
    const r = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary,
        description: description || undefined,
        start: startObj,
        end:   endObj,
        attendees: Array.isArray(body.attendees) ? body.attendees : undefined,
      },
    });
    res.json({ ok: true, eventId: r.data.id, htmlLink: r.data.htmlLink });
  } catch (err) {
    res.json({ ok: false, error: (err && err.message) || 'Calendar insert failed.' });
  }
});

// --- Aggregated calendar & holidays --------------------------------------
// /api/holidays returns US federal holidays for a year range.
// /api/calendar/aggregated fans out to /api/schedule, /api/calendar/events,
// /api/courses/all, and /api/canvas/courses/:id/assignments, tags every
// item with a `kind` (class, schedule-meeting, meeting, personal,
// assignment, holiday), and serves a flat array sorted by date+start.
//
// US federal holidays are observed dates per the U.S. Office of Personnel
// Management (OPM) federal-holidays calendar
// (https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/).
// When a fixed-date holiday falls on a Saturday, the federal "in lieu of"
// date is the preceding Friday; when it falls on a Sunday, it is the
// following Monday. The table below is the hand-resolved observed dates
// for 2024–2028, which covers current year ± 2 around 2026. Add more
// years here if your term window extends further.

const US_FEDERAL_HOLIDAYS = {
  // 2024 — all fall on weekdays, no in-lieu-of shifts.
  '2024-01-01': { name: "New Year's Day", kind: 'federal' },
  '2024-01-15': { name: "Birthday of Martin Luther King, Jr.", kind: 'federal' },
  '2024-02-19': { name: "Washington's Birthday", kind: 'federal' },
  '2024-05-27': { name: 'Memorial Day', kind: 'federal' },
  '2024-06-19': { name: 'Juneteenth National Independence Day', kind: 'federal' },
  '2024-07-04': { name: 'Independence Day', kind: 'federal' },
  '2024-09-02': { name: 'Labor Day', kind: 'federal' },
  '2024-10-14': { name: 'Columbus Day', kind: 'federal' },
  '2024-11-11': { name: 'Veterans Day', kind: 'federal' },
  '2024-11-28': { name: 'Thanksgiving Day', kind: 'federal' },
  '2024-12-25': { name: 'Christmas Day', kind: 'federal' },
  // 2025 — all fall on weekdays, no in-lieu-of shifts.
  '2025-01-01': { name: "New Year's Day", kind: 'federal' },
  '2025-01-20': { name: "Birthday of Martin Luther King, Jr.", kind: 'federal' },
  '2025-02-17': { name: "Washington's Birthday", kind: 'federal' },
  '2025-05-26': { name: 'Memorial Day', kind: 'federal' },
  '2025-06-19': { name: 'Juneteenth National Independence Day', kind: 'federal' },
  '2025-07-04': { name: 'Independence Day', kind: 'federal' },
  '2025-09-01': { name: 'Labor Day', kind: 'federal' },
  '2025-10-13': { name: 'Columbus Day', kind: 'federal' },
  '2025-11-11': { name: 'Veterans Day', kind: 'federal' },
  '2025-11-27': { name: 'Thanksgiving Day', kind: 'federal' },
  '2025-12-25': { name: 'Christmas Day', kind: 'federal' },
  // 2026 — Independence Day (Sat Jul 4) is observed Fri Jul 3.
  '2026-01-01': { name: "New Year's Day", kind: 'federal' },
  '2026-01-19': { name: "Birthday of Martin Luther King, Jr.", kind: 'federal' },
  '2026-02-16': { name: "Washington's Birthday", kind: 'federal' },
  '2026-05-25': { name: 'Memorial Day', kind: 'federal' },
  '2026-06-19': { name: 'Juneteenth National Independence Day', kind: 'federal' },
  '2026-07-03': { name: 'Independence Day (observed)', kind: 'federal' },
  '2026-09-07': { name: 'Labor Day', kind: 'federal' },
  '2026-10-12': { name: 'Columbus Day', kind: 'federal' },
  '2026-11-11': { name: 'Veterans Day', kind: 'federal' },
  '2026-11-26': { name: 'Thanksgiving Day', kind: 'federal' },
  '2026-12-25': { name: 'Christmas Day', kind: 'federal' },
  // 2027 — Juneteenth (Sat) → Fri Jun 18; Independence Day (Sun) → Mon Jul 5;
  // Christmas (Sat) → Fri Dec 24.
  '2027-01-01': { name: "New Year's Day", kind: 'federal' },
  '2027-01-18': { name: "Birthday of Martin Luther King, Jr.", kind: 'federal' },
  '2027-02-15': { name: "Washington's Birthday", kind: 'federal' },
  '2027-05-31': { name: 'Memorial Day', kind: 'federal' },
  '2027-06-18': { name: 'Juneteenth National Independence Day (observed)', kind: 'federal' },
  '2027-07-05': { name: 'Independence Day (observed)', kind: 'federal' },
  '2027-09-06': { name: 'Labor Day', kind: 'federal' },
  '2027-10-11': { name: 'Columbus Day', kind: 'federal' },
  '2027-11-11': { name: 'Veterans Day', kind: 'federal' },
  '2027-11-25': { name: 'Thanksgiving Day', kind: 'federal' },
  '2027-12-24': { name: 'Christmas Day (observed)', kind: 'federal' },
  // 2028 — Veterans Day (Sat) → Fri Nov 10.
  '2028-01-17': { name: "Birthday of Martin Luther King, Jr.", kind: 'federal' },
  '2028-02-21': { name: "Washington's Birthday", kind: 'federal' },
  '2028-05-29': { name: 'Memorial Day', kind: 'federal' },
  '2028-06-19': { name: 'Juneteenth National Independence Day', kind: 'federal' },
  '2028-07-04': { name: 'Independence Day', kind: 'federal' },
  '2028-09-04': { name: 'Labor Day', kind: 'federal' },
  '2028-10-09': { name: 'Columbus Day', kind: 'federal' },
  '2028-11-10': { name: 'Veterans Day (observed)', kind: 'federal' },
  '2028-11-23': { name: 'Thanksgiving Day', kind: 'federal' },
  '2028-12-25': { name: 'Christmas Day', kind: 'federal' },
};

// California state holidays — per California Government Code § 19853 and
// § 6700. Includes the optional "Day after Thanksgiving" closure that the
// Governor's office has authorized in most years. Observed-date shifts are
// applied the same way as the federal table.
const CA_STATE_HOLIDAYS = {
  // 2024
  '2024-01-01': { name: "New Year's Day", kind: 'california' },
  '2024-01-15': { name: 'Dr. Martin Luther King, Jr. Day', kind: 'california' },
  '2024-02-19': { name: 'Presidents Day', kind: 'california' },
  '2024-03-31': { name: 'Cesar Chavez Day', kind: 'california' },
  '2024-05-27': { name: 'Memorial Day', kind: 'california' },
  '2024-06-19': { name: 'Juneteenth', kind: 'california' },
  '2024-07-04': { name: 'Independence Day', kind: 'california' },
  '2024-09-02': { name: 'Labor Day', kind: 'california' },
  '2024-09-09': { name: 'California Admission Day', kind: 'california' },
  '2024-10-14': { name: 'Columbus Day', kind: 'california' },
  '2024-11-11': { name: 'Veterans Day', kind: 'california' },
  '2024-11-28': { name: 'Thanksgiving Day', kind: 'california' },
  '2024-11-29': { name: 'Day after Thanksgiving', kind: 'california' },
  '2024-12-25': { name: 'Christmas Day', kind: 'california' },
  // 2025
  '2025-01-01': { name: "New Year's Day", kind: 'california' },
  '2025-01-20': { name: 'Dr. Martin Luther King, Jr. Day', kind: 'california' },
  '2025-02-17': { name: 'Presidents Day', kind: 'california' },
  '2025-03-31': { name: 'Cesar Chavez Day', kind: 'california' },
  '2025-05-26': { name: 'Memorial Day', kind: 'california' },
  '2025-06-19': { name: 'Juneteenth', kind: 'california' },
  '2025-07-04': { name: 'Independence Day', kind: 'california' },
  '2025-09-01': { name: 'Labor Day', kind: 'california' },
  '2025-09-09': { name: 'California Admission Day', kind: 'california' },
  '2025-10-13': { name: 'Columbus Day', kind: 'california' },
  '2025-11-11': { name: 'Veterans Day', kind: 'california' },
  '2025-11-27': { name: 'Thanksgiving Day', kind: 'california' },
  '2025-11-28': { name: 'Day after Thanksgiving', kind: 'california' },
  '2025-12-25': { name: 'Christmas Day', kind: 'california' },
  // 2026 — Independence Day Sat Jul 4 → observed Fri Jul 3.
  '2026-01-01': { name: "New Year's Day", kind: 'california' },
  '2026-01-19': { name: 'Dr. Martin Luther King, Jr. Day', kind: 'california' },
  '2026-02-16': { name: 'Presidents Day', kind: 'california' },
  '2026-03-31': { name: 'Cesar Chavez Day', kind: 'california' },
  '2026-05-25': { name: 'Memorial Day', kind: 'california' },
  '2026-06-19': { name: 'Juneteenth', kind: 'california' },
  '2026-07-03': { name: 'Independence Day (observed)', kind: 'california' },
  '2026-09-07': { name: 'Labor Day', kind: 'california' },
  '2026-09-09': { name: 'California Admission Day', kind: 'california' },
  '2026-10-12': { name: 'Columbus Day', kind: 'california' },
  '2026-11-11': { name: 'Veterans Day', kind: 'california' },
  '2026-11-26': { name: 'Thanksgiving Day', kind: 'california' },
  '2026-11-27': { name: 'Day after Thanksgiving', kind: 'california' },
  '2026-12-25': { name: 'Christmas Day', kind: 'california' },
  // 2027 — Juneteenth Sat → Fri Jun 18; Independence Day Sun → Mon Jul 5; Christmas Sat → Fri Dec 24.
  '2027-01-01': { name: "New Year's Day", kind: 'california' },
  '2027-01-18': { name: 'Dr. Martin Luther King, Jr. Day', kind: 'california' },
  '2027-02-15': { name: 'Presidents Day', kind: 'california' },
  '2027-03-31': { name: 'Cesar Chavez Day', kind: 'california' },
  '2027-05-31': { name: 'Memorial Day', kind: 'california' },
  '2027-06-18': { name: 'Juneteenth (observed)', kind: 'california' },
  '2027-07-05': { name: 'Independence Day (observed)', kind: 'california' },
  '2027-09-06': { name: 'Labor Day', kind: 'california' },
  '2027-09-09': { name: 'California Admission Day', kind: 'california' },
  '2027-10-11': { name: 'Columbus Day', kind: 'california' },
  '2027-11-11': { name: 'Veterans Day', kind: 'california' },
  '2027-11-25': { name: 'Thanksgiving Day', kind: 'california' },
  '2027-11-26': { name: 'Day after Thanksgiving', kind: 'california' },
  '2027-12-24': { name: 'Christmas Day (observed)', kind: 'california' },
  // 2028
  '2028-01-01': { name: "New Year's Day", kind: 'california' },
  '2028-01-17': { name: 'Dr. Martin Luther King, Jr. Day', kind: 'california' },
  '2028-02-21': { name: 'Presidents Day', kind: 'california' },
  '2028-03-31': { name: 'Cesar Chavez Day', kind: 'california' },
  '2028-05-29': { name: 'Memorial Day', kind: 'california' },
  '2028-06-19': { name: 'Juneteenth', kind: 'california' },
  '2028-07-04': { name: 'Independence Day', kind: 'california' },
  '2028-09-04': { name: 'Labor Day', kind: 'california' },
  '2028-09-09': { name: 'California Admission Day', kind: 'california' },
  '2028-10-09': { name: 'Columbus Day', kind: 'california' },
  '2028-11-10': { name: 'Veterans Day (observed)', kind: 'california' },
  '2028-11-23': { name: 'Thanksgiving Day', kind: 'california' },
  '2028-11-24': { name: 'Day after Thanksgiving', kind: 'california' },
  '2028-12-25': { name: 'Christmas Day', kind: 'california' },
};

// UCR academic calendar — instructional recesses, holidays, and finals
// windows. The dates below are pulled from the published UCR Academic
// Calendar for 2024-2027 and reduced to days when classes are not in
// session or the schedule should visibly look "different" on the dashboard.
// Sources:
//   https://registrar.ucr.edu/calendars/academic-calendar.html
//   https://insideucr.ucr.edu/academic-calendar
const UCR_ACADEMIC_HOLIDAYS = {
  // Fall 2024 — instruction Aug 28 – Dec 6; finals Dec 9-13.
  '2024-09-02': { name: 'Labor Day (no classes)', kind: 'ucr' },
  '2024-11-11': { name: 'Veterans Day (no classes)', kind: 'ucr' },
  '2024-11-25': { name: 'Fall recess', kind: 'ucr' },
  '2024-11-26': { name: 'Fall recess', kind: 'ucr' },
  '2024-11-27': { name: 'Thanksgiving (no classes)', kind: 'ucr' },
  '2024-11-28': { name: 'Thanksgiving (no classes)', kind: 'ucr' },
  '2024-11-29': { name: 'Thanksgiving (no classes)', kind: 'ucr' },
  // Winter 2025 — instruction Jan 6 – Mar 14; finals Mar 17-21.
  '2025-01-20': { name: 'Martin Luther King, Jr. Day (no classes)', kind: 'ucr' },
  '2025-02-17': { name: 'Presidents Day (no classes)', kind: 'ucr' },
  // Spring 2025 — instruction Mar 26 – Jun 12; finals Jun 13-19.
  '2025-03-31': { name: 'Cesar Chavez Day (no classes)', kind: 'ucr' },
  '2025-05-26': { name: 'Memorial Day (no classes)', kind: 'ucr' },
  // Fall 2025 — instruction Sep 22 – Dec 12; finals Dec 15-19.
  '2025-10-13': { name: 'Columbus Day (no classes)', kind: 'ucr' },
  '2025-11-11': { name: 'Veterans Day (no classes)', kind: 'ucr' },
  '2025-11-24': { name: 'Fall recess', kind: 'ucr' },
  '2025-11-25': { name: 'Fall recess', kind: 'ucr' },
  '2025-11-26': { name: 'Thanksgiving (no classes)', kind: 'ucr' },
  '2025-11-27': { name: 'Thanksgiving (no classes)', kind: 'ucr' },
  '2025-11-28': { name: 'Thanksgiving (no classes)', kind: 'ucr' },
  // Winter 2026 — instruction Jan 5 – Mar 13; finals Mar 16-20.
  '2026-01-19': { name: 'Martin Luther King, Jr. Day (no classes)', kind: 'ucr' },
  '2026-02-16': { name: 'Presidents Day (no classes)', kind: 'ucr' },
  // Spring 2026 — instruction Mar 25 – Jun 11; finals Jun 12-18.
  '2026-03-31': { name: 'Cesar Chavez Day (no classes)', kind: 'ucr' },
  '2026-05-25': { name: 'Memorial Day (no classes)', kind: 'ucr' },
  // Fall 2026 — instruction Sep 21 – Dec 11; finals Dec 14-18.
  '2026-10-12': { name: 'Columbus Day (no classes)', kind: 'ucr' },
  '2026-11-11': { name: 'Veterans Day (no classes)', kind: 'ucr' },
  '2026-11-23': { name: 'Fall recess', kind: 'ucr' },
  '2026-11-24': { name: 'Fall recess', kind: 'ucr' },
  '2026-11-25': { name: 'Thanksgiving (no classes)', kind: 'ucr' },
  '2026-11-26': { name: 'Thanksgiving (no classes)', kind: 'ucr' },
  '2026-11-27': { name: 'Thanksgiving (no classes)', kind: 'ucr' },
  // Winter 2027 — instruction Jan 4 – Mar 12; finals Mar 15-19.
  '2027-01-18': { name: 'Martin Luther King, Jr. Day (no classes)', kind: 'ucr' },
  '2027-02-15': { name: 'Presidents Day (no classes)', kind: 'ucr' },
};

// --- Holiday lookup helpers ---------------------------------------------
//
// The three static tables (US_FEDERAL_HOLIDAYS, CA_STATE_HOLIDAYS,
// UCR_ACADEMIC_HOLIDAYS) above are date-keyed `{ name, kind }` hashes
// covering 2024–2028. They are combined into HOLIDAYS_BY_KIND so the
// /api/holidays endpoint can serve all three sources through one
// `?kind=` filter. The kind values match the `kind` field embedded in
// each table's rows: 'federal', 'california', and 'ucr'. `ucr-academic`
// is accepted as an alias for `ucr` so a URL can stay short.

const HOLIDAYS_BY_KIND = {
  'federal':    US_FEDERAL_HOLIDAYS,
  'california': CA_STATE_HOLIDAYS,
  'ucr':        UCR_ACADEMIC_HOLIDAYS,
};

// Accepted values for the /api/holidays `?kind=` query param. `ucr-academic`
// is accepted as an alias for `ucr` to match the kind string used in the
// response payload examples.
const HOLIDAY_KIND_ALIASES = {
  'federal':       'federal',
  'california':    'california',
  'ucr':           'ucr',
  'ucr-academic':  'ucr',
};

// All kinds in display order (also drives the `kinds` summary field
// returned by /api/holidays).
const HOLIDAY_KINDS = ['federal', 'california', 'ucr'];

// Per-kind default color, mapped to the dashboard's existing CSS tokens
// (--c-cyan / --c-blue / --c-orange / --c-orange-soft in styles.css).
// Schedule items can override this when the legacy per-course color is
// available on the item.
const KIND_COLORS = {
  'class':            '#00E5FF',
  'schedule-meeting': '#2979FF',
  'meeting':          '#2979FF',
  'personal':         '#FF9100',
  'assignment':       '#FFB74D',
  'holiday':          '#FFB74D',
};

// Token alias map for items that carry a CSS-variable-style color name
// (legacy per-course colors use 'amber', 'magenta', etc.; the global
// styles.css tokens use 'orange' / 'orange-soft'). We translate the
// alias to its concrete hex so the front-end never has to resolve CSS
// variables for aggregator output.
const COLOR_TOKENS = {
  'cyan':        '#00E5FF',
  'blue':        '#2979FF',
  'orange':      '#FF9100',
  'orange-soft': '#FFB74D',
  'amber':       '#FF9100',
  'magenta':     '#FF4FB8',
  'violet':      '#A86CFF',
  'green':       '#6CFFB0',
};

function defaultColorForKind(kind) {
  return KIND_COLORS[kind] || '#00E5FF';
}

// Resolve the color for an aggregator event. Priority:
//   1. Hex value on item.color (legacy per-course color, etc.).
//   2. Token alias on item.color (COLOR_TOKENS).
//   3. Per-kind default (KIND_COLORS).
function resolveColor(item, kind) {
  const c = item && item.color;
  if (typeof c === 'string') {
    if (/^#[0-9a-f]{6}$/i.test(c)) return c;
    const lower = c.toLowerCase();
    if (COLOR_TOKENS[lower]) return COLOR_TOKENS[lower];
  }
  return defaultColorForKind(kind);
}

// `day` in /api/schedule items is 0=Mon..6=Sun (matches jsDayToMon0 in
// academics.js). Convert JS getDay() (0=Sun..6=Sat) to that same index.
function jsDayToMon0(jsDay) { return (jsDay + 6) % 7; }

function isoOfUTCDate(d) {
  return d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
}

function hhmmToMinutes(hhmm) {
  if (typeof hhmm !== 'string') return 0;
  const parts = hhmm.split(':');
  if (parts.length < 2) return 0;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

// Expand a single /api/schedule item into N concrete date events for every
// matching day-of-week inside the term, excluding skipDates. Each event
// is tagged "class" or "schedule-meeting" based on the source item's
// kind/category/type field.
function expandScheduleItem(item, idx) {
  if (!item || typeof item !== 'object') return [];
  const day = Number.isInteger(item.day) ? item.day : null;
  const termStart = typeof item.termStart === 'string' ? item.termStart : null;
  const termEnd   = typeof item.termEnd   === 'string' ? item.termEnd   : null;
  if (day === null || !termStart || !termEnd) return [];

  const startDate = new Date(termStart + 'T00:00:00Z');
  const endDate   = new Date(termEnd   + 'T23:59:59Z');
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return [];
  const skip = new Set(Array.isArray(item.skipDates) ? item.skipDates : []);

  const startMin = hhmmToMinutes(item.start);
  const endMin   = hhmmToMinutes(item.end);
  const durationMin = endMin > startMin ? (endMin - startMin) : 0;

  // Distinguish a plain class meeting from another recurring commitment
  // scheduled on the timetable (TA session, office hours, etc.).
  const catRaw = (item.kind || item.category || item.type || '').toString().toLowerCase();
  const kind = (catRaw === 'meeting' || catRaw === 'schedule-meeting' ||
                catRaw === 'ta'       || catRaw === 'office-hours'      ||
                catRaw === 'study')
    ? 'schedule-meeting'
    : 'class';

  const itemId = item.id != null ? String(item.id) : String(idx);
  const events = [];
  let occurrence = 0;

  // Walk day-by-day through the term in UTC to avoid DST drift.
  const cur = new Date(startDate);
  while (cur <= endDate) {
    if (jsDayToMon0(cur.getUTCDay()) === day) {
      const iso = isoOfUTCDate(cur);
      if (!skip.has(iso)) {
        events.push({
          kind,
          title: item.label || item.title || '(class)',
          date: iso,
          start: typeof item.start === 'string' ? item.start : '00:00',
          end:   typeof item.end   === 'string' ? item.end   : null,
          allDay: false,
          durationMin,
          source: 'schedule',
          sourceId: `sched-${itemId}-${occurrence}`,
          courseId: item.courseId != null ? item.courseId : null,
          location: item.location || '',
          locationShort: item.locationShort || '',
          notes: item.notes || null,
          color: resolveColor(item, kind),
          extra: {
            day,
            termStart,
            termEnd,
            category: item.category || null,
            originalKind: item.kind || null,
          },
        });
      }
      occurrence++;
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return events;
}

// Fetch a JSON document via internalFetch and return its parsed body, or
// null on error. The aggregator is best-effort — we never throw, we just
// drop a source that can't be reached.
async function fetchJSON(pathname) {
  try {
    const r = await internalFetch(pathname, { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  }
}

// Build the full aggregator payload from the four sources + holidays.
async function buildAggregatedEvents() {
  const out = [];

  // 1. /api/schedule → expand every item across its term.
  const schedule = await fetchJSON('/api/schedule');
  if (Array.isArray(schedule)) {
    schedule.forEach((item, i) => {
      out.push(...expandScheduleItem(item, i));
    });
  }

  // 2. /api/calendar/events → tag as "class" when isClass is true (legacy
  // can mark recurring class meetings as isClass even when category is
  // personal), otherwise "meeting" if there's an attendee list, else
  // "personal".
  const cal = await fetchJSON('/api/calendar/events');
  const calEvents = cal && Array.isArray(cal.events) ? cal.events : [];
  for (const ev of calEvents) {
    if (!ev || !ev.id) continue;
    let kind = 'personal';
    if (ev.isClass === true) kind = 'class';
    else if (Array.isArray(ev.attendees) && ev.attendees.length > 0) kind = 'meeting';
    out.push({
      kind,
      title: ev.title || ev.summary || '(untitled)',
      date: typeof ev.date === 'string' ? ev.date : '',
      start: typeof ev.start === 'string' ? ev.start : null,
      end:   typeof ev.end   === 'string' ? ev.end   : null,
      allDay: !!ev.allDay,
      durationMin: typeof ev.durationMin === 'number' ? ev.durationMin : 0,
      source: 'gcalendar',
      sourceId: `gcal-${ev.id}`,
      courseId: ev.courseId != null ? ev.courseId : null,
      location: ev.location || '',
      locationShort: ev.locationShort || '',
      notes: ev.notes || ev.description || null,
      color: resolveColor(ev, kind),
      extra: {
        attendees: Array.isArray(ev.attendees) ? ev.attendees : [],
        category: ev.category || null,
      },
    });
  }

  // 3. /api/courses/all + /api/canvas/courses/:id/assignments → tag each
  // assignment with a dueDate as an end-of-day all-day event.
  const courses = await fetchJSON('/api/courses/all');
  const courseList = Array.isArray(courses) ? courses : [];
  const canvasCourses = courseList.filter((c) => c && c.source === 'canvas' && c.id);
  const byCourse = await Promise.all(
    canvasCourses.map((c) =>
      fetchJSON(`/api/canvas/courses/${encodeURIComponent(c.id)}/assignments`)
        .then((data) => ({ course: c, list: Array.isArray(data) ? data : [] }))
        .catch(() => ({ course: c, list: [] }))
    )
  );
  for (const { course, list } of byCourse) {
    for (const a of list) {
      if (!a || !a.dueDate) continue;
      const iso = String(a.dueDate).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
      out.push({
        kind: 'assignment',
        title: a.title || '(assignment)',
        date: iso,
        start: '23:59',
        end: '23:59',
        allDay: true,
        durationMin: 0,
        source: 'canvas',
        sourceId: `canvas-${course.id}-${a.id != null ? a.id : 'unknown'}`,
        courseId: course.id,
        location: '',
        locationShort: '',
        notes: null,
        color: defaultColorForKind('assignment'),
        extra: {
          assignmentId: a.id != null ? a.id : null,
          status: a.status || null,
          courseCode: course.code || course.name || null,
        },
      });
    }
  }

  // 4. Holidays — pull entries from every kind table (federal, California,
  // UCR-academic) whose observed date falls inside the current-year ± 1
  // window. Aggregator-level kind stays 'holiday' so the calendar grid
  // colors all holidays uniformly; the source-specific kind is preserved
  // in extra.holidayKind so the front-end can vary icons/tooltips.
  const nowYear = new Date().getUTCFullYear();
  const years = new Set([nowYear - 1, nowYear, nowYear + 1]);
  for (const tableKind of HOLIDAY_KINDS) {
    const table = HOLIDAYS_BY_KIND[tableKind];
    if (!table) continue;
    for (const iso of Object.keys(table).sort()) {
      const yr = parseInt(iso.slice(0, 4), 10);
      if (!years.has(yr)) continue;
      const h = table[iso];
      out.push({
        kind: 'holiday',
        title: h.name,
        date: iso,
        start: null,
        end: null,
        allDay: true,
        durationMin: 1440,
        source: 'holidays',
        sourceId: `holiday-${iso}`,
        courseId: null,
        location: '',
        locationShort: '',
        notes: null,
        color: defaultColorForKind('holiday'),
        extra: { holidayKind: h.kind || tableKind },
      });
    }
  }

  // Sort by date + start (null start sorts last within a date).
  out.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const as = a.start || '99:99';
    const bs = b.start || '99:99';
    return as < bs ? -1 : as > bs ? 1 : 0;
  });

  return out;
}

// --- Cache ---------------------------------------------------------------
// In-memory 60s TTL for the aggregator and the holidays endpoint. The cron
// agent (separate worker) calls invalidateCalendarCache() — also reachable
// at /api/cron/refresh-calendar — to drop both caches when something
// upstream changes.

const CACHE_TTL_MS = 60 * 1000;
let _aggCache = null;
let _aggCachedAt = 0;
let _holCache = null;
let _holCachedAt = 0;

async function getAggregatedEvents() {
  const now = Date.now();
  if (_aggCache && now - _aggCachedAt < CACHE_TTL_MS) return _aggCache;
  _aggCache = await buildAggregatedEvents();
  _aggCachedAt = now;
  return _aggCache;
}

function getHolidaysForYears(years, kind) {
  // The cache key includes both the year list and resolved kind so a
  // /api/holidays?kind=federal request and an unfiltered request with
  // the same year list don't share a cache slot.
  const resolvedKind = kind && HOLIDAY_KIND_ALIASES[kind]
    ? HOLIDAY_KIND_ALIASES[kind]
    : '';
  const key = years.join(',') + '|' + resolvedKind;
  const now = Date.now();
  if (_holCache && _holCache.key === key && now - _holCachedAt < CACHE_TTL_MS) {
    return _holCache.value;
  }
  const set = new Set(years);
  const tables = resolvedKind
    ? [[resolvedKind, HOLIDAYS_BY_KIND[resolvedKind]]]
    : HOLIDAY_KINDS.map((k) => [k, HOLIDAYS_BY_KIND[k]]);
  const out = [];
  for (const [tableKind, table] of tables) {
    if (!table) continue;
    for (const iso of Object.keys(table).sort()) {
      const yr = parseInt(iso.slice(0, 4), 10);
      if (!set.has(yr)) continue;
      const h = table[iso];
      out.push({ date: iso, name: h.name, kind: h.kind || tableKind });
    }
  }
  // Stable sort by date (all entries already share their kind's order).
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  _holCache = { key, value: out };
  _holCachedAt = now;
  return out;
}

// Called by /api/cron/refresh-calendar (and by the cron agent) to force
// the next request to rebuild from scratch.
function invalidateCalendarCache() {
  _aggCache = null;
  _aggCachedAt = 0;
  _holCache = null;
  _holCachedAt = 0;
}

// --- Endpoints -----------------------------------------------------------

// GET /api/holidays
//   ?year=YYYY        — single year (e.g. "2026") or comma-separated list
//                       (e.g. "2025,2026,2027"). Default: current year.
//   ?kind=federal|california|ucr-academic|ucr
//                    — limit results to one source. `ucr` is an accepted
//                       alias for `ucr-academic`.
//
// Response shape:
//   { holidays: [{date, name, kind}, ...], kinds: [...], year: N }
//
// `kinds` lists every supported kind in display order (independent of
// the active filter) so the front-end can build a legend without a
// second request. `year` echoes the primary year (first in the list,
// or the current year if no `?year=` was supplied) for UI convenience.
app.get('/api/holidays', (req, res) => {
  const yearParam = typeof req.query.year === 'string' ? req.query.year : '';
  let years;
  if (yearParam) {
    years = yearParam
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 1900 && n < 3000);
    if (years.length === 0) {
      return res.status(400).json({ error: 'year must be one or more 4-digit years.' });
    }
  } else {
    years = [new Date().getUTCFullYear()];
  }
  const kindParam = typeof req.query.kind === 'string' ? req.query.kind : '';
  if (kindParam && !HOLIDAY_KIND_ALIASES[kindParam]) {
    return res.status(400).json({
      error: `kind must be one of ${HOLIDAY_KINDS.join(', ')} (alias: ucr).`,
    });
  }
  res.json({
    holidays: getHolidaysForYears(years, kindParam),
    kinds: HOLIDAY_KINDS,
    year: years[0],
  });
});

// GET /api/calendar/aggregated
// Flat array of events tagged with `kind`, sorted by date + start.
// Cached in-memory for 60 seconds; invalidate via /api/cron/refresh-calendar.
app.get('/api/calendar/aggregated', async (req, res) => {
  try {
    const events = await getAggregatedEvents();
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: 'Could not build the aggregated calendar.' });
  }
});

// POST (or GET) /api/cron/refresh-calendar — drops both 60s caches. The
// cron agent calls this when upstream state changes.
app.all('/api/cron/refresh-calendar', (req, res) => {
  invalidateCalendarCache();
  res.json({ ok: true });
});

// --- Gmail API ----------------------------------------------------------

app.get('/api/gmail/messages', async (req, res) => {
  const auth = authedClientOrNull();
  if (!auth) return res.json({ error: 'Gmail not connected.' });

  const q          = typeof req.query.q === 'string' ? req.query.q : '';
  // The dashboard sends ?limit=6; we accept both limit and maxResults.
  const limitRaw   = parseInt(req.query.maxResults || req.query.limit, 10);
  const maxResults = Math.max(1, Math.min(100, Number.isFinite(limitRaw) ? limitRaw : 10));

  try {
    const gmail = google.gmail({ version: 'v1', auth });
    const r = await gmail.users.messages.list({
      userId: 'me',
      q,
      maxResults,
    });
    const list = Array.isArray(r.data.messages) ? r.data.messages : [];

    const out = [];
    for (const m of list) {
      if (!m || !m.id) continue;
      try {
        const meta = await gmail.users.messages.get({
          userId: 'me',
          id: m.id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject'],
        });
        const headers = (meta.data && meta.data.payload && meta.data.payload.headers) || [];
        const labels  = Array.isArray(meta.data.labelIds) ? meta.data.labelIds : [];
        out.push({
          id: m.id,
          from: getHeader(headers, 'From'),
          subject: getHeader(headers, 'Subject'),
          unread: labels.includes('UNREAD'),
          snippet: meta.data.snippet || '',
        });
      } catch (_) { /* skip this one */ }
    }
    res.json({ messages: out });
  } catch (err) {
    res.json({ error: 'Could not load your inbox.' });
  }
});

app.post('/api/gmail/mark-read', async (req, res) => {
  const auth = authedClientOrNull();
  if (!auth) return res.json({ ok: false, error: 'Gmail not connected.' });
  const body = req.body || {};
  const ids = Array.isArray(body.messageIds)
    ? body.messageIds.filter((x) => typeof x === 'string' && x)
    : [];
  if (ids.length === 0) {
    return res.json({ ok: false, error: 'messageIds is required.' });
  }
  try {
    const gmail = google.gmail({ version: 'v1', auth });
    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: {
        ids,
        removeLabelIds: ['UNREAD'],
      },
    });
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: (err && err.message) || 'Gmail modify failed.' });
  }
});

// --- Chat: tool definitions ----------------------------------------------

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'add_event',
      description:
        "Create a new Google Calendar event. Requires the date and time; " +
        "ask the user if anything is missing. Only call once the user has " +
        "confirmed the details.",
      parameters: {
        type: 'object',
        properties: {
          title:    { type: 'string', description: 'Short event title.' },
          date:     { type: 'string', description: 'Date in YYYY-MM-DD.' },
          start:    { type: 'string', description: 'Start time in HH:MM (24h).' },
          end:      { type: 'string', description: 'End time in HH:MM (24h).' },
          location: { type: 'string', description: 'Optional location.' },
          notes:    { type: 'string', description: 'Optional notes.' },
        },
        required: ['title', 'date', 'start', 'end'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_courses',
      description: "List every course the user is enrolled in (Canvas + manual).",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_assignments',
      description:
        "List upcoming assignments. Pass a course_id to scope to one Canvas " +
        "course; omit to list across every Canvas course the user is in.",
      parameters: {
        type: 'object',
        properties: {
          course_id: { type: 'string', description: 'Optional Canvas course id.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_events',
      description:
        "List the user's Google Calendar events (server returns the next " +
        "window of upcoming events).",
      parameters: {
        type: 'object',
        properties: {
          days_ahead: {
            type: 'number',
            description: 'How many days ahead to look (informational).',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_emails',
      description: "Search the user's recent inbox via Gmail.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Gmail search query string.' },
          limit: { type: 'number', description: 'How many messages to scan (default 10).' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mark_email_read',
      description: "Mark a Gmail message as read.",
      parameters: {
        type: 'object',
        properties: {
          message_id: { type: 'string', description: 'The Gmail message id to mark read.' },
        },
        required: ['message_id'],
        additionalProperties: false,
      },
    },
  },
];

async function callMinimax(messages) {
  const apiKey = config.get('minimaxApiKey');
  if (!apiKey) {
    return { ok: false, error: 'minimaxApiKey is not configured.' };
  }
  const base  = config.get('minimaxBaseUrl');
  const model = config.get('minimaxModel');
  let r;
  try {
    r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        tools: TOOL_DEFINITIONS,
      }),
    });
  } catch (err) {
    // Surface useful diagnostics for the user when the fetch itself fails
    // (DNS, refused connection, TLS, timeout). The raw Node error message
    // is often "fetch failed" which isn't actionable on its own.
    const cause = (err && (err.cause || err)) || {};
    const code = cause.code || (err && err.code) || '';
    const msg  = (err && err.message) || String(err);
    let hint = '';
    if (code === 'ENOTFOUND' || /getaddrinfo/i.test(msg) || /ENOTFOUND/.test(code)) {
      hint = ` — the MiniMax API host '${base}' does not resolve. Check minimaxBaseUrl in /settings.html.`;
    } else if (code === 'ECONNREFUSED') {
      hint = ` — connection refused at ${base}. Is the URL correct and the port open?`;
    } else if (code === 'ETIMEDOUT' || code === 'ECONNRESET') {
      hint = ` — the request timed out or was reset. Try again or check your network.`;
    } else if (/certificate|TLS|SSL/i.test(msg)) {
      hint = ` — TLS error. The base URL must use https:// for a real API.`;
    }
    return { ok: false, error: `LLM network error: ${msg}${hint}` };
  }
  if (!r.ok) {
    let detail = '';
    try { detail = await r.text(); } catch (_) { /* ignore */ }
    return { ok: false, error: `LLM HTTP ${r.status}: ${detail.slice(0, 200)}` };
  }
  let data;
  try { data = await r.json(); }
  catch (_) { return { ok: false, error: 'LLM returned non-JSON.' }; }
  const msg = data && data.choices && data.choices[0] && data.choices[0].message;
  return msg || { ok: false, error: 'LLM returned no choices.' };
}

async function executeToolCall(name, args) {
  try {
    switch (name) {
      case 'add_event': {
        const a = args || {};
        if (!a.title || !a.date || !a.start || !a.end) {
          return { ok: false, error: 'add_event needs title, date, start, end.' };
        }
        const r = await internalFetch('/api/calendar/events/new', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            summary: a.title,
            date: a.date,
            start: a.start,
            end: a.end,
            location: a.location || '',
            description: a.notes || '',
          }),
        });
        if (!r.ok) return { ok: false, error: `Calendar HTTP ${r.status}` };
        return await r.json();
      }

      case 'list_courses': {
        const r = await internalFetch('/api/courses/all');
        if (!r.ok) return { ok: false, error: `Courses HTTP ${r.status}` };
        return await r.json();
      }

      case 'list_assignments': {
        if (args && typeof args.course_id === 'string' && args.course_id) {
          const r = await internalFetch(
            `/api/canvas/courses/${encodeURIComponent(args.course_id)}/assignments`
          );
          if (!r.ok) return { ok: false, error: `Assignments HTTP ${r.status}` };
          return await r.json();
        }
        const cr = await internalFetch('/api/courses/all');
        if (!cr.ok) return { ok: false, error: `Courses HTTP ${cr.status}` };
        const courses = await cr.json();
        const list = Array.isArray(courses) ? courses : [];
        const results = [];
        for (const c of list) {
          if (!c || c.source !== 'canvas' || !c.id) continue;
          try {
            const r = await internalFetch(
              `/api/canvas/courses/${encodeURIComponent(c.id)}/assignments`
            );
            if (!r.ok) continue;
            const arr = await r.json();
            if (Array.isArray(arr)) results.push(...arr);
          } catch (_) { /* skip this course */ }
        }
        return results;
      }

      case 'list_events': {
        const r = await internalFetch('/api/calendar/events');
        if (!r.ok) return { ok: false, error: `Calendar HTTP ${r.status}` };
        return await r.json();
      }

      case 'search_emails': {
        const query = typeof args.query === 'string' ? args.query : '';
        if (!query) return { ok: false, error: 'query is required.' };
        const limit = Number.isFinite(args.limit) && args.limit > 0 ? args.limit : 10;
        const r = await internalFetch(
          `/api/gmail/messages?q=${encodeURIComponent(query)}&maxResults=${encodeURIComponent(limit)}`
        );
        if (!r.ok) return { ok: false, error: `Gmail HTTP ${r.status}` };
        return await r.json();
      }

      case 'mark_email_read': {
        if (typeof args.message_id !== 'string' || !args.message_id) {
          return { ok: false, error: 'message_id is required.' };
        }
        const r = await internalFetch('/api/gmail/mark-read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageIds: [args.message_id] }),
        });
        if (!r.ok) return { ok: false, error: `Gmail HTTP ${r.status}` };
        return await r.json();
      }

      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

// --- /api/chat ----------------------------------------------------------

app.post('/api/chat', async (req, res) => {
  const body = req.body || {};
  const userMessages = Array.isArray(body.messages) ? body.messages : null;
  if (!userMessages || userMessages.length === 0) {
    return res.status(400).json({ ok: false, error: 'No messages provided.' });
  }

  // System prompt goes in front of whatever the client sent. Re-read
  // config.get('systemPrompt') on every request so changes via the
  // settings UI take effect immediately.
  const messages = [{ role: 'system', content: buildSystemPrompt() }, ...userMessages];
  const allToolCalls = [];

  for (let i = 0; i < toolMaxIterations(); i++) {
    const assistant = await callMinimax(messages);
    if (!assistant || assistant.ok === false) {
      return res.status(502).json({
        ok: false,
        error: (assistant && assistant.error) || 'LLM did not return a response.',
        tool_calls: allToolCalls,
      });
    }

    messages.push(assistant);

    const calls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
    if (calls.length === 0) {
      // Final assistant turn — no more tool calls.
      return res.json({
        ok: true,
        reply: assistant.content || '',
        tool_calls: allToolCalls,
      });
    }

    // Execute every tool call the assistant asked for, then feed the
    // results back so the LLM can produce the final reply on the next
    // round-trip.
    for (const tc of calls) {
      const fn = tc.function || {};
      const name = fn.name;
      let parsedArgs = {};
      try { parsedArgs = JSON.parse(fn.arguments || '{}'); }
      catch (_) { parsedArgs = {}; }

      const result = await executeToolCall(name, parsedArgs);
      allToolCalls.push({ name, args: parsedArgs, result });

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }
  }

  // Hit the iteration cap. Surface what we have rather than hanging.
  res.json({
    ok: true,
    reply: "I got stuck in a loop trying to answer that — could you rephrase?",
    tool_calls: allToolCalls,
  });
});

// --- Static file serving -----------------------------------------------
// Order matters: special-case routes first, then catch-all static.

const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'application/svg+xml',
  '.ico':  'image/x-icon',
};

function readAndSend(absPath, res, contentType, next) {
  fs.readFile(absPath, (err, data) => {
    if (err) return next();
    res.setHeader('Content-Type', contentType);
    res.end(data);
  });
}

// mobile.html — tiny stub if not present.
app.get('/mobile.html', (req, res, next) => {
  const p = path.join(ROOT, 'mobile.html');
  if (fs.existsSync(p)) return next();
  res
    .status(200)
    .setHeader('Content-Type', 'text/html; charset=utf-8')
    .send('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=index.html">');
});

function serveIndex(req, res, next) {
  res.setHeader('Cache-Control', 'no-cache');
  readAndSend(path.join(ROOT, 'index.html'), res, 'text/html; charset=utf-8', next);
}
app.get('/',           serveIndex);
app.get('/index.html', serveIndex);

app.get('/manifest.json', (req, res, next) => {
  readAndSend(path.join(ROOT, 'manifest.json'), res, 'application/json; charset=utf-8', next);
});

app.get('/apple-touch-icon.png', (req, res, next) => {
  readAndSend(path.join(ROOT, 'apple-touch-icon.png'), res, 'image/png', next);
});

// Catch-all static — .css, .js, images, etc. from the dashboard root.
// Force revalidation for HTML/JS/CSS so the browser never replays a stale
// script (which would silently break the home widgets when academics.js /
// extras.js / index.html change shape on disk). Images and other binary
// assets are left to Express's default caching.
app.use(express.static(ROOT, {
  setHeaders: (res, filePath) => {
    const ext  = path.extname(filePath).toLowerCase();
    const mime = STATIC_MIME[ext];
    if (mime) res.setHeader('Content-Type', mime);
    if (ext === '.html' || ext === '.js' || ext === '.css') {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// --- Boot --------------------------------------------------------------

app.listen(PORT, () => {
  const c = config.getAll();
  console.log(`\n  JARVIS dashboard server`);
  console.log(`  → http://localhost:${PORT}/index.html`);
  if (!c.minimaxApiKey)      console.warn('  ! minimaxApiKey is not set (chat will return 502).');
  if (!c.googleClientId)     console.warn('  ! googleClientId is not set (Google features disabled).');
  if (!c.googleClientSecret) console.warn('  ! googleClientSecret is not set.');
  console.log(`  Tokens → ${TOKEN_STORE_PATH}`);
  console.log(`  Goals  → ${GOALS_FILE}`);
  console.log(`  Config → ${config.CONFIG_PATH}\n`);
});