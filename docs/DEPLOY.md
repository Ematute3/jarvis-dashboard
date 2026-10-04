# Deploy

> A self-contained redeploy prompt for the JARVIS dashboard backend.
> Copy the body of this file into a fresh MiniMax session on Evan's
> Mac mini to bring the dashboard back up at
> `http://jarviss-mac-mini.taile919c2.ts.net:8765/`.
>
> See the [README](../README.md), the server reference in
> [SERVER](SERVER.md), and the onboarding prompt in [PROMPT](PROMPT.md).

---

## Preamble

Redeploy the JARVIS dashboard on this Mac mini. Clone (or pull) the
repo, install dependencies, run the server, verify it's reachable,
report back. The goal is that the dashboard serves the same data the
user has been seeing at
`http://jarviss-mac-mini.taile919c2.ts.net:8765/`. If anything is
misconfigured, say so plainly — do not invent a fix that changes the
shape of the system. Bring up `server.js`; do not redesign it.

---

## System context

JARVIS is a personal HUD-style dashboard — a single page that pulls
classes, calendar, Gmail, portfolio, news, and goals into one dark,
glassy grid. The aesthetic borrows from the Iron Man HUD: matte
charcoal background, razorthin cyan borders, soft glow, monospace
captions.

- **Front-end.** Vanilla HTML / CSS / JS. No framework, no bundler.
  One small module per widget (`app.js`, `academics.js`, `extras.js`,
  `news.js`, `goals.js`, `plan-home.js`, `portfolio-shared.js`,
  `view.js`).
- **Back-end.** A single `server.js` in Node.js + Express. Serves the
  static dashboard, implements the Google OAuth loopback flow, exposes
  Google Calendar and Gmail endpoints, and proxies `/api/chat` to
  MiniMax with a tool-calling loop. **Everything that needs an API
  key goes through this server — the browser never calls MiniMax
  directly.**

Source: `https://github.com/Ematute3/jarvis-dashboard.git`, local
parent of your choice (`~/projects/` is the default).

Required on the Mac mini: **Node.js 18+** (the server uses native
`fetch`), **npm**, **git**, and — for phone access — **Tailscale**
(almost certainly already installed, since the live URL is a Tailscale
hostname). There is no build step; `node server.js` is the whole
runtime.

---

## Step-by-step redeploy

### 1. Get the code

```bash
mkdir -p ~/projects && cd ~/projects
git clone https://github.com/Ematute3/jarvis-dashboard.git
# Already cloned: cd jarvis-dashboard && git pull
```

If `git pull` reports a dirty tree, stash first, pull, then unstash.
Do not `git reset --hard`.

### 2. Confirm Node

```bash
node --version   # must be v18 or newer
```

Older versions fail with `fetch is not a function`. Install Node 20
(`brew install node@20` or `nvm install 20`) rather than patching
`server.js`.

### 3. Install dependencies

```bash
cd ~/projects/jarvis-dashboard
npm install
```

Pulls in `express`, `googleapis`, `cookie-parser`, `dotenv`. No
dev/prod split.

### 4. Configure environment

Create `.env` at the repo root if missing. Minimum:

