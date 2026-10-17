# Gap Analysis: Original vs. Driftwall Target

Derived from `docs/spec/original-observations.md` (clean-room, read-only). "Original" = observed
`iwallpaper.app` behavior. "Driftwall" = our target design. No original code/assets/strings are
reused; Driftwall is an independent implementation.

## Capability matrix

| Area | Original (observed) | Driftwall target | Gap / action |
|---|---|---|---|
| App type | Menu-bar agent (`LSUIElement`) | Same: menu-bar agent + SwiftUI preferences window | Parity (re-implemented) |
| Min OS | 10.15 (legacy login-item helper) | macOS 13 | Modernize; use `SMAppService` |
| Static wallpapers | Yes (`Documents/Images`) | Yes (`StaticImageSource`) | Parity |
| Animated wallpapers | Yes (`AVPlayer`+`AVPlayerLooper`) | Yes (`VideoSource`, `AVPlayerLooper`) | Parity |
| Seamless loop | `AVPlayerLooper` (no custom loop points) | `AVPlayerLooper`, plus explicit **loop points** per manifest | **Improved** |
| Desktop attachment | Own window `setLevel:/setOpaque:` | `DesktopWindowController`, desktop-level per `NSScreen` | Parity (spec'd to verify level) |
| Click-through | `NoMouseAVPlayerView` | Click-through, `ignoresMouseEvents` | Parity |
| Lock-screen match | Export still (JPEG) → `setDesktopImageURL:` | `StaticImageSource` renders still + sets system picture | Parity |
| Multi-display | IOKit display IDs, `ScreenModel` per serial | Per-`NSScreen` windows, per-display config in manifest | Parity+ |
| Scaling modes | Not confirmed statically | fill / fit / stretch / center, per display | **Improved / new** |
| Import formats | MP4, MOV, MKV, M4V, AVI | Same set + validation | Parity |
| Codec path | AVFoundation hardware decode | AVFoundation + optional Metal/CI pipeline | Parity+ |
| Library storage | UUID files + **CloudKit** + keyed archives | UUID media files + a small Rust-owned **`library.json`**; optional cloud later | **Improved** (local-first, portable) |
| Metadata model | CloudKit records only | `.dwpkg` manifest + `library.json` index | **Improved** (open, portable) |
| Thumbnails | Image cache observed | Generated thumbnail cache | Parity+ |
| Package/share format | None (cloud-only) | `.dwpkg` (no DRM, no watermark) | **New** |
| Power: pause on battery | `isBattryPause` | `PowerPolicy` | Parity |
| Power: battery threshold | `lowBatteryLevel` (default 5) | Configurable threshold | Parity |
| Power: occlusion culling | `isOcclusionCulling` + OcclusionWindow | Occlusion/visibility observer | Parity |
| Power: Low Power Mode / thermal | Not confirmed | Observe + act | **Improved / new** |
| Power: OLED-black mode | Not observed | OLED-black mode + reduced frame rate | **New** |
| Energy dashboard | Not observed | CPU/GPU impact estimates | **New** |
| Dynamic rules | Not observed (manual/library only) | Triggers (time/sun/weather/appearance/Focus/display/app) → actions, priorities | **New** |
| Playlists | Library categories only | Playlists w/ shuffle, interval, crossfade | **New** |
| Asset studio | Not observed (import only) | Trim/speed/reverse/crop + CI color pipeline, non-destructive stack | **New** |
| AI generation | Not observed | Backend proxy: Fal/Luma/Runway, prompt expansion, display-aware, seamless-loop post | **New** |
| Accounts/billing | StoreKit + CloudKit | T3 backend (auth, tRPC, queue, spend caps) | **Changed** (own service) |
| Watermark / referral / DRM | Present | **None, by design** | **Removed intentionally** |
| Secrets handling | n/a | Keys in Keychain + backend proxy only | **New** (security requirement) |

## Where Driftwall must at least match (parity, non-negotiable)

1. Menu-bar agent with library grid and per-display assignment.
2. Static + animated wallpapers, sync'd still for lock-screen/system picture.
3. Click-through desktop surface across all displays and Spaces.
4. Import of MP4/MOV/MKV/M4V/AVI with validation.
5. Pause-on-battery and occlusion culling.

## Where Driftwall must exceed the original

1. **Power:** Low Power Mode, thermal, screen-lock, fullscreen detection; OLED-black mode;
   measurable CPU/GPU reduction and <300 ms resume.
2. **Loop quality:** explicit loop points + automated loop-quality check (no visible hitch over a
   30-min soak).
3. **Data ownership:** open `.dwpkg` manifest + portable `library.json`; no lock-in, no DRM.
4. **Automation:** dynamic rule engine (time/sun/weather/appearance/Focus/display/app).
5. **Creation:** asset studio (trim/color/LUT/loop-finder) + backend AI suite with per-user caps.
6. **Presentation:** scaling modes and per-display configuration.
7. **Trust:** no watermark, no referral gating, secrets never in the client.

## Verification targets (defined now, validated in later phases)

- Pixel-diff: screen capture vs. source frame proves the wallpaper paints at the desktop layer
  with **no overlay chrome**.
- 30-minute seamless-loop soak with no visible hitch.
- Measurable CPU/GPU drop when paused; resume latency < 300 ms.
- Deterministic scheduling tests via injectable clock.
- Non-destructive edit stack round-trips through the manifest.
