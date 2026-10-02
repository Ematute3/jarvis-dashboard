# File guide

A one-stop tour of every file in this repo. Read this when you want to
know **what a file does, what to look at inside it, and what touches it**.

If you haven't read it yet, start with [`/README.md`](../README.md) for
the big picture and how to run the dashboard. For the architecture and
data flow, see the sibling docs:

- [ARCHITECTURE](ARCHITECTURE.md)
- [DATA-FLOW](DATA-FLOW.md)

---

## HTML / config

## `index.html`

The desktop dashboard. It's a static skeleton — almost every widget is
just a styled `<a>` or `<div>` that a JS module later fills in.

### What it does

Defines the desktop page layout: animated backdrop, top bar, hero
section, and a 12-column grid of widget cards. It loads every
stylesheet and script the page needs, in order.

### Key things to look at

- `<link rel="manifest" href="manifest.json">` and Google Fonts (Orbitron,
  Inter, Share Tech Mono).
- `<script src="view.js">` runs **first** (synchronous), then
  `JarvisView.route('desktop')` is called inline so the routing decision
  happens before paint.
- Stylesheets are loaded in this order — `styles.css` → `home.css` →
  `extras.css` → `desktop.css`. Order matters because each later file
  overrides the previous one.
- Decorative backdrop: `.bg-fx` with `.bg-orb.o1`, `.bg-orb.o2`, and
  `.bg-scan`.
- Top bar: `<header class="topbar home-bar">` containing `.brand`,
  `<nav class="home-nav">` (`.chip` links to SCHOOL, BY CLASS,
  ASSIGNMENTS, CALENDAR, INBOX, MONEY, LIBRARY, STATEMENTS, CANVAS,
  SETTINGS, PHONE VIEW), and `#notifBtn` with `#notifBadge`.
- Hero: `<section class="hero">` with `.hero-eyebrow`, `#heroGreeting`,
  `#heroDate`, `#systemTime`, the day-progress bar
  (`#dayProgressFill` / `#dayProgressText`), and three `#nextClass` /
  `#nextDue` / `#nextEvent` `.next-tile`s.
- Main: `<main class="dash">` containing the widget cards. Look at the
  class on each — `.c-week`, `.c-assign`, `.c-plan`, `.c-events`,
  `.c-rings`, `.c-inbox`, `.c-news`, `.c-port`, `.c-goals` — these are
  the hooks `desktop.css` uses for grid sizing.
- Widget IDs the JS modules target: `#weekGrid`, `#assignMeta`,
  `#planHome`, `#planMeta`, `#eventsList`, `#eventsMeta`, `#miniMonth`,
  `#courseRings`, `#courseRingsMeta`, `#inboxList`, `#inboxMeta`,
  `#homeNewsList`, `#homeNewsDate`, `#portfolioValue`,
  `#portfolioDelta`, `#portfolioSparkSvg`, `#portfolioSpark`,
  `#portPositions`, `#portDay`, `#portGain`, `#portfolioNote`,
  `#goalList`, `#goalForm`, `#goalInput`, `#goalsCount`.
- Off-canvas notification panel: `#notifPanel`, `#notifClose`,
  `#notifList`. The small inline script at the bottom toggles it.

### Depends on

Every stylesheet and JS module listed in the `<head>` / bottom of
`<body>`. The DOM IDs above are the contract the JS modules rely on.

### What depends on it

Nothing — it's the entry point. Every other file is loaded by it.

---

## `manifest.json`

The PWA manifest so the page can be "installed" to a phone home screen
with the right icon and dark theme.

### What it does

Tells the browser how to render the app as a standalone PWA.

### Key things to look at

- `"name"` / `"short_name": "JARVIS"`.
- `"start_url": "mobile.html"` — interesting: when launched from the home
  screen, it starts on mobile, not the desktop page. `view.js` then
  routes from there.
- `"display": "standalone"`, `"background_color"` and `"theme_color":
  "#080c16"` (matches `--c-bg` in `styles.css`).
- Two icons: `icon-512.png` (512×512) and `apple-touch-icon.png` (180×180,
  also referenced from `<link rel="apple-touch-icon">` in `index.html`).

### Depends on

Nothing — it's pure config.

### What depends on it

Browsers and iOS Safari, plus `index.html`'s `<link rel="manifest">`
and `<link rel="apple-touch-icon">`.

---

## Stylesheets

The four stylesheets are layered: `styles.css` defines tokens and
the base shell, then each later file scopes to a specific layer
(home, extras, desktop). They're loaded in this order from
`index.html`.