```env
MINIMAX_API_KEY=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Optional, with defaults:

```env
PORT=8765
MINIMAX_BASE_URL=https://api.MiniMax.io/v1
MINIMAX_MODEL=...
GOOGLE_REDIRECT_URI=http://127.0.0.1:8765/oauth/callback
TOKEN_STORE_PATH=./tokens.json
TOOL_MAX_ITERATIONS=10
```

Never paste real keys into chat output. `.gitignore` already excludes
`.env`. If `.env` is missing, the server still starts — `/api/chat`
returns a "not configured" error and keys can be filled in later from
`/settings.html` (see **Configuration**).

### 5. Start the server

```bash
cd ~/projects/jarvis-dashboard
node server.js
```

Expected log:

```
JARVIS server listening on http://localhost:8765
→ http://localhost:8765/index.html
```

For anything that should survive across reboots, see **Persistence
options**.

### 6. Confirm it's listening

```bash
lsof -nP -iTCP:8765 -sTCP:LISTEN
```

Expect one `node` row on port `8765`. Empty result → check the log
(usually `EADDRINUSE` or a missing module).

### 7. Smoke-test the endpoints

```bash
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:8765/index.html
curl -sS http://localhost:8765/api/config
curl -sS -X POST http://localhost:8765/api/chat \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"hi"}]}'
```

Expected:

- `/index.html` → `200`
- `/api/config` → `200` JSON with masked booleans (empty defaults OK)
- `/api/chat` → `200 { ok: true, reply, tool_calls: [] }` if the key
  is set; otherwise a plain "not configured" error, not a stack trace.

### 8. Verify Tailscale reachability

```bash
tailscale ip -4   # the 100.x.x.x magic IP
```

From another device on the tailnet, open
`http://jarviss-mac-mini.taile919c2.ts.net:8765/index.html` (MagicDNS
hostname → same IP). It should load the same HTML as `localhost`. If
not, run `tailscale status` on the Mac mini.

---

## Persistence options

`node server.js` in a foreground terminal dies with the session. Pick
one.

### Option A — `launchd` (recommended)

A user-level LaunchAgent starts the server at login and restarts on
crash. Save as `~/Library/LaunchAgents/local.jarvis.dashboard.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>local.jarvis.dashboard</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/evanmatute/projects/jarvis-dashboard/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/evanmatute/projects/jarvis-dashboard</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key>
  <string>/Users/evanmatute/Library/Logs/jarvis-dashboard.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/evanmatute/Library/Logs/jarvis-dashboard.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
```

Then:

```bash
# Adjust the node path for Apple Silicon (/opt/homebrew/bin/node) or
# nvm-managed installs — find it with: which node

launchctl unload ~/Library/LaunchAgents/local.jarvis.dashboard.plist 2>/dev/null
launchctl load   ~/Library/LaunchAgents/local.jarvis.dashboard.plist
tail -f ~/Library/Logs/jarvis-dashboard.log
```

Stop later with `launchctl unload …plist`.

### Option B — `nohup` (simplest, dies on logout)

```bash
cd ~/projects/jarvis-dashboard
nohup node server.js > ~/Library/Logs/jarvis-dashboard.log 2>&1 &
```

Survives the terminal closing; does not survive logout. Demo only.

### Option C — `pm2` (supervisor)

```bash
npm install -g pm2
cd ~/projects/jarvis-dashboard
pm2 start server.js --name jarvis-dashboard
pm2 startup   # follow the printed instructions
pm2 save
```

Useful: `pm2 status`, `pm2 logs jarvis-dashboard`,
`pm2 restart jarvis-dashboard`, `pm2 stop jarvis-dashboard`. Adds free
crash restarts, log rotation, and a startup hook — at the cost of
another moving piece.

---

## Configuration

Runtime config (MiniMax key, Google OAuth, Canvas, optional Legacy
JARVIS base URL) lives in `data/config.json`, not `.env`. The user
edits it in the browser at `http://localhost:8765/settings.html` (or
the Tailscale URL). The page POSTs changes to the server, which writes
`data/config.json` atomically and reloads.

Settings page fields:

- **MiniMax API key** — required for chat (`sk-…`-shaped).
- **MiniMax base URL** — defaults to `https://api.MiniMax.io/v1`.
- **MiniMax model** — defaults to the server's hard-coded value.
- **Google Client ID / Client Secret** — required for Calendar and
  Gmail; must match a Web-application OAuth client.
- **Google redirect URI** — defaults to
  `http://127.0.0.1:8765/oauth/callback`; must be listed verbatim in
  the OAuth client's authorized redirect URIs.
- **Canvas API key** — optional; reserved for future use.
- **Legacy JARVIS base URL** — optional. If set, the dashboard proxies
  some calls to a separate JARVIS-shaped backend. Leave blank to use
  this server for everything.

