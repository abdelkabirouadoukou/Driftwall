# Original Application Observations (Phase 0)

**Status:** Clean-room, read-only observation.
**Target observed:** `/Applications/iwallpaper.app` (bundle id `com.macosgame.iwallpaper`).
**Note on naming:** The mission referenced `/Applications/MyWallpaper.app`. No bundle by that
name is installed on the observation host. The installed wallpaper app is `iwallpaper`, which
internally still uses the "MyWallpaper" branding (e.g. localized string
`"Launch MyWallpaper at Startup"`) and uses a helper named `iwallpaperhelper`. It is treated
as the intended target. If a distinct `MyWallpaper.app` exists elsewhere, re-run this phase
against it.
**Method:** Read-only inspection of the bundle and of the app's own container on the observer's
machine (Info.plist, entitlements, linked frameworks, bundle resources, on-disk library layout,
localized resource strings for the feature surface). No code was decompiled, patched, re-signed,
or executed-and-instrumented.

**Explicitly out of scope:** watermark, licensing, purchase/referral enforcement, DRM, and any
anti-tamper behavior. Observations related to those were identified during collection and are
deliberately omitted. This document describes observable product behavior only.

---

## a) Bundle structure

| Property | Value |
|---|---|
| Bundle identifier | `com.macosgame.iwallpaper` |
| Bundle name / executable | `iwallpaper` |
| Version | `1.1.3` (build `202506122000`) |
| Minimum OS | `LSMinimumSystemVersion = 10.15` |
| App category | `public.app-category.utilities` |
| Agent type | `LSUIElement = 1` (menu-bar/background agent, no Dock icon) |
| Principal class | `NSApplication` |
| Main UI entry | `NSMainStoryboardFile = Main` |
| Distribution | Mac App Store (`_MASReceipt`, `_CodeSignature`) |

**Storyboards (window/UI classes observed in bundle):**
- `Main` — library/home UI
- `WallpaperWindow` — the wallpaper surface window
- `RedFrameWindow` — auxiliary framed overlay window
- `OcclusionWindow` — window used for occlusion detection/coverage

**Linked system frameworks (from `otool -L`):**
`AVFoundation`, `AVKit`, `AppKit`, `CoreFoundation`, `CoreGraphics`, `CoreMedia`, `CoreServices`,
`CloudKit`, `StoreKit`, `ServiceManagement`, `IOKit`, `Foundation`, `libobjc`, `libSystem`.

Observations:
- No top-level `Metal`, `MetalKit`, or `CoreImage` linkage. Video presentation relies on the
  AVFoundation/AVKit hardware path; no custom Metal/CIFilter pipeline is evident at link level.
- `ServiceManagement` is linked in the main app; the login-item mechanism is the
  `SMLoginItem`-style helper described below (legacy login-item API, not `SMAppService` service
  agents — consistent with the 10.15 deployment target).

**Helper tool / login item:**
- `Contents/Library/LoginItems/iwallpaperhelper.app`
  - Bundle id `com.macosgame.iwallpaper.iwallpaperhelper`
  - `LSBackgroundOnly = 1` (no UI)
  - Sandboxed; links the main app by bundle id
  - Strings indicate it launches/relaunches the parent app (`iwallpaperOpenFinish`,
    `launchApplication:`) — i.e. a login-item launch shim.

**Entitlements (main app):**
- `com.apple.security.app-sandbox` = true
- `com.apple.security.files.user-selected.read-only` = true (import via user selection only)
- `com.apple.security.network.client` = true
- iCloud/CloudKit: `iCloud.com.macosgame.iwallpaper`, CloudKit service, container environment `Production`

