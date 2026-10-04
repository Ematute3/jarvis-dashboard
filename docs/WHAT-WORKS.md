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

---

## Linked pages

> A page-by-page check of every linked view reachable from the top-bar
> chips in `index.html` (`index.html:44-57`) and from the in-widget "see
> all" links (`index.html:87-89,260`). Same verification method as the
> widget section - `curl` the page, then `curl` every API endpoint the
> page references, then read the renderer.
>
> **Note:** since the widget section above was written, `/oauth/status`
> now returns `{"connected":true,"scopes":["...calendar.events",
> "...gmail.modify"]}`, so Gmail is live on the local server and
> `email.html` is populated (this contradicts the "intentionally empty"
> note in widget #8 - the page-level row below describes the current
> state).

| Page | Chip / source | Endpoint(s) | Status |
| --- | --- | --- | --- |
| `classes.html` | `SCHOOL` chip | `GET /api/courses/all` + `/api/canvas/courses/:id/assignments` + `/api/canvas/courses/:id/syllabus` + `/api/settings/status` | populated (9 courses with tabs + grade calculator) |
| `plan.html` | `BY CLASS` chip | `GET /api/plan` | populated (9 courses, 164 items, with filter pills) |
| `assignments.html` | `ASSIGNMENTS` chip | `GET /api/courses/all` + `/api/canvas/courses/:id/assignments` | populated (9 courses, 55 assignments) |
| `calendar.html` | `CALENDAR` chip | `GET /api/calendar/events` | populated (318 events) |
| `email.html` | `INBOX` chip | `GET /api/gmail/messages?limit=20` | populated (20 messages - Gmail connected) |
| `portfolio.html` | `MONEY` chip | `GET /api/holdings` + `/api/prices` + `/api/portfolio/history` | populated (12 holdings, 9 quotes, 11-day history) |
| `syllabus.html` | `LIBRARY` chip | `GET /api/courses/all` + `/api/canvas/courses/:id/syllabus` | populated (9 courses with full syllabus body in viewer) |
| `statements.html` | `STATEMENTS` chip | `GET /api/statements` | **stub** - endpoint returns 404 |
| `settings.html` | `SETTINGS` chip | `GET/PUT /api/config` | populated (6 credential sections live) |
| `mobile.html` | `PHONE VIEW` chip | (same set as `index.html`) | populated (phone layout of the home grid) |
| `index.html` | home dashboard | (see widget section above) | populated (see widget section) |

`curl` summary (each returned HTTP 200 unless marked otherwise):

```
classes.html        -> 200  3064 bytes   /api/courses/all           -> 200 38405 b  (9 courses)
                                          /api/canvas/courses/234111/assignments -> 200 (17 items)
                                          /api/canvas/courses/234111/syllabus   -> 200 6475 b (full body)
                                          /api/settings/status       -> 200 254 b   (all integrations "connected")
plan.html           -> 200  1499 bytes   /api/plan                  -> 200 38803 b  (9 courses, 164 items)
assignments.html    -> 200  7536 bytes   /api/courses/all           -> 200 38405 b  (9 courses)
                                          /api/canvas/courses/234111/assignments -> 200 (17 items)
calendar.html       -> 200  6779 bytes   /api/calendar/events       -> 200 127945 b (318 events)
email.html          -> 200  5720 bytes   /api/gmail/messages?limit=20 -> 200 7644 b   (20 messages)
portfolio.html      -> 200 12534 bytes   /api/holdings              -> 200 950 b    (12 holdings)
                                          /api/prices               -> 200 1313 b   (9 quotes)
                                          /api/portfolio/history    -> 200 (11 points)
syllabus.html       -> 200  3132 bytes   /api/courses/all           -> 200 38405 b  (9 courses)
                                          /api/canvas/courses/234111/syllabus   -> 200 6475 b (per-course body)
statements.html     -> 200  7480 bytes   /api/statements            -> **404** (no handler)
settings.html       -> 200 12084 bytes   /api/config                -> 200 636 b
mobile.html         -> 200 16350 bytes   (reuses all index.html scripts)
index.html          -> 200 15650 bytes   (see widget section)
```

### Page-by-page findings

### 1. `classes.html` (SCHOOL chip) - populated

