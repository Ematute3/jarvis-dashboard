# Google Calendar & Gmail — Setup Guide

This guide walks you through wiring the JARVIS dashboard to your real
Google account so `/api/calendar/events`, `/api/calendar/events/new`,
and `/api/gmail/messages` all return real data instead of
`{ error: "not connected" }`.

It is the same loopback OAuth flow Google's own docs call out for
desktop and CLI apps: a `127.0.0.1` redirect URI, an authorization
code exchanged for tokens, and a refresh token kept on disk so the
server doesn't re-prompt you every hour.

---

## TL;DR (if you've done this before)

1. Create a Google Cloud project.
2. **Enable** the **Calendar API** and **Gmail API** for the project.
3. **OAuth consent screen → External**, add yourself as a test user.
4. **Credentials → Create OAuth client → Web application.**
5. Under **Authorized redirect URIs**, add the URI shown on the
   dashboard's **Settings → Google** panel. It must match *exactly*
   (scheme, host, port, and path).
6. Copy the **Client ID** and **Client secret** into the same panel
   and click **Save Google OAuth**.
7. From your browser, open `http://127.0.0.1:8765/oauth/start` (or
   use the "Connect Google" link on the Settings page if your build
   has one — see [Triggering the OAuth flow](#triggering-the-oauth-flow)).
8. Approve both scopes on Google's consent screen.
9. You should land back on the dashboard with `/oauth/status`
   returning `{ connected: true, scopes: [...] }`. `tokens.json` is
   now on disk.

---

## 1. Create a Google Cloud project

1. Open <https://console.cloud.google.com>.
2. Top bar → project dropdown → **New project**.
3. Name it (e.g. `jarvis-dashboard`). Organization can stay on
   **No organization**.
4. Click **Create**, then make sure the new project is selected in the
   dropdown.

---

## 2. Enable the APIs you need

The OAuth client only requests scopes — it doesn't grant anything by
itself. You still have to enable each API on the project:

1. Left menu → **APIs & Services → Library**.
2. Search `Calendar API` → **Google Calendar API** → **Enable**.
3. Search `Gmail API` → **Gmail API** → **Enable**.

If you skip this, Google's token exchange will return
`access_denied` or `invalid_scope` after you approve the consent
screen, and you'll see the error on
`http://127.0.0.1:8765/oauth/callback?error=access_denied`.

---

## 3. Configure the OAuth consent screen

1. Left menu → **APIs & Services → OAuth consent screen**.
2. User type: **External** (you'll only be signing in with your own
   Google account, so you don't need Workspace verification).
3. Fill in the required fields:
   - **App name**: `JARVIS Dashboard`
   - **User support email**: your Gmail address
   - **Developer contact email**: your Gmail address
4. Click **Save and continue**.
5. **Scopes** step: click **Add or remove scopes** and add:
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/gmail.modify`

   These are exactly the two scopes the dashboard requests. Adding
   them here pre-authorizes them on the consent screen so you won't
   get an "unverified app" warning before you can approve them.

6. **Test users** step: add the Gmail address you want to connect.
   While the app is in "Testing" mode, only test users can complete
   the flow. (You can submit for verification later if you want other
   users, but for personal use, Testing + your own email is enough.)
7. Click **Save and continue** through the summary, then **Back to
   dashboard**.

> **Heads up about the "unverified app" screen.** While the app is in
> testing, Google will show a warning page before the consent screen.
> Click **Advanced** → **Go to JARVIS Dashboard (unsafe)** to
> continue. This is expected for personal OAuth clients.

---

## 4. Create the OAuth client

> **Use "Web application", NOT "Service Account".** Service accounts
> don't go through user consent and can't read your personal Gmail or
> write to your primary Calendar. The dashboard's `/oauth/start`
> route builds an authorization URL — that only works for an OAuth
> client where the **User type** is **External** and the
> **Application type** is **Web application** (or **Desktop app**,
> but Web application is what the dashboard assumes).

1. Left menu → **APIs & Services → Credentials**.
2. Click **+ Create credentials → OAuth client ID**.
3. **Application type**: **Web application**.
4. **Name**: `JARVIS Dashboard (local)` (cosmetic).
5. **Authorized JavaScript origins** — leave empty. The dashboard
   doesn't use the JS-origin flow.
6. **Authorized redirect URIs** — click **Add URI** and paste the
   URI shown on the dashboard's **Settings → Google** panel under
   "Redirect URI (add to Google Cloud Console)". By default this is:

   ```
   http://127.0.0.1:8765/oauth/callback
   ```

   **It must match byte-for-byte** — scheme, host, port, and path.
   Common mistakes:
   - `https://127.0.0.1:...` (wrong scheme; Google rejects loopback
     redirects over HTTPS unless the dev URL is HTTPS too)
   - `http://localhost:8765/...` (Google treats `localhost` and
     `127.0.0.1` as **different** origins for loopback redirects)
   - Trailing slash
   - Different port

   If your server is on a different port, edit the
   `googleRedirectUri` field in `runtime-config.json` (or via the
   Settings page if exposed) and re-add the new value here.

7. Click **Create**. A modal shows the Client ID and Client secret.
   Copy both — the secret is shown only once.

---

## 5. Paste the credentials into the dashboard

1. Open `http://127.0.0.1:8765/settings.html`.
2. Scroll to the **Google** panel.
3. Paste the **Client ID** into the Client ID field.
4. Paste the **Client secret** into the Client secret field.
5. Click **Save Google OAuth**.

The dashboard `PUT /api/config` patches `runtime-config.json`. Both
fields are hot-reloaded — no server restart needed.

Verify the **Redirect URI** field under the form matches what you
added to Google Cloud Console. If they don't match, fix one or the
other before continuing.

---

## 6. Triggering the OAuth flow

Saving the keys only stores your OAuth client credentials. The
dashboard still has to send you through Google's consent screen once
to issue an access token and (because we use `access_type=offline` +
`prompt=consent`) a long-lived refresh token.

### Via the "Connect Google" button (if present)

If your build of the settings page shows a **Connect Google** button
or link, click it. It navigates to `/oauth/start`, which 302s you
into Google's consent flow.

### Manually

If there's no button in your build, open this URL in the same
browser that's hitting the server on `127.0.0.1`:

```
http://127.0.0.1:8765/oauth/start
```

This is a `GET` endpoint. It:

1. Verifies that `googleClientId` and `googleClientSecret` are set
   (otherwise it returns 500 with a clear error message).
2. Generates a 32-character hex `state` token, sets it as an
   `httpOnly`, `sameSite=lax` cookie (CSRF protection), and appends
   it to the Google URL.
3. Redirects you to `https://accounts.google.com/o/oauth2/v2/auth`
   with these query params:
   - `client_id` — from your config
   - `redirect_uri` — `http://127.0.0.1:8765/oauth/callback`
   - `response_type=code`
   - `scope=openid%20https://www.googleapis.com/auth/calendar.events%20https://www.googleapis.com/auth/gmail.modify`
   - `access_type=offline` — required to receive a refresh token
   - `prompt=consent` — forces the consent screen even on re-auth, so
     a refresh token is always issued
   - `state=<random>` — verified against the cookie on callback

---

## 7. Approve the consent screen

1. Pick the Google account you added as a test user.
2. Google's "unverified app" warning → **Advanced → Go to JARVIS
   Dashboard (unsafe)**.
3. Review both scopes:
   - "See, edit, share, and permanently delete all the calendars you
     can access using Google Calendar API" — that's
     `calendar.events`.
   - "Read, compose, send, and permanently delete all your email
     from Gmail" — that's `gmail.modify`.
4. Click **Allow**.

Google redirects you back to `http://127.0.0.1:8765/oauth/callback?code=...&state=...`.

The server:

1. Verifies `state` matches the cookie.
2. Calls `client.getToken(code)` to swap the authorization code for
   tokens.
3. Writes `tokens.json` (mode `0o600`) to `TOKEN_STORE_PATH` (default
   `./tokens.json`).
4. Redirects you to `/`.

---

## 8. Verify it worked

From any browser session hitting the dashboard:

```bash
curl http://127.0.0.1:8765/oauth/status
# → {"connected":true,"scopes":["https://www.googleapis.com/auth/calendar.events","https://www.googleapis.com/auth/gmail.modify"]}
```

Then exercise the endpoints:

```bash
curl http://127.0.0.1:8765/api/calendar/events        # events: [...]
curl http://127.0.0.1:8765/api/gmail/messages         # messages: [...]
```

Both should now return real data instead of the
`"Google Calendar not connected."` / `"Gmail not connected."`
error envelope.

---

## What the server stores

`tokens.json` is created on first successful OAuth callback. It looks
like:

```json
{
  "access_token": "ya29....",
  "refresh_token": "1//0g....",
  "scope": "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.modify",
  "token_type": "Bearer",
  "expiry_date": 1730000000000
}
```

The `refresh_token` is the long-lived one — Google only issues it
when `access_type=offline` and `prompt=consent` are both set in the
authorization URL, which is why the server hard-codes both. When the
`access_token` expires, `googleapis` automatically exchanges the
`refresh_token` for a new `access_token` without re-prompting you.

The file is gitignored. It is written with mode `0o600` (owner
read/write only). Don't share it — anyone with the `refresh_token`
has full access to your Calendar and Gmail until you revoke it from
<https://myaccount.google.com/permissions>.

To disconnect, either:

- Delete `tokens.json` and restart the server (or wait — `loadTokens`
  is called on every request, so the next call will see the file is
  gone).
- Revoke the app from
  <https://myaccount.google.com/permissions>. Then delete
  `tokens.json` so the dashboard doesn't keep trying to use the
  revoked token.

---

## Troubleshooting

| Symptom | Likely cause |
| ------- | ------------ |
| `/oauth/start` returns **500 "Google OAuth not configured"** | `googleClientId` or `googleClientSecret` is empty. Save them on the Settings page. |
| `/oauth/start` returns **500 with `redirect_uri_mismatch`** (visible after redirect back) | The URI you added to Google Cloud Console doesn't match `googleRedirectUri` exactly. Check scheme, host, port, path, and trailing slash. |
| Consent screen says **"This app isn't verified"** and won't let you proceed | Expected in testing mode. Click **Advanced → Go to JARVIS Dashboard (unsafe)**. |
| **Error 403: access_denied** | You didn't add yourself as a **Test user** on the OAuth consent screen, or one of the two required APIs isn't enabled. |
| **`refresh_token` is missing from `tokens.json`** | The consent screen was skipped (existing grant). The server sets `prompt=consent` to force it. If you revoked and re-consented without that flag, you won't get a refresh token; clear them and re-consent. |
| **`invalid_grant` on every API call after a day** | The `refresh_token` was revoked. Re-run `/oauth/start`. |
| **Events list is empty but `/oauth/status` is `connected: true`** | Google returned no events in the upcoming window, or the calendar is empty. The dashboard queries `timeMin: now`. Add an event on Google Calendar and refresh. |
| **Gmail returns `messages: []` even when you have mail** | The `gmail.modify` scope was approved, but the `q` parameter is empty — the list endpoint returns the top messages regardless. If you see zero, check that the Gmail account you're using has mail. |
| **Two-factor / passkey prompt loops** | You're not signed into Google in the browser tab. Sign in to <https://accounts.google.com> first, then `/oauth/start`. |

---

## Re-running setup

If anything in Google Cloud Console changes (new project, new
redirect URI, regenerated secret), re-run the flow:

1. Update the keys on the Settings page.
2. Re-save (`PUT /api/config`).
3. Delete `tokens.json` so the old refresh token is gone.
4. Open `/oauth/start` again.

The consent screen may show only the **delta** (newly added scopes)
on re-auth, not the original full list — that's normal.