## `styles.css`

The biggest stylesheet (~1300 lines). It's the visual foundation:
design tokens, the base shell (panels, top bar, glows, the boot
overlay) and the widget/card primitives every later file reuses.

### What it does

Defines the JARVIS look: tokens (cyan/blue/orange palette, glows,
type system), a sci-fi boot overlay, the sticky top bar, the panel
base with corner-cut accents, and the generic `.widget` card shell.

### Key things to look at

- **Tokens** (`:root`): `--c-cyan`, `--c-blue`, `--c-orange`,
  `--c-orange-soft`, `--c-bg`, `--c-bg-2`, `--c-ink`, `--c-ink-dim`,
  `--c-ink-faint`, `--c-line`, `--c-line-strong`, `--c-line-soft`,
  `--surface`, `--surface-strong`, `--surface-soft`, `--glow-cyan`,
  `--glow-orange`, `--glow-blue`, `--r-1`, `--r-2`, `--r-3`,
  `--f-display`, `--f-body`, `--f-mono`. Every other file and most JS
  color choices go through these.
- **Boot overlay** (`.boot-overlay`, `.boot-logo`, `.boot-bar`,
  `.boot-bar-fill`): the full-screen intro with a scan line and
  `@keyframes bootScan`, `bootScanLine`, `bootFill`, `bootFadeAway`,
  `bootGlow`. The `<body class="boot">` selector blurs the rest of
  the page while it's active.
- **Top bar** (`.topbar`, `.brand`, `.brand-mark`, `.brand-text`,
  `.topbar-center`, `.topbar-right`, `.icon-btn`, `.icon-glyph`,
  `.user-chip`, `.user-avatar`, `.user-meta`, `.user-name`, `.user-id`).
- **Notification panel** (`.notif-panel`, `.notif-head`, `.notif-title`,
  `.notif-close`, `.notif-list`, `.notif-item`, `.notif-dot`,
  `.notif-dot.accent`).
- **HUD grid** (`.hud`) — a 3-column shell used by older pages; the
  current `index.html` uses `.dash` from `desktop.css` instead.
- **Panel base** (`.panel`, `.panel-header`, `.panel-title`,
  `.panel-tag`) with the `::before` / `::after` corner ticks that are
  the visual signature.
- **Module** (`.module`, `.module-header`, `.module-name`,
  `.module-meta`) and the schedule telemetry stream (`.telemetry-list`,
  `.telemetry-row`, `.t-time`, `.t-class`, `.t-state`,
  `.telemetry-row.active`, `@keyframes rowFlash`).
- **Stats** (`.stat-list`, `.stat-row`, `.stat-key`, `.stat-bar`,
  `.stat-fill`, `.stat-fill.alert`, `@keyframes statPulse`).
- **Course icons**: `.course-cell`, `.course-icon`, and per-subject
  decorative icons like `.icon-atom` (with `.atom-core`,
  `.atom-orbit`, `.atom-orb`, `@keyframes orbitSpin`).
- **Home grid (widgets)** at line ~927: `.home-grid`, `.widget`,
  `.widget::before`, `.widget-head`, `.widget-title`, `.widget-tag`,
  `.widget-foot`, `.widget-hint`, `.widget-arrow`, `.widget-list`,
  `.widget-list .dot` (with `.urgent`, `.soon`). These are the
  primitives every card uses.
- **Footer status strip** (`.status-strip`) and **responsive
  collapse** / **focus ring** at the bottom.

### Depends on

Nothing in this repo. The Google Fonts from `index.html` are referenced
through `--f-display`, `--f-body`, `--f-mono`.

### What depends on it

`home.css`, `extras.css`, `desktop.css`, and every JS module that
references CSS variables (e.g. `var(--c-cyan)` in `app.js`'s
`renderPortfolio`).

---

## `home.css`

Tweaks the home-page top bar into a flex-wrap chip row and turns the
generic `.widget` card into a compact, dense layout. Also styles the
news and goals widgets.

### What it does

Overrides `.topbar` into `.home-bar` + `.home-nav` + `.chip`, then
makes every widget list (telemetry, assign-list, course cells) more
compact, and adds the news/goal styles the desktop layout needs.

### Key things to look at

- `.home-bar`, `.home-nav`, `.home-nav .chip`, `.home-bar-right`,
  `.home-bar-right .time-value`.
- `a.widget` cursor pointer; non-link widgets `.widget-goals` and
  `.widget-news` get `cursor: default` and no hover lift.
