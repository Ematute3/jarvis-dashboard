# JARVIS — Master Dashboard (learning copy)

> A personal "HUD-style" dashboard. This repo is a **local, labeled copy** of the live
> dashboard at `jarviss-mac-mini.taile919c2.ts.net:8765`, captured so you can read,
> search, and learn from it on your own machine.

## What's here

This is a **front-end-only snapshot**. The dashboard talks to a small server (Canvas,
Gmail, Google Calendar, a price feed, a goals JSON file) which lives elsewhere. To make
this copy actually runnable on your laptop, a tiny `dev-server.js` is included that
serves every file in this folder and replies to every API call with an honest empty
state. Nothing is wired up to the real services.

| Path | What it is |
| ---- | ---------- |
| `index.html` | The desktop layout (12-column dashboard). |
| `mobile.html` | Referenced by `view.js`; not in this copy — falls back to `index.html` if you open it directly. |
| `*.css`       | Four stylesheets, each scoped to a layer (tokens, home, extras, desktop). |
| `*.js`        | Seven small JS modules, each owning one widget or one data source. |
| `manifest.json` | PWA manifest (install-to-home-screen, dark theme). |
| `dev-server.js` | Node mock server so you can open the page in a browser. |
| `docs/`       | Architecture, file guide, and data-flow notes. |

## Run it locally

```bash
cd jarvis-dashboard
node dev-server.js
# open http://localhost:8765/index.html
```

The page will load with every widget in its empty state (no classes, no calendar,
no portfolio, no news) — but the layout, animations, and interactions all work.
That's the point: you can see how each module is structured without needing any
of the live services connected.

## How to read the code (recommended order)

1. **`index.html`** — the static skeleton. Notice the `<header>` (top bar with chips),
   the `<section class="hero">` (greeting + next-up tiles), and the grid of
   `<a class="widget">` cards. Almost every card is a link to a dedicated page
   (classes, calendar, email, …) that lives on the live server.
2. **`styles.css`** — design tokens (cyan / blue / orange palette) and the base
   shell (top bar, panel, glassmorphic surfaces, glows). Most "what does a JARVIS
   card look like" questions are answered here.
3. **`desktop.css`** — the 12-column grid and the per-widget desktop sizing.
4. **`extras.css` + `home.css`** — shared next-up tile + list styles and the
   compact list/card overrides.
5. **`view.js`** — picks mobile vs desktop and remembers the choice in
   `localStorage`. Tiny but interesting.
6. **`portfolio-shared.js`** — a self-contained data layer that loads holdings +
   prices, merges them, and exposes derived totals (market value, day change,
   cost-basis gain). Good example of a small "model" module.
7. **`app.js`** — clock, portfolio sparkline, hover text-scramble effect.
8. **`academics.js`** — schedule, courses, assignments, notification panel. This
   is the largest module and the most representative of how a widget is wired:
   load JSON, render a list, dispatch a `home:*` event so other modules can
   react.
9. **`extras.js`** — hero, next-up tiles, the weekly grid, course-progress rings,
   events list, mini-month, Gmail preview. Big, but every function is a small,
   well-named unit (`renderNext`, `renderWeek`, `renderRings`, …).
10. **`news.js`, `goals.js`, `plan-home.js`** — three small, focused modules
    that are good to read last because they show the same "load → render →
    update" pattern in miniature.

For the "why" of the structure (data flow, module boundaries, what each API
endpoint returns), see:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — big picture, data flow.
- [`docs/FILE-GUIDE.md`](docs/FILE-GUIDE.md) — every file, one paragraph each.
- [`docs/DATA-FLOW.md`](docs/DATA-FLOW.md) — what every API call returns.

## Why a JARVIS dashboard

The visual style is inspired by the Iron Man HUD: dark matte background, razorthin
cyan borders, soft glow, monospace captions. Every surface is translucent so the
animated background (drifting orbs + a slow scan line) shows through. The aesthetic
carries the structure: cyan = calm / informational, orange = urgent / due soon,
the corner ticks on each panel are a deliberate callback to sci-fi instrumentation.

## Things that won't work in this copy

These all need a real backend that isn't included here:

- `/api/canvas/*` — your school Canvas account (currently UCR / elearn).
- `/api/calendar/events` — Google Calendar.
- `/api/gmail/messages` — Gmail.
- `/api/holdings`, `/api/prices`, `/api/portfolio/history` — your portfolio
  tracker, backed by Finnhub on the live server.
- `/api/goals` — `data/goals.json` on disk on the live server.

The mock server replies to all of them with an empty state so the UI is honest
about what's missing instead of showing fake data.

## License

MIT. See `LICENSE`.
