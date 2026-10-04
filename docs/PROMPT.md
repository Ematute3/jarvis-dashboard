# JARVIS Dashboard — Onboarding Prompt

You are working on **JARVIS**, a personal HUD-style dashboard. Iron Man
aesthetic — matte charcoal background, razorthin cyan borders, soft glow,
monospace captions. Cyan = calm / informational; orange = urgent / due
soon. Every surface is translucent.

## Repo

- Local: `/Users/evanmatute/Documents/Minimax/jarvis-dashboard/`
- Remote: `https://github.com/Ematute3/jarvis-dashboard`

## Tech stack

- **Front-end**: vanilla HTML / CSS / JS. No bundler. No framework.
  Four stylesheets (`styles.css` → `home.css` → `extras.css` →
  `desktop.css`), one module per widget (see FILE-GUIDE.md).
- **Back-end**: Node.js + Express (`server.js`). Implements Google OAuth
  loopback, Google Calendar events, Gmail search + mark-read, and a
  proxy at `/api/chat` that runs an OpenAI-style tool-calling loop
  against the model API.
- **Model API**: OpenAI-compatible, base URL
  `https://api.MiniMax.io/v1`. Talk to it **only** via `/api/chat`.
  Never call it from front-end code.
- **Desktop shell**: Tauri (`src-tauri/`). Rust binary hosts a
  `WKWebView`; JS reaches native macOS via `open_native` command.
- **Persistence**: `data/goals.json` (atomic write). Google OAuth tokens
  in `tokens.json`. Both gitignored.

## User preferences (non-negotiable)

- **Hidden thinking by default.** Do not expose model reasoning in chat
  output. If thinking must be shown, wrap it in a collapsible element
  with this exact shape and behavior:

  ```html
  <details>
    <summary>thinking</summary>
    …reasoning…
  </details>
  ```

  `<summary>` text is the literal uppercase string `thinking`. Element
  is collapsed by default; click to expand. Mirror the daily pattern
  in `chatbot.js`.

- **Module-per-widget architecture.** Each widget is owned by exactly
  one small JS file. That file alone knows its endpoint, its render
  function, and its update hook. Don't mix concerns across files.

- **Honest empty states.** When data is missing, render a real message
  — e.g. `"No classes today."`, `"Connect Canvas in Settings."`,
  `"Google Calendar not connected."`. Never a spinner that never
  resolves, never placeholder / lorem / sample data. The blank text
  *is* the documentation.

- **API keys stay server-side.** Never hardcode MiniMax or Google keys
  in front-end code. Read them from `.env` via `server.js` only.

- **CSS uses design tokens.** All colors and radii come from the `:root`
  block in `styles.css`: `--c-cyan`, `--c-blue`, `--c-orange`,
  `--c-orange-soft`, `--c-bg`, `--surface`, `--glow-cyan`,
  `--glow-orange`, `--r-1`, `--r-2`, `--r-3`, type tokens, etc. Don't
  introduce new ad-hoc hex values.

- **`textContent` for untrusted content.** Never use `innerHTML` to
  inject strings from APIs, user input, email subjects, news
  headlines, assignment titles, or tool output. Use `textContent` or
  `escapeHtml`. The codebase ships an `esc` / `escapeHtml` helper —
  use it.

- **All chat routes through `/api/chat`.** The browser never calls
  MiniMax directly. `chatbot.js` POSTs to `/api/chat`; the server runs
  the tool-calling loop. Don't add a second path to the model.

## Dev workflow

```bash
cd /Users/evanmatute/Documents/Minimax/jarvis-dashboard
npm install
cp .env.example .env   # then fill in MINIMAX_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
node server.js
```

- Dashboard: `http://localhost:8765/`
- Settings (Google OAuth, status): `http://localhost:8765/settings.html`
- Tauri dev shell: `npm run tauri dev`
- Tauri release build: `npm run tauri build` (output under
  `src-tauri/target/release/bundle/`).

Required `.env` values: `MINIMAX_API_KEY`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`. Required Google Cloud redirect URI:
`http://127.0.0.1:8765/oauth/callback`. For Tauri builds add
`http://tauri.localhost/oauth/callback`. Required OAuth scopes:
`…/auth/calendar.events`, `…/auth/gmail.modify`.

## What NOT to do

- **Don't propose OAuth refactors.** OAuth already exists in
  `server.js`. Don't rewrite it.
- **Don't invent new backend endpoints.** If you need data, look for
  an existing route in `server.js` (see SERVER.md) or add one only
  with explicit source for the shape. Stub-only endpoints must return
  honest empty states — not fabricated samples.
- **Don't call the model API from the front-end.** Always through
  `/api/chat`.
- **Don't break the empty-state principle** by adding demo data to
  make the page "look less empty". The empty text is the spec.
- **Don't add new colors** outside the `styles.css` token system.
- **Don't load scripts out of order.** The dependency order matters
  — `portfolio-shared.js` first (so `PortfolioData` exists for
  `app.js`), then `app.js`, `academics.js`, `extras.js`, `news.js`,
  `goals.js`, `plan-home.js`. `view.js` runs synchronously in `<head>`
  before anything else.
- **Don't add new widgets without** picking the owning file, the DOM
  id in `index.html`, the grid class (`.c-…`), and the matching CSS
  layer (`extras.css` if shared, `desktop.css` if desktop-only,
  `home.css` for home-grid tweaks).
- **Don't commit `tokens.json`, `.env`, `data/goals.json`**, or
  anything under `src-tauri/target/`.

## First thing to do when onboarded

1. `git log --oneline -20` and `ls -la` to confirm the working tree.
2. Read `README.md` and `docs/FILE-GUIDE.md` end to end.
3. Skim `docs/ARCHITECTURE.md` (modules, data flow, empty-state rule,
   two faces / router).
4. Skim `docs/SERVER.md` (endpoints, chat loop, token storage).
5. Skim `docs/NATIVE-INTEGRATION.md` only if you'll touch Tauri.
6. Open `index.html` in your head — note the `.c-*` grid classes, the
   top bar chips, the hero section, and the widget ids each module
   targets.

Then make the smallest coherent change that fits the request. Run
`node server.js` (or open the page via the Tauri shell) before
claiming a front-end change works.

## Current directory

You are running in `/Users/evanmatute/Documents/Minimax/jarvis-dashboard/`.
Repo: `https://github.com/Ematute3/jarvis-dashboard`.
First command to run: `git log --oneline -10 && ls -la`.