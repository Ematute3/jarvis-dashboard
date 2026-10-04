/* ============================================================
   MOCK DEV SERVER — runs locally, no real data
   Run with:  node dev-server.js
   Then open: http://localhost:8765/index.html

   This is a learning scaffold only. It serves every file in this
   directory and replies to the API calls the dashboard makes with
   honest empty states, so you can see how the UI is wired without
   plugging in Canvas / Gmail / Google Calendar / a price feed.

   Replace these stubs with real endpoints when you're ready.
   ============================================================ */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const PORT = 8765;
const ROOT = __dirname;

// --- Mock API responses (all honest "nothing configured" replies) ---
const mock = {
  '/api/schedule':          { error: 'No weekly schedule saved yet.' },
  '/api/courses/all':       [],
  '/api/calendar/events':   { error: 'Google Calendar not connected.' },
  '/api/plan':              { error: 'No classes to plan from yet.' },
  '/api/news':              { headlines: [] },
  '/api/holdings':          [],
  '/api/prices':            { quotes: [], fetched_at: null },
  '/api/portfolio/history': [],
  '/api/goals':             [],
  '/api/gmail/messages':    { error: 'Gmail not connected.' },
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

// --- Mock POST /api/chat helpers -----------------------------------------
// Heuristic canned replies. NOT a real LLM integration — purely so the UI
// can exercise its /api/chat wiring during local development. The real
// chat backend (LLM + tool routing) lives in chat-backend.js.
const DAY_INDEX = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

// Next YYYY-MM-DD on which `new Date().getDay()` equals `dayIdx`
// (always strictly in the future — if today matches, jumps 7 days).
function nextDateForDay(dayIdx) {
  const now = new Date();
  const diff = (dayIdx - now.getDay() + 7) % 7 || 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Best-effort title extraction: phrase after "add"/"schedule"/"create",
// stripping trailing day names / prepositions / punctuation.
function extractEventTitle(text) {
  const m = text.match(/(?:add|schedule|create)\s+(?:a\s+|an\s+)?(.+?)(?:\s+(?:on|for|at)\b|[?.!]|$)/i);
  if (!m) return null;
  let t = m[1].trim().replace(/\s+/g, ' ');
  t = t.replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*$/i, '').trim();
  t = t.replace(/[.,!?]+$/, '');
  return (t && t.length <= 60) ? t : null;
}

function mockChatReply(body) {
  const msgs = body && Array.isArray(body.messages) ? body.messages : [];
  // Take the most recent user message.
  let text = '';
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i] && msgs[i].role === 'user' && typeof msgs[i].content === 'string') {
      text = msgs[i].content;
      break;
    }
  }
  const lower = text.toLowerCase();
  const dayMatch = lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  const dayName = dayMatch ? dayMatch[1] : null;

  // Heuristic 1: "add" + day-of-week or "event" → tool_call add_event.
  if (lower.indexOf('add') !== -1 && (dayName || lower.indexOf('event') !== -1)) {
    const date = dayName
      ? nextDateForDay(DAY_INDEX[dayName])
      : nextDateForDay((new Date().getDay() + 1) % 7);
    const fallback = dayName
      ? dayName[0].toUpperCase() + dayName.slice(1) + ' event'
      : 'New event';
    const title = extractEventTitle(text) || fallback;
    const start = dayName ? '16:00' : '09:00';
    const end   = dayName ? '17:00' : '10:00';
    return {
      ok: true,
      reply: dayName
        ? `Sure, I've added ${title} on ${dayName} at ${start}.`
        : `Sure, I've added ${title} on ${date} at ${start}.`,
      tool_calls: [{ name: 'add_event', args: { title, date, start, end } }],
    };
  }

  // Heuristic 2: "courses" or "assignments" → tool_call list_assignments.
  if (lower.indexOf('course') !== -1 || lower.indexOf('assignment') !== -1) {
    return {
      ok: true,
      reply: 'Let me pull up your assignments.',
      tool_calls: [{ name: 'list_assignments', args: {} }],
    };
  }

  // Fallback: echo.
  const reply = text
    ? `I'm running in mock mode — I can echo: ${text}`
    : `I'm running in mock mode.`;
  return { ok: true, reply, tool_calls: [] };
}

// -----------------------------------------------------------------------

function serveFile(req, res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found: ' + req.url);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS for local development
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // POST /api/chat — mock chat endpoint (see mockChatReply above).
  // Reads the request body, applies a few heuristics, returns a canned
  // { ok, reply, tool_calls } envelope. NOT real LLM integration — purely
  // so the UI can exercise its /api/chat wiring during local development.
  if (req.method === 'POST' && pathname === '/api/chat') {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      let body = null;
      try { body = JSON.parse(raw || '{}'); }
      catch (_) { body = null; }
      let payload;
      let status = 200;
      if (!body) {
        status = 400;
        payload = { ok: false, error: 'Invalid JSON body.' };
      } else {
        payload = mockChatReply(body);
      }
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
      console.log('[mock]', req.method, pathname, '→', JSON.stringify(payload).slice(0, 120));
    });
    return;
  }

  // API: empty-state JSON
  if (pathname.startsWith('/api/')) {
    const body = pathname in mock
      ? mock[pathname]
      : (pathname.startsWith('/api/canvas/courses/') && pathname.endsWith('/assignments'))
        ? []   // every course's assignment list
        : { error: 'Not implemented in mock server: ' + pathname };

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
    console.log('[mock]', req.method, pathname, '→', JSON.stringify(body).slice(0, 80));
    return;
  }

  // Static files
  let rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(ROOT, rel);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  serveFile(req, res, filePath);
});

server.listen(PORT, () => {
  console.log(`\n  JARVIS dev server (mock data)`);
  console.log(`  → http://localhost:${PORT}/index.html\n`);
  console.log(`  All /api/* endpoints return honest empty states so the`);
  console.log(`  UI renders correctly without any real connections.\n`);
});