**Environment wins on first start.** If a key exists in `.env` but not
in `data/config.json`, the server seeds the config file from the
environment on boot. After that, the Settings page is authoritative —
later `.env` edits do not overwrite what the user typed in the browser.

For the wire-format of each `/api/*` route, see [SERVER](SERVER.md).

---

## Verification checklist

Work every one of these before reporting success. If any fails, stop
and report the exact command output — do not paper over it.

1. **Static page loads.** `GET /index.html` returns `200`.
2. **Config endpoint responds.** `GET /api/config` returns JSON with
   masked booleans. Empty defaults are fine on first boot.
3. **Chat works** (only if a key is configured). `POST /api/chat` with
   `{"messages":[{"role":"user","content":"hi"}]}` returns
   `{ ok: true, reply, tool_calls: [] }`. With no key, the error
   should be plain text — not a 500 with a stack trace.
4. **Schedule endpoint responds.** `GET /api/schedule` returns `[]`
   (no real Canvas integration in this server). If a Legacy JARVIS
   base URL is set, the route may return real classes — confirm what
   you see.
5. **Settings page renders.** Open `/settings.html` in a browser —
   no 404, no blank page, no JS error in the console.
6. **Tailscale reachability.** From another device on the tailnet,
   `http://jarviss-mac-mini.taile919c2.ts.net:8765/index.html` loads
   the same HTML. If not, check `tailscale status` on the Mac mini.
7. **Process is alive.** `lsof -nP -iTCP:8765 -sTCP:LISTEN` shows one
   `node` row, PID matching whatever you launched (or whatever `pm2`
   / `launchd` is managing).

---

## Reporting back

Return a short, falsifiable summary containing:

- **PID** of the running server, or the supervisor (`pm2 id`,
  `launchctl print`) if using one.
- **Tailscale IP** (`100.x.x.x`) if Tailscale is running.
- **Local URL** the dashboard is reachable at.
- **Status of `/api/chat`** — `200 with reply` if MiniMax is reachable
  from this machine, `not configured` if the key is missing, or the
  exact error otherwise.
- **Any warnings or errors** from `npm install`, the server boot, or
  the smoke tests. Include the relevant log excerpt, not the entire
  log.

Every claim should be something the user can re-verify with one
command.

---

## Caveats — what NOT to do

- **Don't re-implement OAuth.** The loopback flow in `server.js` is
  the right shape. Don't rewrite it or change the redirect URI unless
  the user explicitly asks.
- **Don't move or rename files.** The repo structure *is* the deploy
  contract: `server.js` at the root, `data/` at the root, `tokens.json`
  next to `server.js`.
- **Don't change ports.** `8765` is hardcoded in the dashboard's
  Settings UI and at `jarviss-mac-mini.taile919c2.ts.net:8765`. If it's
  taken, free it (find the owner with `lsof -nP -iTCP:8765`) rather
  than picking a different port.
- **Don't open ports to the public internet.** The server binds on
  `0.0.0.0` so Tailscale can reach it; do not enable any macOS firewall
  rule that exposes `8765` outside the tailnet unless the user
  explicitly asks.
- **Don't call MiniMax from the browser.** All model traffic goes
  through `/api/chat`; the server is the only place that holds the key.
- **Don't commit `tokens.json`, `.env`, `data/config.json`, or
  `data/goals.json`.** The `.gitignore` already excludes them; verify
  before `git add` on any new file.
- **Don't add new endpoints or change existing shapes** without
  checking [SERVER](SERVER.md) and the consuming JS module first.
  Every route name and JSON key in `server.js` is a public contract
  with the front-end.
- **Don't patch `server.js` for a missing dependency or wrong Node
  version.** Install the right thing instead.
- **Don't "fix" empty states.** Routes without real data (Canvas,
  news, portfolio, schedule) return an empty shape on purpose so the
  dashboard renders a real English message ("No classes today.",
  "News unavailable — check your internet connection.") instead of
  fake data. Leave that contract alone.

If you hit a problem not covered here, stop and report it rather than
guessing a fix.