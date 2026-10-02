# Architecture

> A guided tour of how `jarvis-dashboard` fits together.
> Written for someone reading the code for the first time.
> For a one-paragraph summary of each file, see [FILE-GUIDE](FILE-GUIDE.md).
> For the wire-format of every API call, see [DATA-FLOW](DATA-FLOW.md).

---

## What it is

JARVIS is a personal "HUD-style" dashboard — a single page that pulls your
classes, assignments, calendar, inbox, portfolio, news, and goals into one
dark, glassy grid. The aesthetic is borrowed from the Iron Man HUD: matte
charcoal background, razorthin cyan borders, soft glow, monospace captions,
corner ticks on every panel. Cyan means *calm / informational*; orange means
*urgent / due soon*.

The same dashboard ships in two faces:

- **Desktop** — `index.html`, a 12-column grid of widgets. The page you'll
  spend most of your time in.
- **Phone** — `mobile.html`, the same data on a single narrow column. This
  file is referenced by `view.js` but is **not** in this learning copy;
  visiting it directly just falls back to `index.html`.

Both faces share the same data layer and the same JS modules; only the
HTML and the layout CSS differ. A tiny router (`view.js`) decides which
face to serve, and remembers the choice in `localStorage` so you don't
have to pick every time.

---

## The layers, top to bottom

Open the files in roughly this order and the rest of the codebase will
make sense. The arrows below show the *load order* inside `index.html`,
which is also the order the layers depend on each other.

```
+----------------------------+
| index.html  (skeleton)    |
+----------------------------+
            |
            v
+----------------------------+
| view.js  (router)         |
+----------------------------+
            |
            v
+----------------------------+
| Stylesheets, in order:    |
| styles.css  tokens+base   |
| home.css    home layout   |
| extras.css  shared        |
| desktop.css 12-col grid   |
+----------------------------+
            |
            v
+----------------------------+
| JS modules (one IIFE):    |
| portfolio-shared.js       |
| app.js                    |
| academics.js              |
| extras.js                 |
| news.js, goals.js,        |
| plan-home.js              |
+----------------------------+
            |
            v
+----------------------------+
| /api/* (mock dev server)  |
+----------------------------+
```

A few things to notice about that diagram:

- **`portfolio-shared.js` loads first.** It is a *model* module — a small
  in-memory cache that fetches `/api/holdings` and `/api/prices`, merges
  them, and exposes derived totals (`totalMarketValue()`, `totalGain()`,
  …) on `window.PortfolioData`. Loading it first means `app.js` can
  read those values synchronously on first paint.
- **`academics.js` loads before `extras.js`.** Academics owns the
  authoritative data (`schedule`, `courses`, `upcoming assignments`,
  `calendar`). Extras consumes it. We cover the handshake below in
  *The data-flow pattern*.
- **The CSS order matters.** Later files override earlier ones, so
  `desktop.css` is allowed to mutate anything `styles.css` set up.

---

## The "module per widget" pattern

Each widget on the dashboard is owned by exactly one small JS file. That
file is the only place that:

- knows which API endpoint backs the widget,
- knows how to render the widget's HTML,
- knows how to update it when its data changes.

You can tell at a glance who owns what by searching for the widget's
DOM id — it'll show up in exactly one file (plus, sometimes, the CSS).

| File                   | Owns                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| `portfolio-shared.js`  | The portfolio *model* (no DOM). Exposes `window.PortfolioData`.                                     |
| `app.js`               | The system clock, the portfolio widget tiles, the portfolio sparkline, the hover text-scramble.    |
| `academics.js`         | The weekly schedule, the course matrix, the assignment list, the notification panel, the "today" card. |
| `extras.js`            | The hero (greeting + day progress), the three next-up tiles, the week grid, the course rings, the events list, the mini-month, the inbox preview. |
| `news.js`              | The news widget (and a center HUD ticker used on other pages).                                      |
| `goals.js`             | The goals widget (add / nudge / remove).                                                            |
| `plan-home.js`         | The "by class" card on the home page (calls `/api/plan`).                                           |
| `view.js`              | The router — not a widget owner.                                                                    |

A consequence of this rule: if you want to change how the week grid
looks or what data it shows, you only have to touch `extras.js` and
`extras.css`. Nothing else needs to know.

---

## The data-flow pattern

Most widgets follow the same four-step dance. `academics.js` and
`extras.js` are the canonical example because they do all of them
together.

### 1. Load JSON

In `academics.js`, `boot()` starts by fetching the things that don't
depend on anything else:

```js
var courses  = await loadJSON('/api/courses/all');
var schedule = await loadJSON('/api/schedule');
```

Then it kicks off the parallel loads (calendar + per-course Canvas
assignments) so the slow ones don't block the fast ones.

### 2. Render once

Each render function is small and pure: it takes the data it needs and
writes HTML into a known element. `renderSchedule()`, `renderCourseMatrix()`,
`renderAssignmentList()`, `renderNotifications()` — one job each, all
sitting in `academics.js`.

