# Phase 1.5 — UX foundation & Discover

Branch: `phase-1.5-ux` (branched from `main` / `phase-1-scaffold` @ `466b047`).

Phase 1.5 turns the scaffold into a real product surface: a design system and
brand assets, a five-view app shell, a full library experience, grouped
settings, and a Discover browser backed by Rust-owned network access. Playback
itself (the wallpaper engine) is **Stage B** and is deliberately not started.

## A0 — Design system

- Installed the `ui-ux-pro-max` skill for opencode (`.opencode/skills/…`),
  alongside its bundled banner/brand helpers.
- Authored `design-system/driftwall/MASTER.md` as the single source of truth:
  dark-only OLED theme, flat colours (no gradients), a 4/8px spacing rhythm,
  150–200 ms motion, focus-visible rings, reduced-motion fallbacks, lucide
  icons, and a contrast-checked palette derived from the logo.

## A1 — Brand assets & app icon

- Hand-authored `app/design/logo.svg` (moon + wave + stars) and
  `app/design/tray.svg` (monochrome template icon).
- `app/design/render_icons.py` rasterises the SVGs with `qlmanage` and applies
  an analytic alpha mask (no ImageMagick/rsvg dependency on this machine —
  verified unavailable), regenerating `app/src-tauri/icons/` (app icon, `.icns`,
  and 22 px + 44 px tray template icons). The previous generated-icon script was
  removed.
- Wired the brand: favicon + sidebar mark use `logo.svg`; the tray loads the 2×
  template icon so it stays crisp when macOS scales it to 18 pt.
- Verified programmatically (transparent corners, expected tile/moon/wave pixel
  counts, zero stray white pixels).

## A2 — App shell & core views

- **Tokens & shell** (`theme.css`, `App.tsx`): rewrote the theme around the
  MASTER tokens and built a five-item sidebar (Home, Discover, Library,
  Displays, Settings) with an active rail indicator, a top bar with search, a
  toast provider, reusable skeleton primitives, `Cmd+F` to focus search, and
  `Cmd+1…5` to switch views. Minimum window size is now **1000×680**.
- **Home:** a "now playing" hero placeholder (populated by Stage B), recently
  added wallpapers, and category shortcuts that deep-link into Discover.
- **Library:** All/Static/Live filter with counts, Newest/Oldest/A–Z sorting,
  large thumbnails, muted video preview on hover, multi-select (click,
  Cmd-click, Shift-range) with a sticky selection bar, `Delete`/`Escape`
  shortcuts, a right-click context menu, inline rename, and whole-window
  drag-and-drop import via the webview drop event. Added a Rust
  `reveal_in_finder` command.
- **Settings:** grouped sections (General, Sources, Library, Playback, About)
  with a reusable switch, the Dock toggle, a masked Pixabay API key field
  (show/hide/save/clear, persisted via `settings_set`), a storage-folder row
  that reveals the library in Finder, and the app version.

## A3 — Discover

All network access is in Rust; the webview never talks to a provider directly.

- **Sources (`src/discover.rs`):** Wallhaven search with `purity=100`
  hard-coded and `atleast=1920x1080`; Pixabay video search with
  `video_type=animation` and `safesearch=true`, using the user's own key.
  Responses parse into a source-agnostic `DiscoverItem`.
- **Throttling & caching:** a per-source minimum-interval `RateLimiter`
  (45/min Wallhaven, 100/min Pixabay) and a 24-hour memory + disk cache keyed by
  an FNV-1a hash of source/query/category/page.
- **Client:** one shared `reqwest` client over `rustls` with a
  `Driftwall/<version>` User-Agent.
- **Commands:** `discover_categories`, `discover_search`, `discover_download`
  (streams to the library dir with a validated extension). The webview then
  probes, thumbnails and registers the record, reusing the local import
  pipeline; source/attribution fields (`source`, `source_url`, `author`) were
  added to `Wallpaper` via serde defaults.
- **UI:** Images/Videos source tabs, category chips loaded from Rust, debounced
  search, infinite scroll (IntersectionObserver sentinel + Load-more fallback),
  lazy thumbnails, hover resolution + inline Add, and a detail drawer with
  preview, metadata, attribution, **Add to library**, and a disabled
  **Add and set** button pending the engine.

Nothing is bundled or re-hosted: assets stream straight to the user's machine
and every item carries its attribution URL.

## Verification (run locally)

| Step | Command | Result |
|---|---|---|
| Frontend tests | `pnpm test` | **47 passed / 4 files** |
| Frontend build | `pnpm build` | ok (`dist/` emitted) |
| Rust check | `cargo check` | ok, no warnings |
| Rust tests | `cargo test` | **18 passed** (10 discover + 8 store) |

`pnpm tauri dev` was not run, per the agreed verification policy
(`pnpm build` / `pnpm test` / `cargo check` / `cargo test` only).

## Known limitations

- Pixabay video thumbnails are derived from the returned `picture_id`
  (`i.vimeocdn.com` convention); items without one fall back to the video URL
  and render a placeholder until hovered.
- "Add and set" is intentionally disabled — setting the desktop picture is
  Stage B.
- Displays is a placeholder view until Stage B.

## Next — Stage B (Phase 2), not started

Per the master prompt, Stage B begins only on an explicit **"go phase 2"**. It
adds the wallpaper engine: a `wallpaper.html` Vite entry, one borderless window
per display pinned at the desktop level, per-display assignment, fill/fit/
stretch/centre scaling, double-`<video>` crossfade, `NSWorkspace`
set/restore desktop picture, and the Displays UI.
