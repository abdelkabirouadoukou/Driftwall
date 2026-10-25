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
