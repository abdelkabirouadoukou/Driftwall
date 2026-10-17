# Phase 1 — Scaffold (Tauri v2) — report

Branch: `phase-1-scaffold`
Scope: stand up the Driftwall app skeleton (no playback yet). Clean-room: only
observed behavior informed this; no code/assets were taken from the original
app. The SpeDoro reference was used **only** for Tauri v2 idioms (config, tray,
plugin wiring), not copied.

## What was built

### Repository / tooling
- Converted the repo to a **pnpm workspace**: `app/` (Tauri app), `contracts/`
  (`@driftwall/contracts`), plus a minimal root `package.json`
  (`packageManager: pnpm@12.14.0`).
- Fixed the placeholder `app/.gitignore` / `backend/.gitignore` (they ignored
  everything) and updated the root `.gitignore` from the old Swift/Xcode entries
  to Tauri/Node entries (`app/dist`, `app/src-tauri/{target,gen}`, `node_modules`).
- `docs/spec/environment-and-constraints.md` updated: **AMENDMENT 2** records
  Tauri v2 + React + TS + Vite as the current stack and preserves the old Swift
  plan under a clearly-marked "Superseded history" section.

### Contracts (`contracts/`)
- `dwpkg.ts` — canonical TypeScript types for the `.dwpkg` manifest
  (`id`, `type`, `files`, `tags`, `loop`, `displays`, …).
- `dwpkg.manifest.schema.json` — draft-07 JSON Schema mirroring the types
  (UUID ids, relative-only paths, SHA-256 digests, loop only for `video`, etc.).
- `index.ts` — re-exports types + `manifestSchema`.

### App (`app/`) — Tauri v2 + React + TypeScript + Vite
- `src-tauri/tauri.conf.json`: productName **Driftwall**, identifier
  **`app.driftwall.desktop`**, `bundle.macOS.minimumSystemVersion = "12.0"`,
  dmg target, asset protocol scoped to `$APPDATA/**`, **updater disabled**.
- `vite.config.ts`: build target **`safari15`** (macOS 12 WebKit), fixed dev
  port 5173.
- `src-tauri/src/main.rs`: system tray (template icon, Show/Quit), Dock-mode
  toggle (`Regular`/`Accessory` via `set_dock_mode`/`get_dock_mode`), hide on
  close, reopen from Dock. SQLite migrations: `wallpapers`
  (`id, type, file_path, title, tags, width, height, duration, created_at`) and
  a small `settings` table.
- Plugins: `dialog`, `fs`, `process`, `sql` (sqlite) — capabilities in
  `capabilities/default.json`.
- UI: sidebar (Library, Settings), dark theme with the system font stack,
  empty states, wallpaper grid with rename/delete. Settings exposes the
  Dock-mode switch.
- Library logic: import via file dialog → validate format → copy into
  `$APPDATA/wallpapers/<uuid>.<ext>` → probe dimensions/duration + render a
  thumbnail (canvas for images, `<video>` seek for video) → insert row.
  Thumbnails stored at `$APPDATA/thumbnails/<uuid>.thumb.png`. Unsupported /
  undecodable files are rejected with a clear message (no transcoding).
- Icons generated from scratch (`icons/generate_icons.py`, PIL + `iconutil`).

### CI (`.github/workflows/`)
- `nightly.yml` (push to `main`) and `release.yml` (tags `v*`): macOS,
  `x86_64-apple-darwin` + `aarch64-apple-darwin`, pnpm, **unsigned** dmg,
  updater/signing env removed.

## Verification (run locally)

| Step | Command | Result |
|---|---|---|
| Install | `pnpm install` | ok (3 workspace projects) |
| Unit tests | `pnpm --filter driftwall-app test` | **36 passed / 3 files** |
| Frontend build | `pnpm --filter driftwall-app build` | ok (`dist/` emitted, ~239 kB js) |
| Rust check | `cargo check` (in `app/src-tauri`) | ok, no warnings |

Tests cover manifest validation (valid video/static, bad UUID, absolute/`..`
paths, bad sha256, empty files, duplicate tags, loop-on-static, non-positive
loop end, unknown scale modes) and library logic (extension/media
classification, filename derivation, tag (de)serialisation, UUID v4).

## Not done (by design / next)

- **Playback window** (Phase 2). No wallpaper is rendered on the desktop yet.
- `pnpm tauri dev` and a full `pnpm tauri build` (dmg) were **not** run here
  (long-running GUI / long release build). The user runs `tauri dev`; the
  dmg is exercised by CI.

## Risks / things to confirm at runtime

1. **fs scope for import.** `fs:allow-copy-file` is scoped `**` so imports work
   from arbitrary source locations (incl. external volumes). If an import from
   a particular location fails, widen/narrow the scope in
   `capabilities/default.json`.
2. **Codec acceptance.** We accept `mp4/mov/m4v` by extension and then verify
   the WebView can decode them; anything the WebView can't decode (e.g.
   non-H.264/HEVC) is rejected and reported. This is intended, but worth
   confirming with a real HEVC file on this machine.
3. **`crypto.randomUUID`** is used when available with a `getRandomValues`
   fallback (macOS 12 Safari 15.4+ has `randomUUID`).
4. **CI pnpm version** resolves from the root `packageManager` field; pin if the
   runner's pnpm differs.
5. **`bundle.targets` is `["dmg"]`** (macOS only). No `.app` zip artifact.

## How to run (user)

```sh
# from the repo root
pnpm install

# dev app (launches the GUI)
cd app && pnpm tauri dev
```

Then: import an image and a video, confirm thumbnails, rename/delete, toggle
"Show in Dock", close the window (should hide, not quit), and reopen from the
tray.