**Endpoints:** `GET /api/courses/all` (9 courses), `/api/settings/status`
(connection check), and `/api/canvas/courses/:id/assignments` +
`/api/canvas/courses/:id/syllabus` per course (via `classes.js:24-65`).

**Returns:** 9 courses with `{id, code, name, instructor, term,
credits, color, currentScorePct, links, source, syllabus}`; 55
assignments and 9 parsed syllabi on the `/api/canvas/*` paths (the
same syllabus body is also fetched by `syllabus.html`). The
`/api/settings/status` payload reports which integrations are
connected (canvas token, canvas domain, google, stock API - all
`"connected"` on this server).

**What the page shows:** a tabbed two-pane layout with a header
"CLASSES" + "CANVAS" status pill (`classes.html:42-57`), a view
switch row (COURSES / GRADE CALCULATOR tabs, `classes.html:60-63`),
a left tabs rail of courses (`#cls-tabs`, `classes.html:67-69`), and
a right panel area (`#cls-main`) that holds one `<section
class="cls-panel">` per course populated by `classes.js`. Each
course panel renders the assignment list and the parsed syllabus
(when, where, grading, key dates) inside the same card. The Grade
Calculator tab is a `#cls-calc-view` placeholder
(`classes.html:75-76`) populated by `classes.js`. Subtitle
`#cls-subtitle` shows live counts, status `#cls-status` reports
the connection state.

**Fix if empty:** n/a.

---

### 2. `plan.html` (BY CLASS chip) - populated

**Endpoint:** `GET /api/plan`

**Returns:** `{today, courses:[{id, name, fullName, color, score,
nextClass, meets, items:[...]}]}` with 9 courses and 164 dated items
(BCH:23, BIO CLASS:51, BIO Dis:7, BIO LAB:26, Crime & Punishment:7,
CHEM:20, CHEM LAB:24, WRIT 9:6, WRIT LAB:0) - same payload consumed by
widget #6, but consumed client-side by the new `plan.js:279`.

**What the page shows:** a minimal shell (`plan.html`) with a header
"BY CLASS" / subtitle "What you need to do next in every course" /
status pill "CANVAS + SYLLABI", a course-filter pills nav
(`#pl-pills`, populated by `plan.js`), and a `#pl-grid` main area.
`plan.js` builds one card per course (Canvas assignments + module
pages + syllabus dates, per the file header at `plan.js:1`). The
filter pills let the user narrow by course. `#pl-status` reports
connection state. Page assets: `plan.css` + `plan.js`.

**Fix if empty:** n/a.

---

### 3. `assignments.html` (ASSIGNMENTS chip) - populated

**Endpoints:** `GET /api/courses/all` (9 courses) then
`GET /api/canvas/courses/:id/assignments` per course - identical to
widget #3.

**Returns:** 55 assignments across 9 courses (BCH:17, BIOL 5A Lecture:29,
BIOL 5A Dis:0, BIOL 5LA:5, HNPG 018:0, CHEM 001A:0, CHEM 01LA:4, WRIT
009:0, WRIT 009L:0) with `{title, course, dueDate, status}` per item.

**What the page shows:** a single panel "UPCOMING - CANVAS" with one
row per assignment sorted soonest-first (`assignments.html:104-107,
149-153`). Each row is `as-row` with title + short course code on the
left and a "Mon DD - weekday/today/tomorrow/overdue" stamp on the right
(orange/urgent if due within 48 h). Graded rows dim to 0.55 opacity via
`[data-status="graded"]`. `#asCount` reports "N ITEMS".

**Fix if empty:** n/a.

---

### 4. `calendar.html` (CALENDAR chip) - populated

**Endpoint:** `GET /api/calendar/events`

**Returns:** 318 events with `{id, title, date, start, durationMin,
location, isClass}` - same payload as widget #7.

**What the page shows:** a single panel "UPCOMING - GOOGLE CALENDAR"
rendering one row per event (`calendar.html:111-114`). Each row is a
2-column grid: day label + time range on the left, title (and location
if present) on the right. The renderer does not drop `isClass` entries
the way `academics.js:281` does - so class blocks from the schedule
**also** appear here as duplicated rows. `#calCount` reports "N
EVENTS"; `#calStatus` reflects connection state.

**Fix if empty:** n/a.

---

### 5. `email.html` (INBOX chip) - populated

**Endpoint:** `GET /api/gmail/messages?limit=20`

