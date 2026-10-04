# Cron: hourly calendar refresh

> Keeps `/api/calendar/aggregated` warm so the home widget shows
> fresh Canvas assignments, Google Calendar events, and US holidays on
> every poll — no cold-start wait, no stale data.

The script lives at `cron/refresh-calendar.js` and is scheduled by a
launchd LaunchAgent that fires once an hour.

---

## What it does

Every 60 minutes the LaunchAgent invokes
`node cron/refresh-calendar.js`, which:

1. `POST`s `JARVIS_URL/api/cron/refresh-calendar` so the server can
   invalidate any in-memory cache it owns.
2. If the server returns `404` (the cron endpoint hasn't been added
   yet), falls back to `GET JARVIS_URL/api/calendar/aggregated`.
   That read causes the server to cache its own result internally.

Both paths log a one-line timestamp, status code, and (when known)
the number of events in the result. Exit `0` on success, `1` on any
network, HTTP, or parse failure — so launchd's stdout captures the
heartbeat and any outage in `/tmp/jarvis-cron.log`.

`JARVIS_URL` defaults to `http://127.0.0.1:8765`. Set it in the
plist to a Tailscale IP (e.g. `http://100.x.x.x:8765`) when the Mac
mini is remote.

---

## Why we need it

The front-end polls `/api/calendar/aggregated` on the home widget.
Without a periodic refresh, the cache only rebuilds when something
explicitly invalidates it — so events created elsewhere (a Canvas
assignment added at 2pm, a holiday sliding into the visible window,
a last-minute Google Calendar invite) won't appear until something
else pokes the cache. The hourly cron guarantees the next poll
never sees data more than an hour stale.

---

## Install

```bash
cp cron/local.jarvis.dashboard.refresh.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/local.jarvis.dashboard.refresh.plist
launchctl list | grep jarvis  # verify it's running
```

The plist points at `/usr/local/bin/node`. On Apple Silicon
(`/opt/homebrew/bin/node`) or an nvm install (`~/.nvm/.../bin/node`),
edit the first `ProgramArguments` entry and reload.

---

## Run now (one-off)

```bash
node cron/refresh-calendar.js
```

Override the URL with:

```bash
JARVIS_URL=http://100.x.x.x:8765 node cron/refresh-calendar.js
```

---

## Logs

```bash
tail -f /tmp/jarvis-cron.log
```

`StandardOutPath` and `StandardErrorPath` both point at the same
file, so one `tail` covers both.

---

## Disable

```bash
launchctl unload ~/Library/LaunchAgents/local.jarvis.dashboard.refresh.plist
```

The plist stays in `~/Library/LaunchAgents/`; unload it again to
silence the hourly run, or delete the file to remove the job
entirely.