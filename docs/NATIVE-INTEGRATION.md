# Native Integration

> How the JARVIS dashboard gets wrapped as a Tauri desktop app that can
> launch macOS apps, open files, and reveal things in Finder.
> For the front-end architecture, see [ARCHITECTURE](ARCHITECTURE.md).
> For a one-paragraph summary of every file in the repo, see
> [FILE-GUIDE](FILE-GUIDE.md). For the top-level orientation, see
> the [README](../README.md).

---

## What this is

The JARVIS dashboard now ships as a **Tauri-based `.app` bundle** for
macOS. The HTML/CSS/JS is unchanged — it's still loaded from the
remote URL — but the window is hosted by a native `WKWebView` inside a
small Rust shell (`src-tauri/`). When you click a button on the
dashboard, the JS shim (`native-launcher.js`) calls a Rust command
named `open_native`, which spawns `open`, `code`, or `xdg-open` to
launch a macOS app, open a file in its registered app, or open a URL
in the default browser. The result feels like a normal desktop app:
the dashboard is its own window, and clicking "Open in VS Code" on a
project tile really does open VS Code.

---

## Architecture diagram

```
   ┌────────────────────────────────────┐
   │  macOS user  (double-clicks .app)  │
   └────────────────────────────────────┘
                     │
                     v
   ┌────────────────────────────────────┐
   │  src-tauri  (Rust binary)          │
   │  ┌──────────────────────────────┐  │
   │  │ WKWebView (Tauri renderer)   │  │
   │  │   loads index.html from      │  │
   │  │   https://jarviss-mac-mini…  │  │
   │  └──────────────────────────────┘  │
   │           │                        │
   │           │  window.__TAURI__      │
   │           │  .core.invoke(         │
   │           │   'open_native', …)    │
   │           v                        │
   │  ┌──────────────────────────────┐  │
   │  │  Tauri IPC bridge            │  │
   │  └──────────────────────────────┘  │
   │           │                        │
   │           v                        │
   │  ┌──────────────────────────────┐  │
   │  │  src-tauri/src/commands.rs   │  │
   │  │   match target { … }         │  │
   │  └──────────────────────────────┘  │
   │           │                        │
   │           v                        │
   │  ┌──────────────────────────────┐  │
   │  │  std::process::Command       │  │
   │  │   spawns open / code /       │  │
   │  │   xdg-open on macOS          │  │
   │  └──────────────────────────────┘  │
   └────────────────────────────────────┘
                     │
                     v
   ┌────────────────────────────────────┐
   │  macOS                            │
   │   - launches the target .app       │
   │   - opens the file with its       │
   │     registered handler            │
   │   - reveals the path in Finder    │
   └────────────────────────────────────┘
```

Three boundaries to notice:

1. **Renderer ⇄ IPC** — the dashboard JS sees a normal async function
   (`window.__TAURI__.core.invoke('open_native', …)`) that returns a
   promise. Under the hood, Tauri serializes the args as JSON, sends them
   over the IPC channel, and resolves the promise with whatever the Rust
   handler returns.
2. **IPC ⇄ Rust** — `commands.rs` is the only place that does
   filesystem / process work. Everything that touches the OS goes
   through one of the match arms in `open_native`.
3. **Rust ⇄ macOS** — `std::process::Command` shells out. There is no
   Cocoa / AppKit code; we lean on `open(1)` because it already knows
   about LaunchServices (the macOS thing that maps a file extension to
   its registered app).

---

## File map

| Path | One-line description |
| ---- | -------------------- |
| `src-tauri/Cargo.toml` | Rust crate manifest. Declares `tauri = "2"`, `serde`, `serde_json`, the binary name (`jarvis-dashboard`), and the `[lib]` target Tauri needs. |
| `src-tauri/tauri.conf.json` | Tauri build config: window size/title, the remote URL the WebView loads, the bundle identifier (`com.jarvis.dashboard`), icon paths, and the macOS-specific bundle settings. |
| `src-tauri/src/main.rs` | Binary entrypoint. Calls into the lib, registers the Tauri builder, attaches the `commands` module, and starts the event loop. |
| `src-tauri/src/commands.rs` | The `open_native` Tauri command. One `#[tauri::command]` function with a `match` on `target` that fans out to `open` / `code` / `xdg-open` etc. |
| `src-tauri/capabilities/default.json` | The capability allowlist. Declares which Tauri commands the renderer is allowed to invoke — right now, just `["open_native"]`. |
| `native-launcher.js` | Small dashboard JS module. Provides `window.JarvisLaunch.openNative(opts)` which calls `window.__TAURI__.core.invoke('open_native', …)`. Falls back to `console.warn` when the Tauri global is missing (i.e. when the dashboard is loaded in a regular browser). |