**Returns:** 20 real Gmail messages with `{id, from, subject, unread,
snippet}`. First three on this verification: from "Google
<no-reply@accounts.google.com>" / subject "Security alert"; from
"Instructure Canvas <notifications@instructure.com>" / subject "Access
Token Created or Regenerated"; from "Jacob Kantor <jkant006@ucr.edu>"
/ subject meeting invitation for Fri Oct 23 2026.

**Why it works:** the local handler at `server.js:656-697` now finds a
valid Google token, so Gmail is live on this server. The widget
section above describes the prior "not connected" state; this row
documents the current state. (`/oauth/status` confirms
`connected: true`.)

**What the page shows:** a single panel "RECENT - GMAIL" rendering one
row per message (`email.html:103-106`). Each row is a 2-column grid:
a status dot (cyan-glowing if unread, faint grey otherwise) on the
left, sender + subject on the right. Unread rows get `.is-unread`
which bumps the font weight and lights up the dot. `#emlCount`
reports "N MESSAGES".

**Fix if empty:** run `GET /oauth/start` in the browser; this page is
populated today.

---

### 6. `portfolio.html` (MONEY chip) - populated

**Endpoints:** `GET /api/holdings` (12 rows) + `GET /api/prices`
(9 quotes) + `GET /api/portfolio/history` (11 daily points) - all three
parallel-fetched in `Promise.all` (`portfolio.html:303-306`).

**Returns:** holdings `[ticker, shares, cost, account]`; quotes
`{ticker, price, change, chg_pct, high, low, open, prev_close}`;
history `[{date, value}]` from 2026-09-23 through 2026-10-03 (ranging
~5791 to ~5868 USD).

**What the page shows:** three summary tiles (`portfolio.html:115-131`)
- TOTAL VALUE (market value of every holding), DAY CHANGE (signed
dollar + percent since open), ALL-TIME G/L (signed dollar + percent
vs cost basis). A 1000x80 SVG sparkline fills with a cyan-gradient
area under the line (`portfolio.html:138-148,267-294`). Below, a
HOLDINGS table lists one row per position: ticker / shares /
market value / percent change (cyan if up, orange if down). The page
has its own renderer (`portfolio.html:162-336`); it does not import
`portfolio-shared.js`. `#portStatus` reports "CONNECTED" / "NO DATA".

**Fix if empty:** n/a.

---

### 7. `syllabus.html` (LIBRARY chip) - populated (full viewer)

**Endpoints:** `GET /api/courses/all` (course list) +
`GET /api/canvas/courses/:id/syllabus` (per-course syllabus body) +
`/api/settings/status` (connection probe), via `syllabus.js:23-99`.

**Returns:** 9 courses from `/api/courses/all` plus per-course
`{courseId, paragraphs:[...]}` payloads (e.g. for course 234111 the
body is 6475 bytes containing the full BCH 095 syllabus text - "BCH
095 TOPICS IN BIOCHEMISTRY FOR CAREER PLANNING", meeting time
"Wednesdays 4:00-4:50 PM", etc.).

**What the page shows:** a two-column shell with a course list on
the left (`#courseList`, role-based `sidebar-listbox`/`sidebar-list`,
`syllabus.html:48-56`) and a syllabus viewer panel on the right
(`#sylBody`, `syllabus.html:58-75`). Clicking a course populates the
viewer header (`#sylCode`, `#sylTitle`, `#sylInstructor`,
`#sylTerm`, `#sylCredits`) and renders the syllabus paragraphs
inside `#sylBody`. The header chip `#sylStatus` reports
"CONNECTED" / "NO DATA" / "OFFLINE"; `#courseCount` reports "N
TOTAL". Below 900 px width the two columns collapse to one
(`syllabus.html:33-35`). Page assets: `syllabus.css` +
`syllabus.js`.

**Fix if empty:** n/a.

---

### 8. `statements.html` (STATEMENTS chip) - stub

**Endpoint:** `GET /api/statements` -> **HTTP 404**.

**Why:** the page declares the fetch (`statements.html:201`) but no
handler exists for `/api/statements` on this server. There is no
statements router in `server.js`, no proxy allow-list match, and the
wildcard middleware at `server.js:342` does not cover it either (it
falls through to a 404). The page is wired up correctly - it just has
no upstream.