- Compact overrides scoped inside `.widget`: `.widget .telemetry-list`
  / `.telemetry-row`, `.widget .today-list`, `.widget .assign-list` /
  `.assign-row` / `.a-class` / `.a-title`, `.widget .course-grid` /
  `.course-cell` / `.course-name` / `.course-grade`.
- Portfolio sizing inside the widget: `.widget .port-num`,
  `.widget .mini-spark`.
- News widget: `.news-links`, `.news-links li a` (with `:hover`
  glow), `.news-headline`, `.news-src`, `.news-empty`.
- Goals widget: `.goal-list`, `.goal-item`, `.goal-name`,
  `.goal-bar`, `.goal-empty`, `.goal-step`, `.goal-del`, `.goal-form`,
  `.goal-form input` (with `:focus`), `.goal-add`.
- Final block: `.widget` shared card sizing (padding, gap, footer
  spacing).

### Depends on

`styles.css` (tokens, `.topbar`, `.widget` primitives).

### What depends on it

The home page DOM, plus `news.js` (uses `.news-links`, `.news-empty`)
and `goals.js` (uses `.goal-list`, `.goal-item`, `.goal-form`, etc.).

---

## `extras.css`

Shared styles for widgets that appear on **both** desktop and mobile
layouts: the day-progress bar, the three "next up" tiles, the events
list, the inbox rows, and the "by class" card.

### What it does

Styles the cross-layout widgets — anything that's not specific to the
12-column desktop grid.

### Key things to look at

- **Day progress**: `.day-progress`, `.day-track`, `#dayProgressFill`,
  `#dayProgressText`.
- **Next-up tiles**: `.next-tile` (with `:hover` lift), `.next-label`,
  `.next-title`, `.next-sub`, `.next-when`, `.next-loc`,
  `.next-tile[data-tone="live"]` (with `@keyframes livePulse`),
  `.next-tile[data-tone="urgent"]`.
- **Event + inbox rows**: `.ev-list`, `.ev-row`, `.ev-date` (with
  inner `<b>`), `.ev-main`, `.ev-title`, `.ev-sub`, `.ev-empty`.
- **Mail rows**: `.mail-row` (+ `.is-unread`), `.mail-dot`,
  `.mail-main`, `.mail-from`, `.mail-subj`.
- **Location lines**: `.t-loc` (telemetry), `.wk-loc` (weekly grid),
  `.next-loc` (with the small cyan dot pseudo-element).
- **Home "By class" card**: `.c-plan` (full-width grid override),
  `.ph-grid`, `.ph-course`, `.ph-name`, `.ph-d` (+ `.over` for
  past-due), `.ph-t`, `.ph-none`. Responsive collapses at 1100px and
  720px.

### Depends on

`styles.css` tokens. The classes are referenced by `extras.js` and
`plan-home.js`.

### What depends on it

`extras.js` (`renderHero`, `renderNext`, `renderWeek`, `renderEvents`,
`renderInbox`) and `plan-home.js` (`render` for the "by class"
card).

---

## `desktop.css`

The desktop-only layer: the animated backdrop, the 12-column grid,
the hero, the weekly schedule grid, the course progress rings, the
mini-month calendar, and portfolio stat tiles.

### What it does

Sizes the `.dash` grid and styles every desktop-only widget so the
layout fills the screen at 12 columns.

### Key things to look at

- **Backdrop**: `.bg-fx` with `.bg-fx::before` (the masked grid),
  `.bg-orb` / `.bg-orb.o1` / `.bg-orb.o2` (the drifting cyan/blue
  glows), `.bg-scan` (the slow scan band), plus `@keyframes orbDrift`
  and `@keyframes scanSweep`. `.dash-page .topbar` and `.dash` get
  `z-index: 1` to sit above it.
- **Grid**: `.dash` (12 cols, `gap: 12px`, max-width 1900px) and the
  per-card `grid-column` spans — `.c-week` (8), `.c-assign` (4),
  `.c-events` (4), `.c-rings` (4), `.c-inbox` (4), `.c-news` (6),
  `.c-port` (3), `.c-goals` (3). `.dash > .widget { height: 100% }`
  and `.widget-foot { margin-top: auto }` keep cards aligned and the
  footer pinned.
- **Hero**: `.hero` (full-width, gradient + cyan top accent),
  `.hero-main`, `.hero-eyebrow`, `.hero-greeting` (the white→cyan
  gradient text), `.hero-date`, `.hero-clock`, `.next-row` (3-up).
