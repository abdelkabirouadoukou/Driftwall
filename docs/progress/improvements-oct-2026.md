# Improvements (Oct 2026)

- **Rotation**: Save now always starts the rotation with the selected wallpapers and the chosen
  interval (sec/min/hours + presets) and applies the first one immediately. Added Stop rotation,
  Select all / Clear, and a live "next change in…" countdown. A wallpaper whose file is missing is
  skipped instead of freezing the rotation. Deleting a wallpaper removes it from the rotation.
- **Library sync**: Rust emits `driftwall:library-changed` on add / rename / delete; every window
  (Home, Library, Displays, menu-bar panel) reloads its wallpapers and thumbnails automatically.
- **Live wallpaper player**: thumbnail is painted under the video (no blank/black frame), the video
  resumes if macOS pauses the occluded window, and a watchdog reloads the clip if it freezes.
- **YouTube music**: ignores late iframe events after switching to a local file, un-mutes and
  re-applies volume when a video starts, warms the player up so the first click isn't blocked,
  keeps the player on-screen (invisible) so WebKit doesn't throttle it, and shows a readable
  message (with auto-skip) for YouTube error codes.
- **YouTube player server**: YouTube answered "error 153" because the app window is served from
  `tauri://localhost`. A loopback-only HTTP server (`player_server.rs`, 127.0.0.1, random port, Host
  check, strict CSP) now hosts the player page, which the app embeds as an iframe and drives through
  `postMessage` (`lib/ytBridge.ts`). The main window's CSP no longer allows YouTube scripts.
- **Video colours**: the floating video card, its new toolbar (replacing YouTube's black control strip)
  and the "now playing" bar take their colour from the playing video's thumbnail (`lib/tint.ts`).