---

## The `open_native` command

The Rust signature, as declared in `src-tauri/src/commands.rs`:

```rust
#[tauri::command]
fn open_native(target: String, path: Option<String>, url: Option<String>) -> Result<(), String>
```

It takes a `target` that names the action, plus two optional fields
depending on what `target` needs. It returns `Result<(), String>` —
`Ok(())` on success, `Err(message)` if the underlying `Command::spawn`
failed, in which case the JS promise rejects with that message.

| `target`   | Required field | What it does                                                                                  | Underlying shell call (macOS)               |
| ---------- | -------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `app`      | `path`         | Opens a macOS `.app` bundle. `path` is the absolute path to `…/SomeApp.app`.                   | `open "<path>"`                             |
| `file`     | `path`         | Opens a file with the app registered for its extension (LaunchServices).                      | `open "<path>"`                             |
| `reveal`   | `path`         | Reveals a file/folder in Finder (highlights it in an open Finder window).                     | `open -R "<path>"`                          |
| `code`     | `path`         | Opens a folder or file in VS Code. Requires the `code` CLI on `$PATH`.                        | `code "<path>"`                             |
| `url`      | `url`          | Opens an `http(s)://` URL in the default browser.                                             | `open "<url>"`                              |
| `finder`   | `path`         | Opens Finder at the given directory (no selection).                                          | `open "<path>"`                             |

A few rules baked into the Rust:

- `app` / `file` / `reveal` / `code` / `finder` all require `path`; if
  it's missing or empty, the command returns `Err("path required")`.
- `url` requires `url`; missing or empty → `Err("url required")`.
- Unknown `target` values return `Err("unknown target: <x>")`. The JS
  shim surfaces this to the console so you can see it in the WebView
  devtools.

---

## How to add a new native action

Recipe — do all four steps, in order.

**1. Add a new match arm in `src-tauri/src/commands.rs`.**

Pick a lowercase short name (the new `target` value), add it to the
match, and shell out with `std::process::Command`:

```rust
#[tauri::command]
fn open_native(target: String, path: Option<String>, url: Option<String>) -> Result<(), String> {
    match target.as_str() {
        // …existing arms…
        "terminal" => {
            let p = path.ok_or_else(|| "path required".to_string())?;
            std::process::Command::new("open")
                .args(["-a", "Terminal", &p])
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        other => return Err(format!("unknown target: {}", other)),
    }
    Ok(())
}
```

Add the new arm above the `other` catch-all so it actually matches.

**2. Update the capability allowlist if needed.**

You usually **don't** need to — `open_native` itself is already on the
list, and any new arm you add reuses the same command. You only need
to touch `src-tauri/capabilities/default.json` if you're adding a
*whole new* `#[tauri::command]`, in which case append its name to the
`permissions` array.

**3. Add a button in `index.html` with the right `data-*` attrs.**

`native-launcher.js` looks for `[data-launch]` elements and wires
their click handler. The attribute conventions are:

```html
<button class="widget"
        data-launch="app"
        data-path="/Applications/Things3.app">
  Open Things 3
</button>

<button class="widget"
        data-launch="url"
        data-url="https://github.com/">
  Open GitHub
</button>
```

- `data-launch` — the `target` string. Required.
- `data-path` — the filesystem path. Required for `app` / `file` /
  `reveal` / `code` / `finder`.
- `data-url` — the URL. Required for `url`.

The click handler reads all three attributes and calls
`JarvisLaunch.openNative({ target, path, url })`. Style the button
however the rest of the dashboard is styled — `data-*` attrs don't
force any CSS.

**4. Test it.**