- **Weekly schedule grid**: `.wk`, `.wk-dayname`, `.wk-timecol`,
  `.wk-day.is-today`, `.wk-body` (the `var(--hour-px)`-based hour
  stripes), `.wk-block` (positioned with `top` / `height` inline
  styles from `extras.js`), `.wk-now` (orange line with
  `@keyframes nowPulse`), `.wk-empty`.
- **Assignment list**: `.c-assign .assign-list` / `.assign-row`
  tighter padding.
- **Course progress rings**: `.rings`, `.ring-item`, `.ring-wrap`,
  `.ring`, `.ring-bg`, `.ring-fg` (animated `stroke-dasharray`),
  `.ring-pct`, `.ring-name`, `.ring-sub`.
- **News**: `.c-news .news-links` becomes a 2-column grid.
- **Portfolio**: `.c-port .port-num` (32px), `.c-port .mini-spark`
  (flex), `.port-note`, `.port-stats` (3-up grid of
  span-label + b-value), `.port-stats b.is-up` / `.is-down`.
- **Tablet**: `@media (max-width: 1150px)` re-spans the cards and
  collapses the hero. `@media (prefers-reduced-motion: reduce)`
  disables the orb/scan/live/now pulse animations.
- **Mini month**: `.minimonth`, `.mm-head`, `.mm-legend`,
  `.mm-grid` (7-col), `.mm-dow`, `.mm-day` (+ `.is-today`, `.other`),
  `.dot-ev` / `.dot-due`.
- **Goals empty state**: `.c-goals .goal-list` and
  `.c-goals .goal-empty` (the dashed-border centered state with the
  `◎` glyph pseudo-element).

### Depends on

`styles.css` tokens. The `data-limit="…"` and inline `style="…"`
attributes set by `extras.js` and `plan-home.js`.

### What depends on it

`index.html` (the `.c-*` classes on each widget), `extras.js`
(`.wk-*`, `.ring-*`, `.mm-*`), and `plan-home.js` (`.ph-*`).

---

## JavaScript

Scripts load in this order from `index.html`: `portfolio-shared.js`
→ `app.js` → `academics.js` → `extras.js` → `news.js` → `goals.js`
→ `plan-home.js`. `view.js` is loaded earlier, in `<head>`, so it
can route before the body parses.

## `portfolio-shared.js`

The shared data layer for the portfolio tile. Loaded first so every
later script that reads portfolio data sees a populated
`window.PortfolioData`.

### What it does

Loads holdings + live prices, merges them into enriched rows, exposes
derived totals (market value, day change, cost-basis gain), polls
prices every 30 seconds, and lets other modules subscribe via
`onUpdate`.

### Key things to look at

- IIFE wrapper; state lives in module-private `_holdings`, `_quotes`,
  `_fetchedAt`, `_onUpdate`, `_pollTimer`.
- Pure helpers: `fetchJSON`, `enrichedHoldings`, `hasCost`,
  `marketValue`, `costTotal`, `gainDollar`, `gainPct`,
  `withCost`, `unknownCostCount`.
- Totals: `totalMarketValue`, `totalCost`, `totalGain`,
  `totalGainPct`, `totalDayChange`, `totalDayChangePct`,
  `formatUSD`.
- `load()` returns a Promise; uses `Promise.all` for
  `/api/holdings` + `/api/prices`. On failure it logs and falls
  back to an empty list.
- `startPolling(intervalSec)` re-fetches `/api/prices` on an interval
  (default 30s, min 10s) and notifies subscribers.
- `onUpdate(fn)` and `_notify()` — the pub/sub channel that
  `app.js`'s `renderPortfolio` subscribes to.
- Auto-bootstrap: at the bottom, on `DOMContentLoaded` it calls
  `load().then(() => startPolling(30))`.
- Public surface on `window.PortfolioData`: `load`, `startPolling`,
  `onUpdate`, `enrichedHoldings`, `marketValue`, `costTotal`,
  `gainDollar`, `gainPct`, `totalMarketValue`, `totalCost`,
  `totalGain`, `totalGainPct`, `unknownCostCount`, `hasCost`,
  `totalDayChange`, `totalDayChangePct`, `formatUSD`, and the
  `fetchedAt` getter.

### Depends on

`/api/holdings`, `/api/prices` (and indirectly
`/api/portfolio/history`, which `app.js` fetches separately).

### What depends on it

`app.js` (`renderPortfolio` reads `totalMarketValue`,
`totalDayChangePct`, `formatUSD`, etc.).

---

## `app.js`

The smallest script on the home page. Owns the clock, the portfolio
tile render, the sparkline, and the hover text-scramble effect.

### What it does

