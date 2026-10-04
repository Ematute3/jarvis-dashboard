# Server

> The standalone Express backend that powers the JARVIS dashboard's chat,
> calendar, and email flows without depending on the real JARVIS service.
> For the wire contract the front-end expects, see
> [DATA-FLOW](DATA-FLOW.md). For the Tauri desktop wrapper, see
> [NATIVE-INTEGRATION](NATIVE-INTEGRATION.md). For project orientation, see
> the [README](../README.md).

---

## What this is

The dashboard's chat widget, Google Calendar tiles, and Gmail inbox panel
all previously talked to a JARVIS backend you didn't have source for —
the live one at `jarviss-mac-mini.taile919c2.ts.net:8765`. This new
`server.js` is a **self-contained replacement** that you can run on your
laptop. It implements the Google OAuth loopback flow, creates Google
Calendar events with `calendar.events.insert`, searches Gmail
server-side using the `q` parameter (so substring queries actually narrow
the result set), marks Gmail messages read via `gmail.users.messages.batchModify`,
and proxies `/api/chat` to MiniMax with a full tool-calling loop. It also
serves the dashboard's static files, so a single `npm start` gives you
a fully working app — no separate dev server.

Anything the dashboard expects that this server doesn't actually implement
(news aggregation, Canvas LMS integration, real Gmail body storage, price
feeds) gets an honest empty response, so the UI still renders cleanly.

---

## Two ways to use it

You can run `server.js` on its own, or alongside whatever JARVIS-shaped
thing you were already using.

**Standalone.** Start the server, open the page in a browser, complete the
Google OAuth flow once, and use everything.

```bash
node server.js
# → http://localhost:8765/
```

**Alongside an existing JARVIS server.** If the real backend still owns
the non-chat endpoints (Canvas, news, holdings, etc.), point
`chat-backend.js` at this new server just for chat, calendar, and Gmail.
Run `server.js` on a different port and keep your existing server where it
is.

```bash
PORT=8765 node server.js
# then, in chat-backend.js's environment:
JARVIS_API_BASE=http://localhost:8765
JARVIS_CALENDAR_NEW_URL=/api/calendar/events/new
JARVIS_GMAIL_MARK_READ_URL=/api/gmail/mark-read
```

`chat-backend.js` then routes only the chat tool calls here; everything
else keeps hitting the original backend.

---

## Setup steps

All commands run from the repo root (`jarvis-dashboard/`).

```bash
cd jarvis-dashboard
npm install                  # installs express, googleapis, cookie-parser, dotenv
cp .env.example .env
```

Open `.env` and fill in the three required values:

```env
MINIMAX_API_KEY=sk-...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Then in the Google Cloud Console:

1. Create (or open) an OAuth client of type **Web application**.
2. Add this **exact** URI under *Authorized redirect URIs*:
   `http://127.0.0.1:8765/oauth/callback`
   (If you change `PORT` in `.env`, change the redirect URI to match —
   Google rejects mismatches.)
3. Enable the **Calendar API** and **Gmail API** for the project.
4. Add both OAuth scopes:
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/gmail.modify`

Then start the server:

```bash
node server.js
```

Open `http://localhost:8765/`, click **Connect Google**, complete the
browser flow, and you're done. After the first login, `tokens.json` is
written to disk and the dashboard reconnects automatically.

---

## Endpoint inventory

Every route `server.js` exposes. The "called by" column names the
caller — either a dashboard JS module or the server itself (during the
chat tool loop).

### Static

| Method | Path | Purpose | Called by |
| ------ | ---- | ------- | --------- |
| GET | `/` | Serves `index.html`. | Browser |
| GET | `/index.html` | Same as `/`. | Browser |
| GET | `/mobile.html` | Serves `mobile.html`, or a redirect stub if missing. | Browser |
| GET | `/manifest.json` | PWA manifest. | Browser |
| GET | `/apple-touch-icon.png` | iOS home-screen icon. | Browser |
| GET | `/*` (fallback) | `express.static` serves every `.js`, `.css`, image, etc. from the repo root. | Browser |

### Google OAuth

| Method | Path | Purpose | Called by |
| ------ | ---- | ------- | -------- |
| GET | `/oauth/start` | Generates the Google consent URL with `access_type=offline` and a CSRF `state` cookie, then 302s to Google. | Browser (Connect Google button) |
| GET | `/oauth/callback` | Verifies the `state` cookie, exchanges the `code` for tokens, writes `tokens.json`, and redirects to `/`. | Google |
| GET | `/oauth/status` | Returns `{ connected: boolean, scopes: string[] }`. | Browser (status indicator) |