```bash
npm install            # one time
npm run tauri dev      # live-reloads the Rust side; opens a window
```

Click your new button. Watch the WebView devtools (right-click →
Inspect Element, or ⌥⌘I) for the `[jarvis-launch]` log lines and
any rejection from the `invoke` promise.

---

## How the JS shim works

`native-launcher.js` is a tiny module — about 40 lines — and it's
worth reading it whole. Three pieces:

**`window.__TAURI__`** is a global that Tauri's runtime injects into
the WebView **before** your scripts run. Anything under
`window.__TAURI__` is part of the JS-side of the Tauri bridge. We use
`window.__TAURI__.core.invoke(command, args)`, which:

- serializes `args` to JSON,
- sends it over the IPC channel to the Rust side,
- waits for the Rust handler to return,
- resolves the returned promise with the handler's `Ok` value, or
  rejects with the `Err` string.

So from JS, calling a Rust command looks exactly like calling an
async function:

```js
await window.__TAURI__.core.invoke('open_native', {
  target: 'code',
  path:   '/Users/me/projects/jarvis-dashboard'
});
```

**Why the shim exists at all.** The dashboard still loads from the
remote URL, and a regular browser doesn't have `window.__TAURI__`.
`native-launcher.js` checks for the global once at load time:

```js
const isTauri = typeof window.__TAURI__ !== 'undefined'
             && window.__TAURI__.core
             && typeof window.__TAURI__.core.invoke === 'function';
```

If it's missing, the module logs a `console.warn` and stubs
`JarvisLaunch.openNative` so clicks no-op (they don't crash). That's
what makes the same `index.html` work both inside the Tauri window
*and* in a regular browser tab — useful for development and for
viewing the dashboard from anywhere that isn't the Mac mini.

**The `core.invoke` shape.** Always two args: a command name string
and an object whose keys match the Rust parameter names. Tauri maps
the object to the function's parameters by name, so `{ target, path,
url }` lines up with `fn open_native(target: String, path: Option<String>, url: Option<String>)`.

---

## Building and running

All commands run from the repo root (`jarvis-dashboard/`).

```bash
# 1. One time — installs @tauri-apps/cli alongside the rest of the JS deps.
npm install

# 2. Dev loop. Opens a desktop window pointing at the live dashboard URL.
#    The Rust side hot-rebuilds when you touch src-tauri/.
npm run tauri dev

# 3. Release build. Produces:
#      src-tauri/target/release/bundle/macos/JARVIS.app
#      src-tauri/target/release/bundle/dmg/JARVIS_<version>_<arch>.dmg
npm run tauri build
```

The release `.app` is self-contained — drop it in `/Applications/` and
double-click. The `.dmg` is a drag-to-Applications installer you can
hand to other machines.

---

## Caveats

A handful of things to know before you ship:

- **The dashboard still loads from the remote URL.** The Tauri window
  points at `https://jarviss-mac-mini…` (see `tauri.conf.json`). If
  the Mac mini is unreachable, you'll see an empty WebView. This
  isn't a bug — it's the same network dependency the dashboard has
  always had; the `.app` just gives it a desktop window.
- **The mock server (`dev-server.js`) doesn't apply here.** It stubs
  `/api/*` for browser-based development. The Tauri build talks to
  the real backend on the Mac mini, the same way the live dashboard
  does.
- **Icons are placeholders.** Until you run `npm run icon` (which
  generates `src-tauri/icons/*.png` and `.icns` from a source SVG),
  the app icon will be Tauri's default one. The build still succeeds;
  the icon just looks generic.
- **macOS will prompt the first time you open the built `.app`**
  (Gatekeeper, because the binary isn't notarized). One-time fix:

  ```bash
  xattr -dr com.apple.quarantine /Applications/JARVIS.app
  ```

  After that, double-clicking opens it normally. Long-term fix is to
  notarize the bundle with an Apple Developer ID, but that's out of
  scope for this learning copy.
- **CSP is currently permissive** — wide enough to let the Tauri
  runtime inject its scripts and to load the dashboard from its
  remote origin. Before shipping widely, tighten the `Content-Security-Policy`
  in `tauri.conf.json` to the smallest set of sources that actually
  works in your environment.