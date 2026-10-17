# Environment & Constraints

Captured from the operator's amendments. These constrain every later phase.

> **AMENDMENT 2 (current stack).** The implementation stack is **Tauri v2 + React +
> TypeScript + Vite**. This **supersedes** the earlier Swift/Xcode/GRDB plan. The
> original Swift-oriented constraints are preserved below under
> [Superseded history](#superseded-history-swift-plan-amendment-0) for the record; they
> are **no longer binding** except where they informed the macOS-12 API compatibility
> table, which still applies to the Rust/WebKit surface.

## Current stack (AMENDMENT 2)

- **Frontend:** React 19 + TypeScript + Vite (build target **`safari15`** so output runs on
  macOS 12's WebKit).
- **Shell:** **Tauri v2** (Rust). Tray via `tauri::tray`; window/dock-mode control via
  `ActivationPolicy`. Library persistence is owned by Rust: one `Mutex<Library>` in
  managed state, serialised to `library.json` in the app data dir with atomic writes
  (`app/src-tauri/src/store.rs`); media files live alongside it under UUID names.
  Import/copy via `tauri-plugin-dialog` + `tauri-plugin-fs`.
  (SQLite via `tauri-plugin-sql` was dropped in the Phase 1 fix: frontend connections
  locked each other. A single Rust-owned `rusqlite` connection may return later if
  queryable storage is needed.)
- **Package manager:** **pnpm locally** (CI may use pnpm or bun). Repo is a pnpm workspace:
  `app/` (Tauri app) and `contracts/` (`@driftwall/contracts` shared types + JSON Schema).
- **No full Xcode.** Host has **Command Line Tools only**; use `cargo`, `pnpm`, and
  `iconutil`/`sips` for icons.
- **Updater disabled in Phase 1** — unsigned builds, no signing keys / pubkey wired.

## Development host / target

- **Host OS:** macOS 12.7.6 (Monterey) — MacBook Air (2019), Intel Core i5-8210Y (2C/4T),
  Intel UHD 617.
- **Deployment target:** macOS **12.0** (`bundle.macOS.minimumSystemVersion = "12.0"`).
- **Toolchain present:** Rust/Cargo **1.99.1**, Node **24.18.0**, pnpm **12.14.0**.
- **Target app under study:** `/Applications/iwallpaper.app` (display name **"MyWallpaper"**).

## macOS API constraints (still relevant to the Rust/WebKit surface)

The host is macOS 12, so any native (Tauri/Rust) integration must avoid macOS 13+ APIs.

| Avoid (13+) | Use instead (12.x-compatible) |
|---|---|
| `MenuBarExtra` | `NSStatusItem` (Tauri `TrayIcon`) |
| `Settings` scene | In-window/separate preferences window |
| `NavigationStack` | Standard React routing |
| `SMAppService` | login-item helper (`SMLoginItemSetEnabled` / bundled helper `.app`) |
| `WeatherKit` | **Open-Meteo** (or equivalent) |
| Swift Charts | Canvas/charting in the web layer |

## Efficiency budget

- Default **1080p / 30 fps cap**.
- **Hardware decode only** (H.264/HEVC) — no software decode fallback in the default path.
- **Pause on occlusion / battery / thermal.**
- Benchmark on this machine: record CPU/GPU for the original vs. Driftwall
  (see `docs/progress/phase-0.5.md` for the protocol).

## Backend

- Hosted Postgres (**Neon** or **Supabase**) — **no local Docker requirement**.
- T3 stack: Next.js + TypeScript + tRPC + Drizzle. (Phase 6 — not touched in Phase 1.)

## Identity

- App name: **Driftwall**; bundle id: **`app.driftwall.desktop`**.
- Package/share format: **`.dwpkg`** (no DRM, no watermark).

## Capturability note (for Phase 2)

Driftwall's own wallpaper window must stay **capturable** (`NSWindow.sharingType =
NSWindowSharingReadWrite`, i.e. "normal") so the pixel-diff "no-overlay" test can read it.
(The original app sets `sharingState=0`; we deliberately do **not** mimic that.)

---

## Superseded history (Swift plan, AMENDMENT 0)

> Kept for the record only. **Not binding** after AMENDMENT 2.

- **Toolchain (superseded):** Xcode **14.2**, **Swift 5.7** syntax only.
- **Dependencies (superseded):** pin Swift 5.7-compatible libs (e.g. **GRDB 6.x**).
- **Original bundle id (superseded):** `app.driftwall.mac` (change if a different domain is
  registered). Now `app.driftwall.desktop`.