### Chat

| Method | Path | Purpose | Called by |
| ------ | ---- | ------- | -------- |
| POST | `/api/chat` | Runs the MiniMax tool-calling loop. See **Chat loop** below. | Browser (chat widget) |

### Goals

Goals persist to `data/goals.json` (atomic write — `.tmp` then rename).

| Method | Path | Purpose | Called by |
| ------ | ---- | ------- | -------- |
| GET | `/api/goals` | Returns the full list. | Browser (`goals.js`) |
| POST | `/api/goals` | Adds a goal. Body: `{ name }`. | Browser (add form) |
| POST | `/api/goals/:id` | Updates progress (clamped `0..100`). Body: `{ progress }`. | Browser (± buttons) |
| DELETE | `/api/goals/:id` | Removes a goal. | Browser (× button) |

### Calendar

| Method | Path | Purpose | Called by |
| ------ | ---- | ------- | -------- |
| GET | `/api/calendar/events` | Lists upcoming events from `primary`, returns them shaped to `{ id, title, date, start, durationMin, location, isClass }`. `isClass` is always `false`. | Browser (`academics.js`) and the chat tool loop (`list_events`) |
| POST | `/api/calendar/events/new` | Inserts an event via `calendar.events.insert`. Accepts two body shapes — see below. Returns `{ ok, eventId, htmlLink }`. | Chat tool loop (`add_event`) |

### Gmail

| Method | Path | Purpose | Called by |
| ------ | ---- | ------- | -------- |
| GET | `/api/gmail/messages` | Honors `?q=...` server-side via `gmail.users.messages.list`. Accepts `?limit=` or `?maxResults=` (clamped `1..100`). Returns `{ messages: [{ id, from, subject, unread, snippet }] }`. | Browser (`extras.js`) and the chat tool loop (`search_emails`) |
| POST | `/api/gmail/mark-read` | Body: `{ messageIds: string[] }`. Calls `gmail.users.messages.batchModify` with `removeLabelIds: ['UNREAD']`. | Chat tool loop (`mark_email_read`) |

### Stubs (honest empty states)

These exist so the dashboard renders cleanly without a real backend
behind every panel.

| Method | Path | Returns | Called by |
| ------ | ---- | ------- | -------- |
| GET | `/api/schedule` | `[]` | `academics.js` |
| GET | `/api/courses/all` | `[]` | `academics.js`, chat tool loop |
| GET | `/api/plan` | `{ error: "No classes to plan from yet." }` | `plan-home.js` |
| GET | `/api/news` | `{}` | `news.js` |
| GET | `/api/holdings` | `[]` | `portfolio-shared.js` |
| GET | `/api/prices` | `{ quotes: [], fetched_at: null }` | `portfolio-shared.js` |
| GET | `/api/portfolio/history` | `[]` | `app.js` |
| GET | `/api/canvas/courses/:id/assignments` | `[]` | `academics.js`, chat tool loop |

---

## Chat loop

`POST /api/chat` accepts `{ messages: [...] }` from the browser and runs
an agent loop against MiniMax. Here's what happens on each request:

1. The server prepends its `SYSTEM_PROMPT` (describing the JARVIS
   persona and the available tools) to the client's messages.
2. It calls `POST ${MINIMAX_BASE_URL}/chat/completions` with the full
   message array and `TOOL_DEFINITIONS` (six tools, OpenAI-compatible
   JSON Schema).
3. MiniMax responds. If the response includes `tool_calls`, the server
   executes **each one in turn**, then pushes the results back into the
   message array as `role: 'tool'` turns.
4. It calls MiniMax again with the expanded messages.
5. Repeat until MiniMax replies with no `tool_calls` — that's the final
   answer, which the server returns as `{ ok: true, reply, tool_calls }`.
6. To prevent a runaway loop, the iteration count is capped at
   `TOOL_MAX_ITERATIONS` (default `10`). If the cap is hit, the server
   returns a friendly "I got stuck in a loop" message plus the
   accumulated `tool_calls` log so you can see what it tried.

The six tools the chat loop can call:

| Tool | What the server does |
| ---- | -------------------- |
| `add_event` | `POST` to its own `/api/calendar/events/new` (i.e. `calendar.events.insert`). |
| `list_courses` | `GET` its own `/api/courses/all` (currently always `[]`). |
| `list_assignments` | `GET` its own `/api/canvas/courses/:id/assignments`, or aggregates across every Canvas course when called with no `course_id`. |
| `list_events` | `GET` its own `/api/calendar/events`. |
| `search_emails` | `GET` its own `/api/gmail/messages?q=...&maxResults=...` — the `q` parameter is honored server-side by `gmail.users.messages.list`. |
| `mark_email_read` | `POST` to its own `/api/gmail/mark-read`. |

Note that the chat loop calls these tools by hitting **its own server**
(`http://127.0.0.1:${PORT}/api/...`). That means the same Calendar and
Gmail code paths serve both the dashboard's REST calls and the chat
agent — there's no parallel implementation to drift.

---

## Token storage

Google OAuth tokens (access token, refresh token, expiry, scopes) are
written to `tokens.json` — the path is `TOKEN_STORE_PATH` in `.env`,
defaulting to `./tokens.json` (i.e. the repo root). The file is
**plaintext JSON**.

**Security caveats.** Anyone who can read `tokens.json` has full access
to your Google Calendar and Gmail within the granted scopes. The file
must not be committed — the repo's `.gitignore` should already exclude
it, but verify before you `git add` anything new. Restrict the
permissions:

```bash
chmod 600 tokens.json
```

`googleapis` will automatically refresh the access token using the
refresh token whenever the expiry approaches, so you shouldn't need to
re-run the OAuth flow after the first login unless you revoke access or
delete the file.

---

## What this doesn't do

The server is intentionally a partial implementation. These are the
**honest gaps** — every one of them returns an empty state so the UI
renders, but no real data:

- **News aggregation** — `GET /api/news` returns `{}`. No headlines, no
  ticker weights. The HUD ticker and home-grid widget both show their
  "news unavailable" copy.
- **Real Canvas integration** — `/api/courses/all` and
  `/api/canvas/courses/:id/assignments` return `[]`. Course tiles, the
  progress rings, and the next-due widget all show empty-state messages.
- **Real Gmail message body** — `/api/gmail/messages` returns only
  metadata (`from`, `subject`, `unread`, `snippet`). The wire contract
  for Gmail doesn't ship a `body` field, so `chat-backend.js`'s
  `search_emails` tool can match against `from` / `subject` / `body`,
  but `body` will always be empty until the contract grows.
- **Portfolio / prices / history** — all three endpoints return empty
  shapes. The portfolio tiles show `$--.--`.
- **Schedule / plan data** — `/api/schedule` and `/api/plan` are stubs.

If you want the dashboard to do real work in any of those areas, this
server is the integration point — wire them into the matching route and
the UI will pick them up unchanged.

---

## Caveats

A handful of things to know before you ship (or hand this off):

- **The dashboard still loads from the live URL by default.** This
  server serves its own `index.html` when you open
  `http://localhost:8765/`, but the live dashboard (and the Tauri
  desktop app) points at `jarviss-mac-mini.taile919c2.ts.net:8765`.
  If you deploy this `server.js` somewhere else, point both the live
  URL and the Tauri `tauri.conf.json` at it.
- **First OAuth flow is manual.** Until you've completed the consent
  screen in a real browser, `GET /oauth/status` returns
  `{ connected: false }` and every Calendar/Gmail endpoint returns an
  `"not connected"` error message. After that, tokens refresh
  automatically.
- **Tauri OAuth needs an extra redirect URI.** If you package the
  dashboard as a Tauri `.app` (see [NATIVE-INTEGRATION](NATIVE-INTEGRATION.md))
  and want OAuth to work inside the packaged app, add
  `http://tauri.localhost/oauth/callback` as an authorized redirect
  URI in Google Cloud Console — that's how Tauri hands the callback
  back to the WebView. The default `127.0.0.1:8765` redirect URI is
  for browser-based dev only.
- **Production should still implement the real endpoints.** When the
  real JARVIS backend lands, it should expose its own calendar-create
  and Gmail-mark-read endpoints. Until it does, point `chat-backend.js`
  at this server (via `JARVIS_CALENDAR_NEW_URL` and
  `JARVIS_GMAIL_MARK_READ_URL`). The day the production backend ships
  those, `chat-backend.js` can drop its `JARVIS_API_BASE` dependency on
  this file entirely.
- **Gmail `q` is honored here, but verify the real backend.** This
  server uses `q` server-side via `gmail.users.messages.list`, which
  is what most users expect from a "search" tool. The real JARVIS
  backend should do the same — don't fall back to substring-matching
  `from` / `subject` client-side when you have the real Gmail API
  available.