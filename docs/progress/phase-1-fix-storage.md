# Phase 1 fix — storage backend (SQLite → `library.json`)

## Problem

Launching the app failed with **`database is locked`** (`SQLITE_BUSY`, code 5) on
startup. Root cause: `tauri-plugin-sql` let the frontend open multiple SQLite
connections that locked each other.

## Decision

Remove SQLite from the frontend entirely. Rust owns the library as a single
serialised document, `library.json` in the app data directory, alongside UUID
media files — the same shape as the original app (UUID content + a small
metadata file, no SQL database). One `Mutex<Library>` in Tauri managed state is
the sole writer, so no locking can occur. If queryable storage is ever needed, a
**single Rust-owned `rusqlite` connection** can be reintroduced later.

## Changes

- **Removed:** `tauri-plugin-sql` from `Cargo.toml`, `main.rs`, and
  `capabilities/default.json`; `@tauri-apps/plugin-sql` from `app/package.json`;
  frontend DB module `app/src/lib/db.ts` and the SQL migrations.
- **Added `app/src-tauri/src/store.rs`:** `Library { version, wallpapers,
  settings }` with `Wallpaper { id, type, file_path, title, tags[], width,
  height, duration, created_at }`. Atomic save (tmp → fsync → rename, previous
  kept as `library.json.bak`); load recovers from `.bak` on a corrupt main file,
  or quarantines it as `library.json.corrupt-<ts>` and starts empty.
- **`main.rs`:** commands `library_list` (newest first), `library_add`,
  `library_rename`, `library_delete` (also removes the copied media + thumbnail),
  `settings_get`, `settings_set`; `Mutex<Library>` loaded/created in `setup()`.
- **Frontend:** new typed `app/src/lib/api.ts` (single `invoke` wrapper). Running
  outside Tauri (i.e. a plain browser) now shows **"Open the Driftwall app
  window, not the browser."** instead of a raw `TypeError`. `domain.ts` tags are a
  plain `string[]`; the `serializeTags`/`parseTags` helpers were dropped.
- **Docs:** `environment-and-constraints.md` and `gap-analysis.md` updated to
  describe `library.json` storage instead of SQLite.

## Verification (run locally)

| Step | Command | Result |
|---|---|---|
| Install | `pnpm install` | ok (3 workspace projects) |
| Frontend tests | `pnpm --filter driftwall-app test` | **43 passed / 4 files** |
| Frontend build | `pnpm --filter driftwall-app build` | ok (`dist/` emitted) |
| Rust check | `cargo check` | ok, no warnings |
| Rust tests | `cargo test` | **8 passed** |

`pnpm tauri dev` was not run here; verification is `cargo check`/`cargo test` +
`pnpm build`/`pnpm test` as agreed.