Ticks the system clock once a second, paints the portfolio tile
(live prices + sparkline + status note), and adds a subtle
text-scramble glitch to widget titles on hover.

### Key things to look at

- Tiny helpers: `$`, `$$`, `pad`.
- `tickClock()` writes to `#systemTime` in `HH:MM:SS AM/PM`; called
  every 1s.
- `drawSpark(svgEl, lineEl, values, height)` — maps an array of
  numbers to SVG polyline `points` and unhides the `<svg>`. Stays
  hidden if fewer than 2 values.
- `loadSparklines()` fetches `/api/portfolio/history` and draws
  into both `#portfolioSparkSvg` and `#portSparkSvg`.
- `renderPortfolio()` populates `#portfolioValue`,
  `#portfolioDelta`, `#portPositions`, `#portDay`, `#portGain`,
  `#portfolioNote`, plus `#portVal` / `#portChange` (the legacy
  selectors). Uses `setStat(id, text, cls)` to flip
  `.is-up` / `.is-down`. Subscribes to `PortfolioData.onUpdate` so
  the tile re-renders on each price poll.
- `scramble(el)` + `bindScramble()` — the hover effect, bound to
  `.widget-title`, `.panel-title`, `.module-name`. Uses a
  `SCRAMBLE_CHARS` glyph pool and a 6-frame timer.
- `init()` wires everything on `DOMContentLoaded`.

### Depends on

`PortfolioData` (from `portfolio-shared.js`), `/api/portfolio/history`.

### What depends on it

Nothing — `app.js` is a leaf module.

---

## `academics.js`

The largest module. Owns the schedule stream, course matrix, the
home-grid assignment list, and the notification panel. Also seeds
`window.HomeData` and `window.HomeUtil`, and dispatches `home:*`
events that `extras.js` listens for.

### What it does

Loads schedule, courses, calendar, and Canvas assignments in
parallel, renders the schedule stream and course matrix, renders
the home-grid assignment list and notification panel, and exposes
the loaded data + utilities so `extras.js` can render derived
views without re-fetching.

### Key things to look at

- `DAY_NAMES`, `escapeHtml`, `jsDayToMon0`, `isoOf`, `meetsOn`,
  `timeToMinutes`, `loadJSON` — date/escaping primitives.
- `shortLabel(course)` — strips Canvas subject prefixes; manual
  courses truncate at 14 chars. `courseById(courses, id)` does a
  loose `String(id)` compare so Canvas numeric ids and manual
  string ids both match.

### Render functions

- `renderSchedule(schedule, courses)` writes `#scheduleStream`
  (`.telemetry-row` items with `.t-time`, `.t-class`, `.t-state`)
  and `#scheduleMeta` for the today-tag. Each row is tagged
  `data-status="done|active|queued"`.
- `gradeLabel`, `gradeIsAlert`, `renderCourseMatrix(courses)` fill
  `.course-grid` with `.course-cell` chips
  (`.course-name` + `.course-grade`, with `.alert` below 70%).
  Sets `#courseMeta` to `"N CLASSES"`.
- `formatDueIn(iso)` (`"OVERDUE"` / `"DUE NH"` / `"DUE ND"`),
  `urgencyFor(iso)` (`'urgent' | 'soon' | 'ok'`) — used here and
  by `extras.js` via `HomeUtil`.
- `collectUpcomingAssignments(courses)` hits
  `/api/canvas/courses/:id/assignments` for every Canvas course
  (skips `source === 'manual'`), then flattens and sorts. Returns
  `{ upcoming, byCourse }`.
- `renderAssignmentList(upcoming)` paints the `.assign-list` (uses
  `data-limit` on the element, default 6) with `.assign-row`
  children (`.a-dot`, `.a-title`, `.a-class`, `.a-due`,
  `data-urgency`). Sets `#assignMeta` to `"N DUE THIS WEEK"`.
- `renderNotifications(upcoming)` writes `#notifList` with up to 8
  `.notif-item` entries (`.notif-dot` + `.notif-dot.accent` for
  urgent) and sets `#notifBadge.textContent` to the count of
  items due in <72h (hides the badge if 0).
- `renderHomeToday(cal)` writes `#homeTodayList` /
  `#homeTodayHint`. (Note: these IDs aren't on the desktop
  `index.html`; the function is wired up for mobile.)
- `loadCalendar()` fetches `/api/calendar/events`, preserves the
  server's `error` message, filters out `isClass` events
  (classes are already on the schedule).

### Shared exports

- `window.HomeUtil = { esc, shortLabel, timeToMinutes, jsDayToMon0,
  meetsOn, urgencyFor }` — used heavily by `extras.js`.
