# Icons

Placeholder icons so the Tauri build does not fail before the `@tauri-apps/cli`
is installed.

All files in this directory were generated from a flat solid-color PNG that
was synthesised at scaffold time (the repo did not actually ship an
`apple-touch-icon.png`). They are visually identical dark-blue squares — fine
for development but **not** what you want in the final shipped app.

## Regenerating proper icons

Once `npm install` has run (which installs `@tauri-apps/cli`), drop a real
`apple-touch-icon.png` (≥1024×1024, ideally with a transparent background and
your real mark) and run:

```bash
npm run icon
```

That script invokes `tauri icon ./apple-touch-icon.png` and overwrites every
file in this directory with correctly-sized versions plus a fresh
`icon.icns` / `icon.ico`.

## Files in this directory

| File             | Purpose                                                       |
| ---------------- | ------------------------------------------------------------- |
| `32x32.png`      | Linux / general 32px                                          |
| `128x128.png`    | Linux / general 128px                                         |
| `128x128@2x.png` | Linux / general 256px (Retina)                                |
| `icon.png`       | Tauri default source icon                                     |
| `icon.icns`      | macOS bundle icon (generated from iconset via `iconutil`)     |
| `icon.ico`       | Windows icon (Vista+ PNG-embedded ICO)                        |