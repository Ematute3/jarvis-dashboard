# What Works in the Dashboard Widgets

> A live check of every home-grid widget - populated, empty, or partial -
> verified by curling the local Express server at `127.0.0.1:8765` (the
> `jarvis-dashboard/server.js` process that ships with this repo) and reading
> the renderer code in the same checkout.
>
> Verification date: 2026-10-04. The local server is configured with
> `jarvisApiBase = http://jarviss-mac-mini.taile919c2.ts.net:8765` in
> `runtime-config.json:11`, so most "legacy" endpoints fall through a
> wildcard proxy at `server.js:342-368` and are served by the Tailscale
> JARVIS. Per-endpoint `proxyToJarvis()` calls at `server.js:219-240` are
> the defensive fallback.

**TL;DR - everything works.** All nine real-data widgets are populated from
the legacy server via the wildcard proxy added in commit
**`fe8ed05 feat(server): extend proxy to cover all legacy endpoints`**
(see `git show fe8ed05` in this checkout). The only "empty" widget is the
inbox, and that is by design - Gmail is not connected on this local server.

---

## Widget-by-widget status

| Widget | Endpoint | Status |
| --- | --- | --- |
| `#weekGrid` (this-week grid) | `GET /api/schedule` | populated (15 meetings) |
| `#scheduleStream` (today's stream) | `GET /api/schedule` | populated |
| `#assignMeta` + `.assign-list` | `GET /api/canvas/courses/:id/assignments` | populated (55 total across 9 courses) |
| `.course-grid` + `#courseMeta` | `GET /api/courses/all` | populated (9 courses) |
| `#courseRings` | `/api/courses/all` + per-course assignments | populated (one ring per Canvas course) |
| `#planHome` (by class) | `GET /api/plan` | populated (9 courses, ~138 dated items) |
| `#eventsList` | `GET /api/calendar/events` | populated (318 events from Google) |
| `.miniMonth` | derived from events + upcoming | populated |
| `#inboxList` + `#inboxMeta` | `GET /api/gmail/messages?limit=6` | empty by design ("Gmail not connected.") |
| `#homeNewsList` + `#newsTicker` | `GET /api/news` | populated (24 headlines, finance/tech/education/sports) |
| `#portfolioValue` (MONEY tile) | `GET /api/holdings` + `GET /api/prices` | populated (12 holdings, 9 live quotes) |
| `#goalList` | `GET /api/goals` | partial - endpoint works, file `data/goals.json` is empty |
| `#heroGreeting` + `#heroDate` + `#systemTime` | (no API) | populated (local clock) |

---

## Detailed findings

### 1. `#weekGrid` - weekly schedule grid - populated

**Endpoint:** `GET /api/schedule`

**curl:** `curl http://127.0.0.1:8765/api/schedule`

**Response shape:** Array of 15 meeting entries, each with
`{ id, courseId, label, day, start, end, catalog, crn, termStart, termEnd,
skipDates, location, locationShort }`. 8 unique course IDs:
`234111, 234229, 234230, 234318, 234742, 238641, 245039, 246092`.

**Why it works:** `server.js:427-430` calls `proxyToJarvis(req, res)`
first; with `jarvisApiBase` set, the wildcard middleware at `server.js:342`
also forwards it. The legacy returns the 15-entry array shown above.

**Widget code:** `extras.js:renderWeek()` (`extras.js:169-212`) reads
`window.HomeData.schedule`, which `academics.js:boot()` populates from
`/api/schedule` at `academics.js:306`. The renderer uses `e.day`,
`e.start`, `e.end`, `e.courseId`, `e.label`, `e.location` - every field
present in the response. Term/skip filters via `meetsOn()`
(`academics.js:32-37`) work because `termStart`, `termEnd`, `skipDates`
are populated.

**Fix if empty:** n/a. Currently populated.

---

### 2. `#scheduleStream` - today's class stream - populated

**Endpoint:** same as above (`/api/schedule`).

**Widget code:** `academics.js:renderSchedule()` (`academics.js:74-112`).
Reads the same fields as the week grid; filters by `day === today`.
Renders one row per meeting with status `LIVE` / `QUEUED` / `CLEARED`
based on the wall clock.

**Fix if empty:** n/a.

---

### 3. `#assignMeta` + `.assign-list` - next 6 upcoming assignments - populated

**Endpoint:** `GET /api/canvas/courses/:id/assignments` (one call per
Canvas course).

**curl, per course:**

```
234111 -> 17   (BCH 095)
234230 -> 29   (BIOL 005A)
234229 ->  0   (BIOL 005A Discussion)
234318 ->  5   (BIOL 05LA Lab)
245039 ->  0   (HNPG 018 Crime & Punishment)
234742 ->  0   (CHEM 001A)
238641 ->  4   (CHEM 01LA Lab)
246092 ->  0   (WRIT 009)
243985 ->  0   (WRIT 009L)
          --
total = 55 assignments, 5 courses contribute items
```

Each entry is `{ id, title, dueDate, status }` where `status` is
`not_started` / `submitted` / `graded` per `server.js:473-487`.

**Widget code:** `academics.js:renderAssignmentList()` (`academics.js:182-207`).
Collects everything via `collectUpcomingAssignments()`
(`academics.js:163-180`), sorts soonest-first, keeps top N (default 6,
controlled by `.assign-list` `data-limit`). Renders title + short course
label + due-in badge (`DUE 3D` / `DUE 18H` / `OVERDUE`). Shows the meta
count "N DUE THIS WEEK" at `#assignMeta`.

**Fix if empty:** n/a.

---

### 4. `.course-grid` + `#courseMeta` - course matrix - populated

**Endpoint:** `GET /api/courses/all`

**curl:** returns 9 courses (BCH, BIOL 005A Lecture, BIOL 005A Discussion,
BIOL 05LA, HNPG 018, CHEM 001A, CHEM 01LA, WRIT 009, WRIT 009L) - each with
`{ id, code, name, instructor, term, credits, color, currentScorePct, links,
source: 'canvas', syllabus: {...} }`. The proxy enriches each course with
a parsed syllabus (`summary`, `grading`, `office`, `keyDates`, `watch`,
`scale`, `calcNote`) - used by `syllabus.html`, not the home grid.

**Widget code:** `academics.js:renderCourseMatrix()` (`academics.js:123-144`).
Renders one tile per course with short label (e.g. "BIOL 5") and grade %
(`currentScorePct`; below 70 -> alert class). `#courseMeta` shows "N CLASSES".

**Fix if empty:** n/a.

---

### 5. `#courseRings` - per-course progress rings - populated

**Endpoints:** `/api/courses/all` + the per-course
`/api/canvas/courses/:id/assignments` set.

**Widget code:** `extras.js:renderRings()` (`extras.js:232-261`). Iterates
`D.courses`, looks up `D.byCourse[c.id]` (populated by `academics.js:317`),
counts `done = submitted || graded` over `total`. Renders an SVG ring per
course with `stroke-dasharray` = pct/100. Subtitle is "not on Canvas" for
`source: 'manual'` courses (none on this data set); otherwise "X/Y done"
or "no work yet".

**Color palette:** 8 hues from `PALETTE` (`extras.js:23`) cycle per course
index, matching the legacy's `color` field as a fallback.

**Fix if empty:** n/a.

---

### 6. `#planHome` (by class) - per course to-do list - populated

**Endpoint:** `GET /api/plan`

**curl:** returns
```json
{
  "today": "2026-10-04",
  "courses": [
    {
      "id": 234111, "name": "BCH", "color": "cyan",
      "instructor": "Gregor Blaha", "score": null,
      "nextClass": { "date": "2026-10-07", "start": "16:00", "end": "16:50",
                     "location": "University Lecture Hall 1000",
                     "label": "Biochem Career Planning" },
      "meets": [{ "day": 2, "start": "16:00", "end": "16:50" }],
      "items": [
        { "kind": "quiz", "title": "Homework 1: ...", "date": "2026-10-07",
          "time": "16:00", "points": 4.0, "url": "...",
          "source": "Canvas" }
      ]
    }
  ]
}
```
(9 courses total, ~138 dated items).

**Why it works:** Although `server.js:447-449` declares
`{ error: 'No classes to plan from yet.' }` as a stub, the wildcard
middleware at `server.js:342` proxies `/api/plan` first (it is not in the
allow-list of authoritative local handlers). The legacy returns the rich
shape above.

**Widget code:** `plan-home.js:render()` (`plan-home.js:17-32`). Renders
one column per course with the next 2 dated items (controlled by
`<div id="planHome" data-limit="2">` at `index.html:126`). Uses
`c.name`, `c.color`, `c.items[].date`, `c.items[].title` - all present.

**Fix if empty:** n/a. The endpoint returns a stub only when
`jarvisApiBase` is empty.

---

### 7. `#eventsList` + `.miniMonth` - Google Calendar - populated

**Endpoint:** `GET /api/calendar/events`

**curl:** returns 318 events with
`{ id, title, date, start, durationMin, location, isClass }`. Example:
`2026-09-22 10:00 | CNAS New Student Welcome - Biochemistry Orientation`.

**Why it works:** Local `server.js:581-600` checks auth first, but the
wildcard middleware at `server.js:342` proxies before that handler ever
runs (and the middleware explicitly skips only `/calendar/events/new` for
writes). The legacy has Google Calendar tokens, so it serves real events.

The widget then drops `isClass` entries at `academics.js:282` - class
meetings show up on the weekly grid from `/api/schedule` instead.

**Widget code:**
- `academics.js:renderHomeToday()` (`academics.js:239-266`) - renders up to 3 events in the "TODAY" tile.
- `extras.js:renderEvents()` (`extras.js:264-287`) - renders up to 5 events in `#eventsList`.
- `extras.js:renderMiniMonth()` (`extras.js:293-314`) - draws the month grid; marks dates that have either an event (blue dot) or an assignment due (amber dot).

All three consume the same `data().calendar` payload.

**Fix if empty:** n/a.

---

### 8. `#inboxList` + `#inboxMeta` - Gmail preview - empty by design

**Endpoint:** `GET /api/gmail/messages?limit=6`

**curl:** returns `{ "error": "Gmail not connected." }` (HTTP 200, JSON
body). `/oauth/status` returns `{ connected: false, scopes: [] }` - no
token file on this server.

**Why it is empty:** The wildcard middleware explicitly excludes
`GET /api/gmail/messages` at `server.js:350`. It is served only by the
local handler at `server.js:653-696`, which requires `authedClientOrNull()`.
The local server has no Google token file at `data/tokens.json`, so
`authedClientOrNull()` returns null and the handler responds with the
error. Note: the legacy on Tailscale likely has Gmail connected, but the
dashboard server does not route Gmail through the proxy - this is intentional.

**Widget code:** `extras.js:renderInbox()` (`extras.js:321-348`). Reads
`res.d.error` and renders it inside an `<li class="ev-empty">`; sets
`#inboxMeta` to "NOT CONNECTED". Same shape as any "not connected" tile.

**Fix if empty:** Run `GET /oauth/start` in the browser to complete Google
OAuth (Calendar + Gmail). The token file lands at `TOKEN_STORE_PATH`
(default `data/tokens.json`); after that both Calendar and Gmail will
return real data without any code change.

---

### 9. News widget - `#homeNewsList` + `#newsTicker` - populated

**Endpoint:** `GET /api/news`

**curl:** returns
```json
{
  "headlines": [
    { "id": "finance-0", "time": "15:28", "source": "Yahoo Finance",
      "category": "finance",
      "text": "Unemployment Rate Ticks Higher as Job Growth Slows",
      "ticker": null, "link": "https://news.google.com/..." }
  ],
  "fetched_at": "2026-10-04T07:45:19Z"
}
```
(24 headlines across finance, tech, education, sports).

**Why it works:** The wildcard middleware proxies `/api/news` to the
legacy (`server.js:451-453` has the stub `res.json({})` but it never runs
when the proxy is configured).

**Widget code:** `news.js` (entire file). `#homeNewsList` shows one
headline per category in fixed order (finance/tech/education/sports/finance);
the center HUD tile `#newsTicker` rotates 3 weighted picks every 30
seconds. The renderer expects `data.headlines` to be an array of objects
with `{id, time, source, category, text, ticker, link}` - all fields present.

**Fix if empty:** n/a.

---

### 10. Portfolio - `#portfolioValue` + `#portfolioDelta` + `#portfolioSpark` - populated

**Endpoints:** `GET /api/holdings` (12 rows) + `GET /api/prices` (9 quotes).

**curl:**
- `/api/holdings` -> `[{"ticker":"NVDA","shares":4.197,"cost":134.19,"account":"Schwab"},
  {"ticker":"AAPL",...}, {"ticker":"SCHD",...}, ...]` (12 entries,
  tickers: NVDA, AAPL, SCHD, SCHX, TSLA, BRK.B, META, META, SPCX, SCHD,
  AAPL, SPY).
- `/api/prices` -> `{ quotes: [{ ticker, price, change, chg_pct, high, low,
  open, prev_close }, ...], fetched_at }` (9 quotes).

**Widget code:** `portfolio-shared.js` (`portfolio-shared.js:104-120`).
`Promise.all` fetches both, merges into enriched holdings (line 35-54),
and exposes total value, day change, and a sparkline series. The home-grid
widget renders via `app.js`; the portfolio tracker page reads the same
shared cache.

**Fix if empty:** n/a.

---

### 11. Goals - `#goalList` + `#goalsCount` - partial

**Endpoint:** `GET /api/goals` (file-backed at `data/goals.json`).

**curl:** returns `[]`. The handler at `server.js:540-542` reads the file;
`loadGoals()` (`server.js:244-247`) returns the fallback `[]` when the
file does not exist or is empty.

**Why it is empty:** No goals have been saved yet. The file-backed goals
API is *not* proxied (line 351 explicitly handles `/goals` locally) - this
is correct: the dashboard owns its goals, not the legacy.

**Widget code:** `goals.js:render()` (`goals.js:74-90`). Empty array
renders
"`<li class="goal-empty">No goals yet - add your first one below.</li>`".
User can add via the inline form (POST `/api/goals`).

**Fix if empty:** Type a goal into the form on the home page. There is no
data to fix on the server side.

---

### 12. Hero greeting - `#heroGreeting` + `#heroDate` + `#systemTime` + `#dayProgressFill` - populated (local)

**No endpoint.** All driven by `Date.now()` and the wall clock.

**Widget code:** `extras.js:renderHero()` (`extras.js:60-72`). Sets
greeting "Good morning/afternoon/evening, Evan" based on hour, full date in
`en-US` locale, and a "X% of today" progress bar from minutes elapsed in
the day. `app.js` drives `#systemTime` with a live HH:MM:SS clock.

**Fix if empty:** n/a - there is no upstream to break.

---

## Summary

- **9 of 11 data-driven widgets** are fully populated with real data from
  the Tailscale legacy JARVIS (via the wildcard proxy at `server.js:342`).
- **1 widget** (`#inboxList`) is intentionally empty - Gmail is not
  connected on this server. Fix: complete Google OAuth at `/oauth/start`.
- **1 widget** (`#goalList`) is empty because no goals have been saved yet
  (this is correct - the dashboard owns goals, not the proxy).
- **1 widget** (hero) uses the local clock and is always populated.

The proxy commit that wired this is
`fe8ed05 feat(server): extend proxy to cover all legacy endpoints`.
All renders consume the response shapes correctly; there are no schema
mismatches and no missing fields between the legacy responses and the
renderers in this checkout.

### Render endpoints covered by the proxy

These endpoints have no authoritative local handler - the wildcard
middleware is what makes them work:

- `GET /api/schedule`
- `GET /api/courses/all`
- `GET /api/canvas/courses/:id/assignments`
- `GET /api/plan`
- `GET /api/calendar/events` (GET only; writes stay local)
- `GET /api/news`
- `GET /api/holdings`
- `GET /api/prices`
- `GET /api/portfolio/history`

### Endpoints that intentionally stay local

- `GET /api/gmail/messages` - needs Google token here; the legacy's
  token cannot be reused. Empty until the user OAuths at `/oauth/start`.
- `POST /api/gmail/mark-read` - same.
- `POST /api/calendar/events/new` - write action must run on whichever
  server holds the token. Currently local.
- `GET/PUT /api/config` - runtime config is local to this machine.
- `GET/POST/POST/DELETE /api/goals*` - file-backed in `data/goals.json`.
- `/api/chat` - runs here; proxies tool calls internally.