- `window.HomeData = { courses, schedule, upcoming, byCourse,
  calendar }` — populated incrementally during `boot()`.

### Boot

`boot()` runs on `DOMContentLoaded`: loads courses + schedule,
renders, dispatches `home:schedule`. Then in parallel: loads
Canvas assignments (renders assignment list + notifications,
stores `upcoming` + `byCourse` on `HomeData`, dispatches
`home:assignments`) and loads the calendar (renders
`home:calendar` and dispatches `home:calendar`).

### Depends on

`/api/schedule`, `/api/courses/all`, `/api/canvas/courses/:id/assignments`,
`/api/calendar/events`. The `HomeUtil` / `HomeData` it sets up are
read by `extras.js`.

### What depends on it

`extras.js` (reads `HomeData` / `HomeUtil`, listens for
`home:schedule`, `home:assignments`, `home:calendar`).

---

## `extras.js`

Everything that runs on top of `academics.js`'s loaded data: the
hero greeting, day-progress bar, the three "next up" tiles, the
weekly schedule grid with a "now" line, the course progress rings,
the events list, the mini-month, and the inbox preview.

### What it does

Listens for the `home:*` events `academics.js` dispatches and
re-renders the derived views. Also fetches `/api/gmail/messages`
directly for the inbox preview.

### Key things to look at

- Helpers: `fmtDelta`, `time12`, `atTime`, `dateFromISO`, `data()`,
  `courseLookup`, `colorFor`. `PALETTE` is the per-course color
  array.

### Per-feature functions

- `renderHero()` — sets `#heroGreeting` ("Still up" / "Good morning"
  / "Good afternoon" / "Good evening, Evan"), `#heroDate`
  (long-form US date), and the `#dayProgressFill` width + text
  based on the current minute of the day.
- `setTile(id, o)` + `nextClass()` + `renderNext()` — fill the
  three `.next-tile` cards (`#nextClass`, `#nextDue`,
  `#nextEvent`) using `HomeData.schedule`, `HomeData.upcoming`,
  and `HomeData.calendar`. Each tile gets a `data-tone`
  (`"live"` while a class is in session, `"urgent"` for an
  assignment due in <24h).
- `upcomingEvents(events, now)` — normalizes raw calendar events
  into `{ start, startStr, allDay, durationMin, … }`.
- `renderWeek()` + `updateNowLine()` — paints the weekly grid into
  `#weekGrid` using `.wk`, `.wk-times`, `.wk-timecol`, `.wk-day`
  (+ `.is-today`), `.wk-body`, `.wk-block` (with inline
  `top`/`height`/`--c` styles). `updateNowLine()` is called every
  minute to slide the orange `.wk-now` line on today's column.
- `renderRings()` — for each course, draws an SVG ring
  (`.ring-wrap` > `.ring` > `.ring-bg` + `.ring-fg`) into
  `#courseRings`. Computes percent from
  `byCourse[id].filter(a => a.status === 'submitted' || 'graded')`.
  Manual courses show `"not on Canvas"`. The dasharray animation
  is applied in `requestAnimationFrame` after render.
- `renderEvents()` — writes `#eventsList` (`.ev-row` with `.ev-date`
  + `.ev-main` > `.ev-title` + `.ev-sub`) and `#eventsMeta`
  (`"N UPCOMING"` or `"NOT CONNECTED"`).
- `localISO()` + `renderMiniMonth()` — paints `#miniMonth` with
  `.mm-head`, `.mm-legend`, `.mm-grid`, `.mm-dow`, `.mm-day`
  (+ `.is-today`). Marks days with `.dot-ev` (calendar event) or
  `.dot-due` (upcoming Canvas assignment).
- `senderName(from)` + `renderInbox()` — fetches
  `/api/gmail/messages?limit=6`, writes `#inboxList` as
  `.mail-row` (+ `.is-unread`) with `.mail-dot`, `.mail-from`,
  `.mail-subj`, and sets `#inboxMeta` to `"N UNREAD"` or
  `"NOT CONNECTED"`.

### Wiring

Listens on `document` for `home:schedule` (re-renders next tiles +
week), `home:assignments` (next + rings + mini-month), and
`home:calendar` (next + events + mini-month). `init()` calls
`renderHero`, `renderMiniMonth`, then `refreshAll()` once
`HomeData` exists, then `renderInbox()`. Sets three intervals:
`renderNext` every 30s, `renderHero` + `updateNowLine` every 60s,
`renderInbox` every 2 minutes.

### Depends on

