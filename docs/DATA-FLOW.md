# Data Flow

> Every API call the JARVIS dashboard makes — what it expects back, where
> it's called from, and what the UI shows when the call fails or returns
> empty.

This is the wire contract between the front-end (`*.js` files) and the small
backend at `jarviss-mac-mini.taile919c2.ts.net:8765` on the live server. In
this learning copy, [`dev-server.js`](../dev-server.js) fills that role: it
answers every URL below with an honest empty state so the page renders
end-to-end without any real services connected.

## Academics

These four endpoints are loaded in parallel-ish fashion by
[`academics.js` → `boot()`](../academics.js) on page load.

### `GET /api/schedule`

**Called from:** [`academics.js` → `boot()`](../academics.js) via the shared
[`loadJSON()`](../academics.js) helper. Also read by
[`renderNext()`](../extras.js) and [`renderWeek()`](../extras.js).

**How often:** Once at page load. The "now" line on the weekly grid is
drawn from the system clock, not from a re-fetch.

**Expected response:** an array of weekly meeting entries. `day` is
**Mon=0..Sun=6** (not JS `getDay()` — see [`jsDayToMon0()`](../academics.js)).

```json
[
  {
    "day": 0,
    "start": "09:00",
    "end": "10:30",
    "courseId": "CS-141",
    "label": "Intro to CS",
    "location": "Winston Chung Hall 100",
    "locationShort": "WCH 100",
    "termStart": "2026-01-06",
    "termEnd":   "2026-05-09",
    "skipDates": ["2026-01-20", "2026-03-17"]
  }
]
```

`termStart` / `termEnd` / `skipDates` are optional;
[`meetsOn()`](../academics.js) returns `true` for any date inside that
window not in `skipDates`.

**Empty / error behavior:**
- HTTP non-OK, network error, or `null` body → treated as `[]`.
- Today's stream ([`renderSchedule()`](../academics.js)) shows
  **`"No classes today."`** when today's filter is empty.
- The "next class" tile shows `"No schedule saved"` (no entries at all) or
  `"Nothing scheduled"` (entries exist but none upcoming).
- The weekly grid shows **`"No weekly schedule saved yet."`**

### `GET /api/courses/all`

**Called from:** [`academics.js` → `boot()`](../academics.js). Also read by
the rings widget and the next-due tile.

**How often:** Once at page load.

**Expected response:** every course the dashboard should know about —
both real Canvas courses **and** manual "blank-slate" courses. `source`
tells the UI which is which; only `canvas` rows trigger assignment
fetches.

```json
[
  { "id": "CS-141", "code": "CS 141", "name": "Intro to CS", "source": "canvas", "currentScorePct": 87.5 },
  { "id": "life-1", "code": "LIFE",    "name": "Life admin", "source": "manual", "currentScorePct": null }
]
```

`currentScorePct` is optional; when present and below 70 the course tile
shows an orange alert.

**Empty / error behavior:** non-OK or non-array → `[]`. Course Matrix,
rings widget, and "next due" tile all fall back to
**`"No classes yet — connect Canvas in Settings."`** (or `"Connect Canvas
in Settings"` for the tile subtitle).

### `GET /api/canvas/courses/:id/assignments`

**Called from:** [`academics.js` → `collectUpcomingAssignments()`](../academics.js),
**once per Canvas course** in `Promise.all`. `:id` is `encodeURIComponent`-ed.

**How often:** Once at page load.

**Expected response:** an array of assignments for one course. Only four
fields are read.

```json
[
  { "id": "a-39201", "title": "PSet 3: Recursion", "dueDate": "2026-10-04T23:59:00-07:00", "status": "unsubmitted" },
  { "id": "a-39200", "title": "Lab 2: Linked list", "dueDate": "2026-09-30T23:59:00-07:00", "status": "graded" }
]
```

`status` is one of `submitted | graded | unsubmitted`. The progress rings
count `submitted` **and** `graded` as "done"
([`renderRings()`](../extras.js)). Assignments without a future `dueDate`
are filtered out before rendering.

**Empty / error behavior:** non-OK or non-array → `[]`. The progress ring
shows `0%` / `—` with subtitle `"no work yet"`, the upcoming list shows
**`"No upcoming assignments found."`**, and the notification panel shows
**`"No upcoming assignments."`**

### `GET /api/calendar/events`

**Called from:** [`academics.js` → `loadCalendar()`](../academics.js), which
preserves the server's "how to fix it" message.