### 3. Dispatch a `CustomEvent`

Right after a chunk of data is ready, `academics.js` announces it to
the rest of the page on `document`:

```js
document.dispatchEvent(new CustomEvent('home:schedule'));
document.dispatchEvent(new CustomEvent('home:assignments'));
document.dispatchEvent(new CustomEvent('home:calendar'));
```

The payload is *not* in the event — it's published on a global
namespace first, so listeners don't have to copy it around:

```js
window.HomeData = { courses, schedule, upcoming, byCourse, calendar };
```

### 4. Other modules listen and re-render

`extras.js` is full of these listeners:

```js
document.addEventListener('home:schedule',     refreshFromSchedule);
document.addEventListener('home:assignments',  refreshFromAssignments);
document.addEventListener('home:calendar',     refreshFromCalendar);
```

Each one re-renders only the widgets that depend on the data that just
arrived. The week grid and the next-class tile listen to
`home:schedule`; the course rings and the next-due tile listen to
`home:assignments`; the events list, the mini-month, and the next-event
tile listen to `home:calendar`.

```
  academics.js          extras.js
       |                     ^
       | home:schedule       |
       +---------------------+
       |                     |
       | home:assignments    |
       +---------------------+
       |                     |
       | home:calendar       |
       +---------------------+

  arrows down = dispatchEvent
  arrows up   = addEventListener
```

What each event triggers in `extras.js`:

- `home:schedule` → `renderNext()` (next-class tile), `renderWeek()` (week grid)
- `home:assignments` → `renderNext()` (next-due tile), `renderRings()` (course rings), `renderMiniMonth()`
- `home:calendar` → `renderNext()` (next-event tile), `renderEvents()` (events list), `renderMiniMonth()`

Why not just have `extras.js` call `renderNext()` directly? Two reasons:

1. **Loose coupling.** `extras.js` doesn't have to know when each
   piece of data finishes loading. It just says "when the schedule
   arrives, redraw the things that depend on it." Adding a fourth
   consumer of `home:schedule` later doesn't require changing
   `academics.js` at all.
2. **Re-entry is free.** Because the data lives on `window.HomeData`,
   any module can re-render at any time without going through
   `academics.js`. That's exactly what `extras.js` does every 30
   seconds — it just calls `renderNext()` on a timer to update the
   countdowns.

The same pattern shows up in miniature in `goals.js` (re-render after
every add / nudge / delete) and `plan-home.js` (re-fetch every five
minutes). When in doubt, look for `document.dispatchEvent(new
CustomEvent('home:…'))` and you've found the wiring.

---

## The "honest empty state" principle

Every widget in this codebase, when its data is missing, says so in
plain English. No spinners that never resolve, no fake sample data, no
"Welcome to your dashboard!" demo content.

A few examples pulled straight from the code:

- No classes today: `"No classes today."` (`academics.js:91`)
- No Canvas yet: `"No classes yet — connect Canvas in Settings."`
  (`extras.js:239`)
- No upcoming assignments: `"No upcoming assignments found."`
  (`academics.js:193`)
- Calendar not connected: `"Google Calendar not connected."` — this
  one comes from the *server's* mock response, not the JS, so the
  message is owned by the backend that knows how to fix it.
- News feed unreachable: `"News unavailable — check your internet
  connection."` (`news.js:88`)

For a learning codebase, this matters more than it sounds. If the
empty state is a real sentence that explains *what's missing and what
to do about it*, then:

- You can open the page with no backend and immediately understand
  which API each widget is waiting on.
- The mock server (`dev-server.js`) only has to return honest
  errors — it doesn't have to fabricate a fake Canvas course list.
- When you read a render function, the empty-state branch tells you
  what "no data" *means* for that widget, which is half the spec.

When you're tempted to add a placeholder ("Lorem ipsum", "Sample
event", "Demo student") to make the page look less empty — don't. The
blank is the point. The text on the page is the documentation.

---

## The four stylesheets

Loaded in this order, with later files free to override earlier ones:

- **`styles.css`** — design tokens (the cyan / blue / orange palette,
  glow shadows, radii, type scale) plus the base shell: body, top bar,
  panel, glassmorphic surfaces, the `.widget` card itself, and the
  small shared utilities (badges, chips, corner ticks). If you've
  ever asked "what does a JARVIS card look like?" the answer is in
  this file.
- **`home.css`** — the home page specifically: the top-bar layout, the
  hero placement, and the compact list/card overrides for the home
  grid. Most of the per-widget rules in `home.css` are about making
  the same widget look tighter in the dense home grid than it does on
  its own page.
- **`extras.css`** — styles that are *shared* between the desktop
  and phone layouts: the next-up tile, the day-progress bar, the
  event list, the inbox row. Anything here must look good at both
  widths.