`HomeData` / `HomeUtil` from `academics.js`, `/api/gmail/messages`.

### What depends on it

Nothing — `extras.js` is a leaf. (The `home:*` events it listens
for come from `academics.js`.)

---

## `news.js`

The news widget and the (optional) center HUD headline ticker.

### What it does

Fetches `/api/news`, shows one top story per category in the home
news widget (refreshed every 30 minutes), and — if `#newsTicker`
exists on the page — rotates three weighted-pick headlines every
30 seconds with a fade transition.

### Key things to look at

- `WEIGHTS` (`finance: 4, tech: 3, education: 2, sports: 1`) and
  `WIDGET_ORDER` (`['finance', 'tech', 'education', 'sports',
  'finance']`) — the picker is biased so finance is most likely
  to appear in the ticker.
- Helpers: `esc`, `safeHref` (only allows `http(s)://`).
- `loadHeadlines()` — populates the module-level `headlines` array.
- `pickWeighted(candidates)`, `tileHtml`, `renderTile`,
  `rotateTile` — the ticker. The first 8 headlines are the
  candidate window; `pickWeighted` chooses 3 distinct items, the
  cursor advances by 3.
- `renderWidget()` — fills `#homeNewsList` (using `.news-links`,
  `.news-headline`, `.news-src`) and updates `#homeNewsDate` to
  the short month + day.
- `refresh`, `start`. `start()` kicks off the ticker
  (`setInterval(rotateTile, 30000)`) and the refresh
  (`setInterval(refresh, 30 * 60 * 1000)`).
- Exposes `window.NewsTicker = { refresh, isLoaded }` so a future
  control can force-refresh.

### Depends on

`/api/news`.

### What depends on it

The DOM (`#homeNewsList`, `#homeNewsDate`, optionally
`#newsTicker`). No other JS file calls it.

---

## `goals.js`

Full CRUD for the goals widget. The simplest module to read after
`portfolio-shared.js`.

### What it does

Adds a goal, nudges its progress in 10% steps, deletes it. Every
action round-trips through `/api/goals` (GET / POST / POST :id /
DELETE :id), and the server returns the full updated list which is
re-rendered.

### Key things to look at

- Looks up DOM IDs up front: `#goalList`, `#goalForm`,
  `#goalInput`, `#goalsCount`. Bails if the form isn't on the
  page.
- `STEP = 10` is the +/- delta.
- `esc`, `api(method, url, body)` — tiny JSON wrapper around
  `fetch`.
- `render(goals)` writes `#goalsCount` and `#goalList` with
  `.goal-item` rows: `.goal-name`, `.goal-bar` > `.goal-fill`
  (width via inline `--w: N%`), `.goal-pct`, two `.goal-step`
  buttons (`data-delta="±10"`), and `.goal-del`.
- `load()` does `GET /api/goals`.
- Form submit handler does `POST /api/goals` with `{ name }`,
  then clears the input and re-renders.
- List click handler delegates: `.goal-del` does
  `DELETE /api/goals/:id`; `.goal-step` reads the current
  percentage from the DOM, clamps `0..100`, and does
  `POST /api/goals/:id` with `{ progress }`.

### Depends on

`/api/goals` (and `/api/goals/:id`).

### What depends on it

The DOM only — no other JS file imports it.

---

## `plan-home.js`

The "by class" home-grid card. Renders each course's next few
to-dos with a date.

### What it does

Fetches `/api/plan`, paints one row per course (`#planHome` /
`.ph-grid`) with its top dated items, and refreshes every 5
minutes.

### Key things to look at

- Looks up `#planHome` at the top; bails if missing. Reads
  `data-limit` (default 2) to decide how many items per course.
- `HEX` color map (`cyan`, `amber`, `magenta`, `violet`, `green`,
  `blue`) — the server tells it which key each course uses; falls
  back to cyan.
- `esc`, `short(ds)` (e.g. "Sep 12") — helpers.
- `render(d)` outputs `.ph-course` blocks with `.ph-name`,
  `.ph-d` (+ `.over` if `i.date < d.today`), `.ph-t`, or a
  `.ph-none` placeholder. Sets `#planMeta` to `"N CLASSES"`.
- `load()` — `fetch('/api/plan')` → `render(d)`. Shows
  `d.error` verbatim if the server reports one (the mock server
  returns `{ error: 'No classes to plan from yet.' }`).
- Initial `load()` plus `setInterval(load, 5 * 60 * 1000)`.

### Depends on

`/api/plan`.

### What depends on it

The DOM only.

---

## `view.js`