**How often:** Once at page load. Other modules re-render on the
`home:calendar` event but the fetch is not repeated.

**Expected response:** either `{ events: [...] }` or `{ error: "..." }`.
Entries with `isClass: true` are filtered out client-side (class meetings
are drawn from the schedule feed instead).

```json
{
  "events": [
    { "id": "ev-7", "title": "Coffee w/ Maya", "date": "2026-10-01", "start": "14:30", "durationMin": 60,   "location": "Soma Coffee", "isClass": false },
    { "id": "ev-8", "title": "All-day reading", "date": "2026-10-02", "start": "00:00", "durationMin": 1440, "location": "",           "isClass": false }
  ]
}
```

If `durationMin >= 1440` (or `allDay` is set), the UI shows `ALL DAY`
instead of a start time.

**Error response (also valid):**
```json
{ "error": "Google Calendar not connected." }
```

**Empty / error behavior:**
- `{ error: "..." }` or `events` not an array → the result becomes
  `{ error: "<server message>" }` (fallback:
  `"Could not load your calendar."`).
- "Today" widget ([`renderHomeToday()`](../academics.js)): shows the
  server's error text verbatim, hint = `"Calendar not connected"`.
- "Next event" tile ([`renderNext()`](../extras.js)):
  `"Calendar not connected"` with sub-line `"Open Settings to connect Google"`.
- Events list ([`renderEvents()`](../extras.js)): same error message,
  meta = `"NOT CONNECTED"`.
- Empty `events` array → "Today" shows `"Nothing on your calendar today."`,
  events list shows `"Nothing coming up on your Google Calendar."`.

---

## Plan / News

### `GET /api/plan`

**Called from:** [`plan-home.js` → `load()`](../plan-home.js).

**How often:** Every **5 minutes** (`setInterval(load, 5 * 60 * 1000)`).

**Expected response:** dated to-dos grouped by course, plus the server's
"today" so the client can flag overdue rows. The widget only renders items
that have a `date`.

```json
{
  "courses": [
    {
      "name": "CS 141",
      "color": "cyan",
      "items": [
        { "date": "2026-10-02", "title": "Read chapter 4" },
        { "date": "2026-10-05", "title": "PSet 3 due" },
        { "date": "",          "title": "Course eval (no date yet)" }
      ]
    }
  ],
  "today": "2026-10-01"
}
```

`color` is a key from the widget's hex map (`cyan`, `amber`, `magenta`,
`violet`, `green`, `blue`); any other value falls back to `#00E5FF`.

**Error response:** `{ "error": "No classes to plan from yet." }`

**Empty / error behavior:**
- `{ error: "..." }` → the server message is shown verbatim.
- Network failure → **`"Couldn't load your classes."`**
- A course with no dated items → `"<n> with no date yet"` (or
  `"Nothing posted yet"` if it has no items at all).

### `GET /api/news`

**Called from:** [`news.js` → `loadHeadlines()`](../news.js). Feeds two
surfaces: the center HUD ticker (`#newsTicker`) and the home-grid widget
(`#homeNewsList`).

**How often:**
- Home-grid widget: every **30 minutes** (`setInterval(refresh, 30 * 60 * 1000)`).
- HUD ticker: rotates the visible 3 every **30 seconds**
  (`setInterval(rotateTile, 30000)`), reusing the fetched list.

**Expected response:** an object whose `headlines` array is non-empty
(otherwise the call is treated as "no data"). Every field below is read.

```json
{
  "headlines": [
    { "id": "n-1", "text": "Fed signals pause in rate hikes", "source": "Reuters",  "category": "finance", "time": "09:14", "link": "https://www.reuters.com/example",   "ticker": "AAPL" },
    { "id": "n-2", "text": "New GPU benchmarks leak",          "source": "The Verge","category": "tech",    "time": "08:47", "link": "https://www.theverge.com/example" }
  ]
}
```

`category` is one of `finance | tech | education | sports` — those four
are the only ones the HUD tile weights
([`WEIGHTS` in `news.js`](../news.js)) and the home widget cycles
through in order. `ticker` is optional; when present the HUD tile shows it
as a "you own this" badge.

**Empty / error behavior:**
- Empty `headlines` or network error → in-memory list stays at `[]` and
  the page keeps whatever was on screen (a warning is logged).
- First paint with no data: both surfaces show
  **`"News unavailable — check your internet connection."`**
