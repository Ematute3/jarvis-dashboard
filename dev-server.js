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