The phone-vs-desktop router. Tiny, but interesting because it
controls the very first paint.

### What it does

Decides whether to serve `mobile.html` or `index.html` based on a
saved preference (`localStorage`), an explicit `?view=…` query
param, or a phone sniff. `index.html` calls
`JarvisView.route('desktop')` immediately after this script
loads, so the redirect (if any) happens before any styles or
content paint.

### Key things to look at

- `KEY = 'jarvis-view'`.
- `get()` / `set(v)` are wrapped in `try/catch` so private-mode
  browsers don't blow up.
- `isPhone()` — `matchMedia('(max-width: 720px)')` plus a UA sniff
  for `iPhone|iPod|Android.+Mobile`.
- `wanted()` — `?view=desktop|mobile` wins, then localStorage,
  then the phone sniff.
- Public `route(page)` does a `location.replace` if `wanted()`
  doesn't match.
- Public `switchTo(v)` is what the "PHONE VIEW" / "DESKTOP VIEW"
  chips call: set the choice and navigate.

### Depends on

`localStorage`, `location`, `matchMedia`, `navigator.userAgent`.

### What depends on it

`index.html` (`route('desktop')` in `<head>`, `switchTo('mobile')`
on the "PHONE VIEW" chip).

---

## Tooling

## `dev-server.js`

A small Node HTTP server so you can open the dashboard in a
browser without wiring up Canvas, Gmail, Google Calendar, or a
price feed. It serves every file in the repo and answers every
`/api/*` call with an honest empty state.

### What it does

`node dev-server.js` listens on port `8765`. Static files are
served straight from this directory; everything under `/api/*`
returns the JSON defined in the `mock` map (or a `{ error: "Not
implemented in mock server: …" }` for unmapped paths).
`/api/canvas/courses/:id/assignments` is handled specially —
it always returns `[]`.

### Key things to look at

- `PORT = 8765`, `ROOT = __dirname`.
- `mock` — every endpoint the dashboard calls: `/api/schedule`,
  `/api/courses/all`, `/api/calendar/events`, `/api/plan`,
  `/api/news`, `/api/holdings`, `/api/prices`,
  `/api/portfolio/history`, `/api/goals`, `/api/gmail/messages`.
  Each one is the empty value its consumer expects (e.g.
  `/api/news` returns `{ headlines: [] }` so `news.js`'s array
  check works; `/api/calendar/events` returns
  `{ error: 'Google Calendar not connected.' }` so `extras.js`
  shows that exact message).
- `MIME` map for `.html`, `.css`, `.js`, `.json`, `.png`, `.svg`,
  `.ico`.
- `serveFile(req, res, filePath)` reads with `fs.readFile` and
  writes a 200 or 404.
- The handler sets CORS headers (`Access-Control-Allow-Origin: *`,
  `Access-Control-Allow-Headers: Content-Type`) for local dev.
- Path-traversal guard: refuses any `filePath` that escapes
  `ROOT`.
- `index.html` request is served when `/` is requested.
- Startup banner prints the URL and a reminder that all API
  responses are honest empty states.

### Depends on

Only Node built-ins (`http`, `fs`, `path`, `url`).

### What depends on it

You, when you run the dashboard locally.

---

## Repo files

## `README.md`

The top-level entry point. Already written.

### What it does

Explains what the repo is (a labeled local copy of the live
dashboard), how to run it (`node dev-server.js` then
`http://localhost:8765/index.html`), what won't work without a
real backend, and a recommended reading order across the files
(this guide's siblings and the JS modules).

### Key things to look at

- "What's here" table mapping paths to roles.
- "Run it locally" block.
- "How to read the code (recommended order)" — the canonical
  reading path through the JS modules.
- "Things that won't work in this copy" — the list of APIs that
  need a real server.

### Depends on

Nothing.

### What depends on it

You, and links from `docs/FILE-GUIDE.md`.

---

## `LICENSE`

MIT. Three lines: copyright, permission, liability disclaimer.

### What it does

Says the code is MIT-licensed. Standard text.

### Depends on

Nothing.

---

## `.gitignore`

Ignores OS noise (`.DS_Store`, `Thumbs.db`), editor folders
(`.vscode/`, `.idea/`, swap files), Node `node_modules/` and
`package-lock.json`, Python `__pycache__/` and `*.pyc`, and
build outputs `dist/` and `build/`. There's no Node code in the
repo besides `dev-server.js`, but the entries are there in case
you add tooling.

### Depends on

Nothing.

---

That's every file. If something here doesn't match what's on disk,
the code wins — this guide is just a map.