- Non-`http(s)` `link` values are silently dropped — the headline is
  rendered without a link ([`safeHref()`](../news.js)).

---

## Portfolio

`/api/holdings`, `/api/prices`, and `/api/portfolio/history` together
power the portfolio tiles on the home page. The live data layer lives in
[`portfolio-shared.js`](../portfolio-shared.js) and exposes a single
`PortfolioData` object.

### `GET /api/holdings`

**Called from:** [`portfolio-shared.js` → load()`](../portfolio-shared.js)
on boot, in parallel with `/api/prices`.

**How often:** Once at page load (no polling).

**Expected response:** a flat array of positions. Only four fields per
row are inspected.

```json
[
  { "ticker": "AAPL", "shares": 12,  "cost": 145.20, "account": "Fidelity" },
  { "ticker": "VTI",  "shares": 40,  "cost": 210.00, "account": "Fidelity" },
  { "ticker": "BTC",  "shares": 0.4, "cost": null,   "account": "Coinbase" }
]
```

`cost` is optional. When it's missing or `<= 0`, the holding is included
in totals but excluded from cost-basis gain calculations
([`hasCost()`](../portfolio-shared.js)).

**Empty / error behavior:** non-OK, network error, or non-array →
`_holdings` becomes `[]` (or `body.holdings` if a wrapped object).
- All portfolio tiles display `—` or `$--.--` instead of numbers.
- The note under the portfolio value shows
  **`"No holdings yet — add your positions to start tracking."`**
  ([`renderPortfolio()`](../app.js)).

### `GET /api/prices`

**Called from:** [`portfolio-shared.js` → `load()`](../portfolio-shared.js)
on boot, and again from [`startPolling()`](../portfolio-shared.js) on a
recurring timer.

**How often:** Once on boot, then every **30 seconds** (`startPolling(30)`).
If a poll fails, the previous quotes are kept — the module logs a warning
and waits for the next tick.

**Expected response:** a `quotes` array paired with a `fetched_at`
timestamp (exposed as `PortfolioData.fetchedAt`, not displayed).

```json
{
  "quotes": [
    { "ticker": "AAPL", "price": 227.45, "change": 1.83, "chg_pct": 0.81, "high": 228.10, "low": 225.92, "open": 226.00, "prev_close": 225.62 }
  ],
  "fetched_at": "2026-10-01T16:32:00-07:00"
}
```

`change` is the dollar change for the day; `chg_pct` is the same as a
percentage. `prev_close` is used to compute portfolio-level day change %
([`totalDayChangePct()`](../portfolio-shared.js)).

**Empty / error behavior:**
- `quotes: []` → every enriched holding gets `price: 0`; the portfolio
  value reads `$0.00` (or `$--.--` from the holdings path if there are
  none).
- HTTP non-OK or network error during a poll → in-memory `_quotes` is
  **kept** as last known good. The UI does not flicker.

### `GET /api/portfolio/history`

**Called from:** [`app.js` → `loadSparklines()`](../app.js), inside
`renderPortfolio()`.

**How often:** Once on page load (no polling). The sparkline shows
recorded daily snapshots, not live ticks.

**Expected response:** a flat array of `{ value, date }` pairs, oldest
first. Only `value` is read for the line.

```json
[
  { "value": 18450.10, "date": "2026-09-25" },
  { "value": 18520.42, "date": "2026-09-26" },
  { "value": 18603.18, "date": "2026-09-29" }
]
```

**Empty / error behavior:** non-OK → `[]`. The sparkline SVG is `hidden`
whenever there are fewer than **2** points
([`drawSpark()`](../app.js)) — the home page simply has no line until the
history service is connected and accumulates data. No placeholder is drawn.

---

## Goals

The goals widget is fully user-managed. All four endpoints share the same
shape: they return `{ ok: true, goals: [...] }` (or `{ ok: false, ... }`),
and the client re-renders from `res.goals` only when `ok === true`.

### `GET /api/goals`

**Called from:** [`goals.js` → `load()`](../goals.js) on boot.

**How often:** Once at page load.

**Expected response:** an array of goals. `progress` is an integer in
`0..100`.

```json
[
  { "id": "g-1", "name": "Run 50 miles this month", "progress": 64 },
  { "id": "g-2", "name": "Read 4 papers",            "progress": 50 }
]
```

The widget's `±` buttons step progress in increments of `10`
([`STEP` in `goals.js`](../goals.js)).

**Empty / error behavior:**
- Non-array → `[]` → the list shows
  **`"No goals yet — add your first one below."`**
- Network failure → **`"Could not load goals."`**

### `POST /api/goals`

**Called from:** [`goals.js` → form submit handler](../goals.js) when the
user submits the "add goal" form (`e.preventDefault()` keeps the page
from navigating).

**How often:** On submit, not on a timer.

**Request body:**
```json
{ "name": "Read 4 papers" }
```

**Expected response:** the updated full list, wrapped in an
`{ ok, goals }` envelope:
```json
{ "ok": true, "goals": [ { "id": "g-3", "name": "Read 4 papers", "progress": 0 } ] }
```

**Error behavior:** the input is cleared and the list re-renders only
when `res.ok === true`; otherwise the UI is a no-op. Empty or
whitespace-only `name` values are rejected client-side and never sent.

### `POST /api/goals/:id`

**Called from:** [`goals.js` → click handler on `.goal-step`](../goals.js).
`:id` is the row's `data-id`. The button's `data-delta` is `+10` or `-10`;
the new `progress` is computed client-side and clamped to `0..100`.

**How often:** On click, not on a timer.

**Request body:**
```json
{ "progress": 70 }
```

**Expected response:** the updated full list (same `{ ok, goals }` shape
as `POST /api/goals`).

**Error behavior:** the list re-renders from `res.goals` only when
`res.ok === true`; otherwise the UI keeps the previous (stale) value.

### `DELETE /api/goals/:id`

**Called from:** [`goals.js` → click handler on `.goal-del`](../goals.js).
`:id` is `encodeURIComponent`-ed from `data-id`.

**How often:** On click, not on a timer. No request body.

**Expected response:** the updated full list of remaining goals:
```json
{ "ok": true, "goals": [ ... ] }
```

**Error behavior:** the list re-renders from `res.goals` only when
`res.ok === true`. A failed delete is invisible to the user until the next
reload (the row stays in place) — a small known limitation, not a silent
corruption.

---

## Gmail

### `GET /api/gmail/messages`

**Called from:** [`extras.js` → `renderInbox()`](../extras.js).

**How often:** Every **2 minutes**
(`setInterval(renderInbox, 2 * 60 * 1000)`), plus once at boot inside
`init()`.

**Query string:** the home page always asks for `?limit=6` — a hint; the
server may return fewer.

```
GET /api/gmail/messages?limit=6
```

**Expected response:** either `{ messages: [...] }` or `{ error: "..." }`.

```json
{
  "messages": [
    { "from": "Maya Patel <[email protected]>", "subject": "Friday plans",       "unread": true  },
    { "from": "GitHub <[email protected]>",        "subject": "PR review requested","unread": false }
  ]
}
```

The dashboard reads only `from`, `subject`, and `unread`. The `from`
value is parsed through [`senderName()`](../extras.js) so the displayed
name strips the surrounding `"Name" <email@...>` wrapper when present.

**Error response (also valid):**
```json
{ "error": "Gmail not connected." }
```

**Empty / error behavior:**
- `{ error: "..." }` or `messages` not an array → the inbox list renders
  the server's error message verbatim; meta tag reads `"NOT CONNECTED"`.
  Malformed body falls back to `"Could not load your inbox."`.
- Network failure → **`"Could not reach the dashboard server."`**
- Empty `messages` array → the list area is left empty; meta shows
  `"0 UNREAD"`.

---

## The "honest empty state" principle

Every endpoint in this document is allowed to fail. The front-end is built
around that: it never invents sample data, never fakes a sparkline, never
fills a row with placeholder text. If a service is missing, the UI tells
the user exactly **what's missing** and **what to do about it** — for
example, *"No schedule saved"*, *"Calendar not connected"*, *"No holdings
yet — add your positions to start tracking."*, *"News unavailable — check
your internet connection."*

This is a deliberate design choice and it's what makes this learning copy
useful. Because every call has an honest empty state, you can run
`node dev-server.js` and open the page in a browser with **nothing** wired
up to Canvas, Gmail, Google Calendar, a price feed, or a goals file — and
still see the full dashboard render with realistic, readable messages in
every panel. The layout, animations, interactions, and event wiring all
work; the data is the only thing missing, and the UI is explicit about
that.

It also makes the failure mode of a real outage feel the same as the
learning-copy experience: the user always sees a useful, specific message
instead of an empty box or a stale number. The same code path that powers
"no API at all" on a laptop powers "API is down for a minute" in
production.