**What the page shows:** a single panel "RECENT - CSV INGEST" with
three summary tiles (DEBIT / CREDIT / NET, hidden until rows are
loaded) and a list area. With no data the list shows "No statements
yet." and the summary stays hidden (`statements.html:111-127,
154-161`). `#stmStatus` reads "OFFLINE" because the fetch throws on the
404.

**Fix if empty:** add a `/api/statements` route that reads a CSV from
`data/statements.csv` (the page expects `{date, description, category,
amount}` rows, see `statements.html:163-180`), or proxy the path
through the legacy if it exists there. Today the page is a UI shell
with no backend.

---

### 9. `settings.html` (SETTINGS chip) - populated

**Endpoint:** `GET /api/config` (initial load) + `PUT /api/config`
(saves). All traffic stays local - the wildcard middleware at
  `server.js:342` is bypassed.

**Returns (initial):** `{minimaxApiKey:"sk-c...B0ps",
minimaxApiKeySet:true, minimaxBaseUrl, minimaxModel,
googleClientId, googleClientIdSet, googleClientSecret, googleClientSecretSet,
googleRedirectUri, canvasApiKeySet, canvasBaseUrl,
jarvisApiBase:"http://jarviss-mac-mini.taile919c2.ts.net:8765",
jarvisApiBaseSet, jarvisApiKeySet, toolMaxIterations,
systemPrompt}` (636 bytes; preview truncated).

**What the page shows:** six panels (`settings.html:31-303`):
1. **MINIMAX** - paste API key (masked preview shows last 4 chars).
2. **CANVAS** - paste access token + base URL.
3. **LEGACY JARVIS** - paste base URL + optional bearer token.
4. **GOOGLE** - paste OAuth client ID + secret (redirect URI displayed
   readonly).
5. **TOOL BEHAVIOR** - slider for `toolMaxIterations` (1-50).
7. **SYSTEM PROMPT** - free-text editor for the JARVIS chat system
   prompt.

Each panel has its own `.status` pill (`unknown` / `ok` / `error`)
updated after every save. Saves are optimistic (the panel
immediately shows "saved" then re-reads `/api/config` to confirm).
This page is the only linked view whose traffic does **not** touch the
legacy proxy.

**Fix if empty:** n/a.

---

### 10. `mobile.html` (PHONE VIEW chip) - populated

**Endpoints:** same set as `index.html` - it loads `view.js`,
`portfolio-shared.js`, `app.js`, `academics.js`, `extras.js`,
`news.js`, `goals.js`, `plan-home.js`, plus `native-launcher.js` and
`chatbot.js` (`mobile.html:370-410`). Every widget therefore inherits
the population status from the widget table at the top of this doc.

**What it shows:** a single-column 420 px-wide layout
(`mobile.html:33-40`) with:
- Stacked hero (greeting + clock + day-progress bar).
- Three next-up tiles (NEXT CLASS / NEXT DUE / NEXT EVENT) that
  deep-link back to `classes.html` / `assignments.html` /
  `calendar.html`.
- Today's classes list (`#scheduleStream`).
- Assignment list (`.assign-list`).
- INBOX preview (`#inboxList`).
- Portfolio card (value, day change, sparkline, totals).
- Goals card with inline add input (`#goalForm`).
- QUICK LAUNCH grid of six native buttons (Calendar / Mail /
  Reminders / Finder / VS Code / JARVIS repo in browser) that fire
  through Tauri when the dashboard is running as a desktop shell.
- A top-bar DESKTOP VIEW link that swaps back to `index.html`
  via `JarvisView.switchTo('desktop')` (`mobile.html:201,399-406`).
- The same chat panel as the desktop dashboard, plus an assignments
  notification panel toggled by the bell.

This is **not** a new data source - it is a re-layout of the home
grid for narrow viewports. The Tauri native buttons require the
desktop shell; in a plain browser they no-op gracefully
(`native-launcher.js` checks for the runtime).

**Fix if empty:** see the corresponding widget in the table above.

---

### 11. `index.html` (home dashboard) - populated

Covered in full by the widget-by-widget section at the top of this
doc. The home dashboard is also the page that owns the
`<a class="chip">` links (`index.html:44-57`) which are what the rest
of this section was reached through.

**Fix if empty:** see the widget table above.

---

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