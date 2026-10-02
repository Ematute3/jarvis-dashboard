//! Native bridge commands for the JARVIS dashboard.
//!
//! Each command is invoked from the remote web page via `window.__TAURI__`
//! using `invoke('plugin:jarvis|open_native', { ... })` (after the function is
//! registered with `tauri::generate_handler!`). The dispatch shape is:
//!
//!     invoke('plugin:jarvis|open_native', { target: 'calendar' })
//!     invoke('plugin:jarvis|open_native', { target: 'url', url: 'https://...' })
//!
//! All commands return `Result<String, String>` so the JS side can pattern-match
//! on success/error strings without dealing with structured errors.

use std::process::Command;

/// Dispatch a native macOS open action.
///
/// `target` selects the action; `path` and `url` carry the optional payload
/// (most targets need exactly one of them).
#[tauri::command]
pub async fn open_native(
    target: String,
    path: Option<String>,
    url: Option<String>,
) -> Result<String, String> {
    match target.as_str() {
        "url" => open_url(url.as_deref()),
        "finder" => reveal_in_finder(path.as_deref()),
        "calendar" => open_app("Calendar.app", None),
        "mail" => open_app("Mail.app", None),
        "reminders" => open_app("Reminders.app", None),
        "terminal" => open_app("Terminal", path.as_deref()),
        "vscode" => open_vscode(path.as_deref()),
        "file" => open_file(path.as_deref()),
        other => Err(format!("Unknown target: {other}")),
    }
}

/// Open `url` in the system's default browser.
fn open_url(url: Option<&str>) -> Result<String, String> {
    let Some(url) = url else {
        return Err("Missing 'url' argument for target=url".into());
    };
    let mut cmd = Command::new("open");
    cmd.arg(url);
    run(&mut cmd, format!("Opened {url}"))
}

/// Reveal `path` in a new Finder window (selecting it if it's a file).
fn reveal_in_finder(path: Option<&str>) -> Result<String, String> {
    let Some(path) = path else {
        return Err("Missing 'path' argument for target=finder".into());
    };
    let mut cmd = Command::new("open");
    cmd.arg("-R").arg(path);
    run(&mut cmd, format!("Revealed {path} in Finder"))
}

/// Launch a macOS .app bundle, optionally with a working directory.
fn open_app(bundle: &str, cwd: Option<&str>) -> Result<String, String> {
    let mut cmd = Command::new("open");
    if let Some(cwd) = cwd {
        cmd.arg("--cwd").arg(cwd);
    }
    cmd.arg("-a").arg(bundle);
    run(&mut cmd, format!("Opened {bundle}"))
}

/// Open `path` with the system's default app.
fn open_file(path: Option<&str>) -> Result<String, String> {
    let Some(path) = path else {
        return Err("Missing 'path' argument for target=file".into());
    };
    let mut cmd = Command::new("open");
    cmd.arg(path);
    run(&mut cmd, format!("Opened {path}"))
}

/// Open VS Code via the `code` shell command.
fn open_vscode(path: Option<&str>) -> Result<String, String> {
    let mut cmd = Command::new("code");
    if let Some(path) = path {
        cmd.arg(path);
    }
    let msg = match path {
        Some(p) => format!("Opened VS Code at {p}"),
        None => "Opened VS Code".to_string(),
    };
    run(&mut cmd, msg)
}

/// Spawn `cmd`, mapping a non-zero exit into an error string.
fn run(cmd: &mut Command, success_msg: String) -> Result<String, String> {
    match cmd.spawn() {
        Ok(_) => Ok(success_msg),
        Err(e) => Err(format!("Failed to launch: {e}")),
    }
}