**URL schemes / login items / services:**
- No custom `CFBundleURLTypes` / registered URL schemes observed.
- Launch-at-login implemented via the bundled login-item helper
  (preference key `isLaunchLogin` in the app's preferences plist).

---

## b) Library storage

**Sandbox container:** `~/Library/Containers/com.macosgame.iwallpaper/Data/`

Observed layout (all filenames are opaque UUIDs; no user-facing names on disk):

| Path | Contents |
|---|---|
| `Documents/Images/<UUID>.png` | Still image wallpapers (observed 737 files) |
| `Documents/Videos/<UUID>.mp4` \| `.mov` | Video wallpapers (observed 46 files) |
| `Documents/DesktopImage/<UUID>.png` | Extracted still frame per wallpaper, written at display resolution, used to set the **system** desktop picture |
| `Documents/energySetting` | `NSKeyedArchiver` archive of an `EnergySettingModel` |
| `Documents/screen` | `NSKeyedArchiver` archive: array of `ScreenModel` |
| `Documents/iCloudUserRecord` | `CKRecord` describing the cloud user |
| `Documents/tmp/` | Scratch |
| `Library/Preferences/com.macosgame.iwallpaper.plist` | App preferences |
| `Library/Caches/.../CloudKit/...` | CloudKit cache (records + asset store) |
| `Library/Caches/StoreKit/receipts.db` | StoreKit receipt cache |

**On-disk metadata model (archived objects, decoded field names):**

`EnergySettingModel`:
- `lowBatteryLevel` (Int, observed `5`)
- `isBattryPause` (Bool — pause on battery; note original's spelling)
- `isOcclusionCulling` (Bool)

`ScreenModel` (one per display), fields:
- `serialNumber`, `volume`, `wallpaperRecord` (a `CKRecord`), `isShowWallpaper` (Bool),
  `systemWallpaperURL` (NSURL), `isConnection` (Bool)

`CKRecord` types observed:
- `WallPaper` — fields include `videoSize`, `videoResolution`, `videoExtension`, `isCheck`,
  `videoRate`, `tags`, `isGood`, `isSelfShow`, `isSound`, `tagsStr`, `bigTypeTags`,
  `hotCount`, `correctAES` (media metadata)
- `iCloudUsers` — `appVersion`, `userName`, `deviceName`, `downloadCount`,
  `deviceSystemVersion`, `appShortVersion`, `deviceModel`, `myRecommendKey`

**Observations:**
- There is **no local SQL relational library DB**; library metadata lives in **CloudKit records**
  plus per-screen and per-energy keyed archives, with media stored as UUID files on disk.
- Filenames are UUIDs with no extension-derived display name; the wallpaper's identity and
  metadata come from the associated cloud record / screen archive, not the filename.
- Cloud-downloaded media under `Documents/Videos` was observed to be stored in an opaque
  (non-parsable) form rather than plain playable containers. Treated as an opaque storage
  detail; the protection mechanism behind it is out of scope for this engagement.
- Container size on the observer host: ~1.8 GB (737 images, 46 videos).

**Import format surface (from localized resource strings):**
- Accepted video formats: **MP4, MOV, MKV, M4V, AVI**, with an uploaded/large-size limit.
- Import performed via user selection or drag-and-drop (sandbox entitlement is
  user-selected read-only).
- On import, video resolution is validated and a warning is shown for sub-HD sources.

---

## c) Rendering approach

**Window/desktop attachment:**
- The app is a menu-bar agent (`LSUIElement`) that creates its own borderless window(s)
  (`WallpaperWindow`) rather than only relying on the system desktop picture.
- Observed class/method surface: `setLevel:`, `setOpaque:`, `setIgnoresMouseEvents:`,
  `NSWindowDelegate`, `applicationDidChangeOcclusionState:`.
- A dedicated `OcclusionWindow`/`OcclusionWindowController` plus
  `applicationDidChangeOcclusionState:` indicates occlusion-driven visibility control.
- A `RedFrameWindow`/`RedFrameView` provides an auxiliary framed overlay window.
- Window collection behavior is **not** exposed as explicit
  `canJoinAllSpaces`/`stationary`/`ignoresCycle` string constants in the binary, so exact
  collection-behavior flags could not be confirmed by static observation (see Open Questions).

**Video playback:**
- Uses `AVPlayer` + `AVPlayerLooper` (observed ivars `_player`, `_playerLooper`, `_playerView`)
  for gapless looping.
- Player view is presented via a custom subclass `NoMouseAVPlayerView` — i.e. mouse events are
  suppressed/click-through.
- No Metal/CI pipeline linked; presentation is AVFoundation-native.

**Multi-display:**
- Display enumeration/identification via IOKit:
  `IOServicePortFromCGDisplayID:`, `NSScreenNumber`, `DisplayProductID`, `DisplaySerialNumber`,
  `DisplayVendorID`, `IODisplayConnect`.
- Per-display assignment persisted through `ScreenModel` (keyed by `serialNumber`), with
  `isShowWallpaper` and `isConnection` flags per screen, and a per-screen `volume`.

**Lock screen / system desktop picture:**
- Uses `setDesktopImageURL:forScreen:options:error:` and
  `desktopImageURLForScreen:` (plus `setDesktopImageWithWallpaperRecord:serialNumber:`) to set
  the **system** desktop picture from a pre-rendered still (`Documents/DesktopImage/<UUID>.png`)
  so the lock screen / Mission-Control background matches the live wallpaper.
- Those "`.png`" desktop frames were observed to actually be **JPEG** data at display-native
  resolutions (e.g. 3840x2160, 2144x1206, 1920x1080), i.e. a still frame extracted/encoded at
  the target display size.

**Menu bar:**
- `NSStatusItem` / `createMenu` / `hiddenMenuIcon:` — a status-bar menu with an option to hide
  its icon.

---

## d) Supported formats / codecs & conversion

- **Import container formats:** MP4, MOV, MKV, M4V, AVI (per resource strings), plus still
  images (PNG/JPEG-family).
- **Decode:** delegated to AVFoundation (hardware-accelerated H.264/HEVC path); no custom
  decoder linked.
- **Conversion step observed:** on selecting a video, a still is exported to
  `Documents/DesktopImage/<UUID>.png` (JPEG-encoded, display-resolution) for the system desktop
  picture; the live playback continues from the stored media.
- **Resolution validation:** import warns when source resolution is below HD
  (`"current video resolution is too low ... HD video is recommended"`).

---

## e) Power / pause behavior observed

Settings model (`EnergySettingModel`) and battery subsystem imply:
- **Pause on battery:** `isBattryPause` — stop/deprioritize animated playback when on battery.
- **Battery threshold:** `lowBatteryLevel` (observed default `5`) — disable/reduce when battery
  percentage drops to this level (`"Disable Displays At This Battery Percentage"`).
- **Occlusion culling:** `isOcclusionCulling` + `OcclusionWindowController` +
  `applicationDidChangeOcclusionState:` — stop rendering when the wallpaper surface is covered.
- **Battery source:** IOKit battery reporting (`BatteryModel`, `BatteryInstalled`,
  `PFSystemKitBatteryReport`).
- No explicit strings for Low Power Mode, thermal state, or screen-lock handling were observed;
  those are not confirmed as implemented (see Open Questions).

Localized energy strings: `"Energy Settings"`, `"Disable Displays While On Battery"`,
`"Disable Displays At This Battery Percentage"`, `"Volume (Muted by Default)"`.

---

## f) Settings surface & feature list (behavioral, for parity only)

Observed feature surface (from class names, storyboards, and resources):

- **Menu-bar control:** status menu, hideable menu icon; start/stop wallpaper.
- **Library/home:** grid of wallpapers (`NSCollectionView`), categories/tags
  ("Homepage (Library and Display Settings)").
- **Per-display setup:** enable/disable a display, assign wallpaper per display, per-display
  volume ("Enable This Display").
- **Import:** file selection + drag-and-drop; MP4/MOV/MKV/M4V/AVI; size/resolution validation.
- **Playback controls:** sound toggle, volume (muted by default), looping (AVPlayerLooper).
- **Favorites / downloads / uploads / search:** dedicated view controllers
  (`ShowDataViewController`, favorites, downloaded, upload, search) and a trending/hot feed.
- **Cloud library:** CloudKit-backed sync of records and assets; iCloud user record.
- **Launch at login:** login-item helper; toggle in preferences.
- **Energy settings:** pause-on-battery, battery threshold, occlusion culling.
- **Misc:** desktop-icon hiding (`isHiddenDesktopIcon`), toast/frame overlay windows.

> Watermark removal, referral, purchase, and restore-purchase UI were present in resources but
> are **intentionally excluded** from this engagement and from Driftwall's design.

---

## Open questions / limitations

1. `MyWallpaper.app` vs `iwallpaper.app`: only the latter was available. Confirm the true target.
2. Exact window `collectionBehavior` flags (Spaces/stationary/stage) and window `level` value
   were not statically confirmable; a runtime observation pass (Phase 0.5, non-invasive) is
   recommended to record window level, collection behavior, and Space behavior.
3. Whether the app sets the desktop window below icons (backstop) vs. an overlay level is
   unconfirmed statically.
4. Cloud media is stored opaque on disk; the underlying storage/obfuscation mechanism is out of
   scope.
5. Low Power Mode / thermal / screen-lock reactions are unconfirmed; treat as Driftwall
   opportunities rather than confirmed parity items.

---

# Phase 0.5 — Runtime observations (read-only)

**Method:** Public, read-only runtime observation only. Tools used: CoreGraphics
`CGWindowListCopyWindowInfo` (window inventory), `lsof` (open files), `top`/`ps` (CPU),
`ioreg` IOAccelerator (GPU counters), `pmset -g assertions`, `log show`, `defaults read
com.apple.spaces`, and `screencapture` for frame-diffing. **No** debugger attach, no code
injection, no patching, no modification of the target, no license/watermark investigation.

**Host:** MacBook Air 8,2 — Intel Core i5-8210Y (2C/4T), macOS 12.7.6 (21H1320), single display
1680×1050 @2×. Target running as PID 1501; window owner display name is **"MyWallpaper"**.
(Uptime at sampling ≈ 22 h.)

## 1. Window inventory & levels (CGWindowList, read-only)

| Window | Size / position | `kCGWindowLayer` | Meaning |
|---|---|---|---|
| Wallpaper surface | 1680×1050 @ (0,0) | **-2147483623** | **`kCGDesktopWindowLevel`** exactly |
| Auxiliary desktop window | 1580×865 @ (50,75) | **-2147483622** | `kCGDesktopWindowLevel + 1` |
| Status-bar item | 37×24 @ (987,0) | **25** | `kCGStatusWindowLevel` → `NSStatusItem` |

Reference levels on the same display: Finder desktop icons `-2147483603`
(`kCGDesktopIconWindowLevel`), Dock `-2147483624`, Window Server backstop `-2147483626`.

Observations:
- The full-screen wallpaper window is placed **exactly at the system desktop level**, i.e. behind
  desktop icons — confirming the "own window at desktop layer" rendering approach (not just the
  system desktop picture).
- A **second window sits one level above the desktop** (`desktop+1`), sized 1580×865 (inset on a
  1680×1050 screen). Its purpose was not confirmable read-only; candidates are an occlusion-sensing
  window or a frame/mask overlay. Recorded as **unconfirmed**.
- The status-bar item is a standard `NSStatusItem` (layer 25).
- All MyWallpaper windows report `kCGWindowSharingState = 0` (none) → the wallpaper windows are
  **excluded from window captures** (window-level content capture returned `None`).
- Per-window `kCGWindowMemoryUsage ≈ 1264 KB`, i.e. pixel content is composited by the WindowServer
  /GPU and not held as a large CPU-side backing buffer.

## 2. Space behavior

- `com.apple.spaces`: the main display is configured with **5 managed Spaces** (IDs 5–9); current
  Space = 5.
- Pixel analysis of a full-screen capture on the current Space showed a **pure full-bleed gradient
  with no window edges and no visible menu bar** — i.e. the current Space displayed only the
  desktop (the user's other apps reside on other Spaces).
- **Not observable via public read-only APIs:** the window's `collectionBehavior`
  (`canJoinAllSpaces`/`stationary`/`ignoresCycle`), the numeric `level` beyond the CG layer, and
  stage-manager flags. Automated Space switching was deliberately avoided (it would require
  synthesizing input). Presence-on-all-Spaces is therefore **inferred**, not directly measured.

## 3. Idle / playback power

- **Idle CPU:** MyWallpaper `%CPU ≈ 0.0` across `top` samples (5 × 2 s); cumulative CPU-time delta
  of **0.03 s over 15 s (≈ 0.2 % CPU)**; process state `sleeping`. RSS ≈ **70 MB**, **13 threads**,
  lifetime CPU ≈ 0:46.
- **Frame diff:** two full-screen captures **3 s apart were pixel-identical** (0 changed pixels) →
  the wallpaper was **not animating** at observation time.
- **Power assertions:** the process owned **no** power assertions (no display-idle-sleep preventer),
  consistent with paused playback. Display was on (`IODisplayWrangler` power state 4); no screen
  saver running.
- **GPU:** system-wide IOAccelerator `Device Utilization %` ranged **2–34 %**, but that is
  dominated by other running apps; there is **no isolated per-process GPU counter** available
  without elevated tooling (`powermetrics`, requires authorization). System-wide
  `contextVideoCount = 9` GPU video-decode contexts.
- **Decode path:** `VTDecoderXPCService` helper processes were running; one (PID 1517, alive since
  ~app launch) is attributable to the app, confirming a **VideoToolbox hardware-decode session**.
- **Cause of the paused state not determinable read-only.** The screen had no occluding windows and
  no battery-pause was configured (see §4), so leading candidates are an **idle-pause** (the session
  had no user input during automation), an occlusion-culling false-positive, or a user-selected
  pause. Recorded as an open question.

## 4. Energy settings (decoded archive, read-only)

`EnergySettingModel` in `Documents/energySetting`:
- `lowBatteryLevel = 5`
- `isBattryPause = False`  ← pause-on-battery is **OFF**
- `isOcclusionCulling = True`

## 5. Media staging & current record

- Current wallpaper is a **video** record: `videoResolution = 3840*2160`,
  `videoExtension = mp4`, `videoRate = 1.7`, record name `D5CB1931-…`; tags include
  dynamic-wallpaper / night-purple / nature-scenery. The system desktop picture is a user file
  (`~/Downloads/Gemini_Generated_Image_….jpeg`).
- The app held an open file descriptor to `Documents/tmp/<digits><UUID>.mp4` (~90 MB) that was
  **no longer listed in the directory** → a transient/unlinked staging copy of the current video
  (write → open → unlink pattern). Neutral storage note; mechanism out of scope.

## 6. Benchmark status

- **Captured:** idle/paused baseline for the original — **≈ 0 % CPU**, no GPU attribution possible,
  static frames, ~70 MB RSS.
- **Not yet captured:** the **animating** CPU/GPU benchmark. This requires an unobstructed desktop
  with confirmed active animation and, ideally, AC power (pause-on-battery is off, but other power
  conditions may still apply). See `docs/progress/phase-0.5.md` for the benchmark protocol.

## 7. Phase 0.5 open questions

1. What paused the wallpaper during observation (idle-pause vs. occlusion false-positive vs. other)?
2. Purpose of the `desktop+1` auxiliary window (1580×865).
3. Confirm `collectionBehavior`/Space persistence (needs privileged query or a manual Space-switch
   test by the operator).
4. Isolated per-process GPU attribution requires authorized `powermetrics`; otherwise rely on
   frame-time/`ioreg` deltas.