- **`desktop.css`** — the 12-column grid and the per-widget desktop
  sizing (how many columns each widget spans, where it sits in the
  row). Also owns the decorative animated backdrop (drifting orbs,
  slow scan line) — that stuff is `desktop.css` because it would be
  wasted on a phone.

If you're wondering "where do I add a new style?" the answer is
usually: tokens in `styles.css`, shared layout in `extras.css`,
desktop-specific overrides in `desktop.css`, and home-grid tweaks in
`home.css`.

---

## The two faces and the router

`view.js` is the smallest file in the repo but it's worth reading
twice. It does three things:

1. **First visit:** phones (narrow screen or mobile user agent) get
   `mobile.html`; everything else gets `index.html`.
2. **User override:** the `PHONE VIEW` / `DESKTOP VIEW` links in the
   top bar call `JarvisView.switchTo('mobile' | 'desktop')`, which
   writes the choice to `localStorage` under the key `jarvis-view`
   and navigates.
3. **URL override:** `?view=mobile` or `?view=desktop` in the URL
   sets the choice (and persists it) before the page decides what to
   load — handy for testing or for sharing a link.

The router runs **synchronously in the `<head>`**, before any
stylesheets or other scripts load. `index.html` does this:

```html
<script src="view.js"></script>
<script>JarvisView.route('desktop');</script>
```

If the user actually wants `mobile.html`, that second line fires a
`location.replace('mobile.html')` immediately and the rest of the
page never executes. That's why the order matters: `view.js` must
be the very first script on the page.

One thing to be aware of: this copy only has `index.html`. Visiting
`mobile.html` directly will 404; the `view.js` router is the only
supported way to get to the phone layout, and in this learning copy
it will just keep sending you back to `index.html`. That's
intentional — the focus here is the desktop code.

---

## External services the dashboard talks to

In the live version (not in this copy). Every one of these is replaced
by a stub in `dev-server.js` that returns an honest empty state.

| Service              | What for                                                                                              | Where it's called from                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Canvas (UCR elearn)  | Real course list + per-course assignment list.                                                        | `academics.js` (`/api/courses/all`, `/api/canvas/courses/:id/assignments`). |
| Google Calendar      | Today's events, the "next event" tile, the events list, the mini-month dots.                          | `academics.js` (`/api/calendar/events`).                              |
| Gmail                | The inbox preview on the home page.                                                                   | `extras.js` (`/api/gmail/messages?limit=6`).                          |
| Finnhub              | Live stock prices + day change for the portfolio widget.                                              | `portfolio-shared.js` (`/api/prices`), which then polls every 30s.   |
| Google News (server) | Aggregated, weighted headlines (finance, tech, education, sports).                                    | `news.js` (`/api/news`). The Google News fetch happens on the server, not the client. |
| Local JSON           | Holdings list (`/api/holdings`) and goals (`/api/goals`, with POST/DELETE for CRUD).                  | `portfolio-shared.js` for holdings, `goals.js` for goals.            |
| (none)               | The portfolio sparkline is drawn from `/api/portfolio/history` — recorded daily snapshots on disk.    | `app.js`.                                                             |

The dashboard's *only* network surface is `/api/*`. It never calls
Canvas, Gmail, Finnhub, or Google Calendar directly. That keeps the
secrets (Canvas tokens, Google OAuth refresh tokens, the Finnhub
API key) on the server where they belong, and it makes the whole
front end easy to mock — which is exactly what `dev-server.js`
does.

---

## What this copy deliberately omits

This is a front-end snapshot for learning. The following are not
included, and the page works fine without them (it just shows honest
empty states everywhere).

- **The backend itself.** The real server that proxies Canvas / Gmail
  / Calendar / Finnhub / Google News and serves `data/goals.json`.
  The mock server (`dev-server.js`) stands in for it locally.
- **Auth tokens.** No Canvas bearer token, no Google OAuth refresh
  token, no Finnhub API key. All of those are server-side concerns
  and never live in the browser.
- **The Google OAuth flow.** The Settings page on the live server
  wires up OAuth; here, the only setting surface is a button that
  doesn't go anywhere.
- **The price-fetch script.** On the live server, a small Python
  script polls Finnhub and writes `/api/prices`. In this copy,
  `/api/prices` is a static empty response.
- **`mobile.html`.** Referenced by the router but not bundled. If
  you want to write a phone layout, the file to create is
  `mobile.html`; the JS modules will Just Work because they look up
  DOM ids, not layouts.
- **The class / assignment / calendar / portfolio / email detail
  pages.** `index.html` links to `classes.html`, `assignments.html`,
  `calendar.html`, `portfolio.html`, `email.html`, etc. Those are
  full pages on the live server; in this copy they 404. Most of
  those pages reuse the same JS modules in a different layout.

The good news: **the structure you're learning here is the structure
of the real thing.** When you read `academics.js` against the mock
server, you're reading the same code that runs against Canvas. The
empty states you see are the states a real user sees before they
connect their account. Nothing in this copy is a fake or a
watered-down version — it's just unplugged.
