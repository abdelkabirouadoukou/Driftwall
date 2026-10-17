# Progress — Phase 0 (Observe)

**Branch:** `phase-0-observe`
**Status:** Complete — awaiting approval before Phase 1.

## What was built
- Clean-room, read-only observation of the target wallpaper app
  (`/Applications/iwallpaper.app`, bundle id `com.macosgame.iwallpaper`).
- `docs/spec/original-observations.md` — behavioral spec across bundle structure, library
  storage, rendering approach, formats/codecs, power/pause behavior, and settings surface.
- `docs/spec/gap-analysis.md` — Original vs. Driftwall capability matrix + parity/exceed lists.
- Repo scaffolding: `/app`, `/backend`, `/contracts`, `/docs`.

## Method & compliance
- Read-only inspection only: Info.plist, entitlements (`codesign -d`), linked frameworks
  (`otool -L`), bundle resources, on-disk container layout, and localized resource strings for
  the feature surface.
- **No** decompilation, patching, modification, re-signing, or license/watermark bypass.
- No original code, assets, icons, wallpapers, or branding copied. Findings recorded as behavior
  ("what"), not implementation ("how it was coded").
- Watermark/referral/license-enforcement material encountered during collection was
  **deliberately excluded** from all deliverables.

## Key findings (summary)
- Menu-bar agent (`LSUIElement`), sandboxed, CloudKit + StoreKit, legacy login-item helper.
- Media stored as UUID files under the sandbox container; library metadata in CloudKit records +
  keyed archives (no local SQL DB).
- Rendering via `AVPlayer` + `AVPlayerLooper`, click-through player view, occlusion-driven
  visibility, display identity via IOKit; lock-screen match via `setDesktopImageURL:` on an
  extracted display-resolution still.
- Power surface: pause-on-battery, battery threshold (default 5%), occlusion culling.
- ~1.8 GB library on host (737 images, 46 videos); import formats MP4/MOV/MKV/M4V/AVI.

## Risks
- Target identity ambiguity: no `MyWallpaper.app` installed; `iwallpaper.app` matched by
  branding/behavior. Confirm the intended target.
- Static analysis could not confirm exact window `level`/`collectionBehavior` flags or
  Low Power Mode / thermal / lock reactions.

## Open questions
1. Confirm the real target app (was `MyWallpaper` a different install?).
2. Approve a non-invasive **runtime** observation pass (Phase 0.5) to record window level,
   collection behavior, and Space/desktop behavior, if hardware/PDB inspection desire outweighs
   the "static-only" default.
3. Confirm the domains for `app.driftwall.mac` bundle id + backend host.

## Next (Phase 1, on approval)
Xcode project, menu-bar app, SwiftUI preferences, domain sources (Static/Video), `.dwpkg`
manifest schema, GRDB-backed library manager, and unit tests for manifest + library.
