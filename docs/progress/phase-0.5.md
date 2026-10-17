# Progress — Phase 0.5 (Runtime observation, read-only)

**Branch:** `phase-0-observe`
**Status:** Complete — awaiting approval before Phase 1.

## What was done
- Read-only runtime observation of the running target (PID 1501, display name "MyWallpaper") on
  the host (MacBook Air 8,2, Intel i5-8210Y, macOS 12.7.6, 1680×1050 @2×).
- Appended results to `docs/spec/original-observations.md` (Phase 0.5 section).
- Recorded operator amendments in `docs/spec/environment-and-constraints.md`.

## Compliance
- Public read-only tooling only: `CGWindowListCopyWindowInfo`, `lsof`, `top`/`ps`, `ioreg`
  (IOAccelerator), `pmset -g assertions`, `log show`, `defaults read com.apple.spaces`,
  `screencapture` (frame diffing).
- **No** debugger attach, no code injection, no patching, no modification of the target, no
  license/watermark investigation, no synthesized input.

## Key results
- Wallpaper window is placed exactly at **`kCGDesktopWindowLevel`** (-2147483623), i.e. behind
  desktop icons; a second window at `desktop+1`; the menu-bar item is a standard `NSStatusItem`
  (layer 25). Wallpaper windows are **not capturable** (`sharingState = 0`).
- Main display has **5 Spaces**; the current Space showed only the desktop. `collectionBehavior`
  and per-Space persistence are **not observable** with public read-only APIs (inferred only).
- **Idle ≈ 0 % CPU**, ~70 MB RSS, 13 threads, no power assertions; two captures 3 s apart were
  **pixel-identical** → not animating at sample time.
- Energy settings decoded: `lowBatteryLevel = 5`, `isBattryPause = **False**`,
  `isOcclusionCulling = True`.
- A VideoToolbox hardware-decode session is attributable to the app; an unlinked ~90 MB staging
  copy of the current video was found under `Documents/tmp/`.

## Test results
N/A (observation phase). Findings verified by direct read-only inspection; frame-diff and
CPU-time-delta provide quantitative evidence.

## Risks / unknowns
- Cause of the observed paused state is not determinable read-only (idle-pause vs. occlusion
  false-positive vs. other).
- Isolated per-process GPU attribution needs authorized `powermetrics`.

## Open questions
1. Confirm cause of the paused/static state during observation.
2. Purpose of the `desktop+1` auxiliary window (1580×865).
3. Confirm `collectionBehavior`/Space persistence (privileged query, or a manual Space-switch test).
4. Approve the playback benchmark (below) so the original's animating CPU/GPU can be recorded.

## Pending: animating-playback benchmark protocol
Requires an unobstructed desktop with confirmed active animation (and ideally AC power).

```
# On a Space showing only the desktop, with the wallpaper animating:
PW=$(pgrep -x iwallpaper)          # or the "MyWallpaper" owner PID
# 1) confirm animation (two captures 3 s apart must differ):
screencapture -x /tmp/a.png; sleep 3; screencapture -x /tmp/b.png
# 2) sample CPU over 30 s:
top -l 31 -s 1 -pid "$PW" -stats pid,cpu,mem | grep -E "^$PW"
# 3) sample system GPU (or authorized: sudo powermetrics --samplers gpu_power -n 10 -i 1000):
for i in $(seq 1 10); do ioreg -r -d 1 -c IOAccelerator | sed -n 's/.*"Device Utilization %"=\([0-9]*\).*/GPU=\1%/p' | head -1; sleep 1; done
```
Record: mean/peak CPU %, frame-diff change rate, GPU %, RSS. This becomes the baseline Driftwall
must beat.

## Next (Phase 1, on approval)
Constraints now fixed: macOS 12.0 target, Xcode 14.2 / Swift 5.7, `NSStatusItem`,
hosted-SwiftUI preferences, login-item helper, Open-Meteo, GRDB 6.x, hosted Postgres (Neon/Supabase).
Build the Xcode project, menu-bar app, SwiftUI preferences, domain sources (Static/Video), `.dwpkg`
manifest schema, GRDB library manager, and unit tests.
