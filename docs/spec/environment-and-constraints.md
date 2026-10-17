# Environment & Constraints (supersede earlier STACK)

Captured from the operator's amendments. These constrain every later phase.

## Development host / target

- **Host OS:** macOS 12.7.6 (Monterey) — MacBook Air (2019), Intel Core i5-8210Y (2C/4T),
  Intel UHD 617.
- **Deployment target:** macOS **12.0**.
- **Toolchain:** Xcode **14.2**, **Swift 5.7** syntax only.
- **Target app under study:** `/Applications/iwallpaper.app` (display name **"MyWallpaper"**).

## API constraints (avoid macOS 13+ APIs)

| Avoid (13+) | Use instead (12.x-compatible) |
|---|---|
| `MenuBarExtra` scene | `NSStatusItem` |
| `Settings` scene | Hosted SwiftUI preferences `NSWindow` |
| `NavigationStack` | `NavigationView` |
| `SMAppService` | login-item helper (`SMLoginItemSetEnabled` / bundled helper `.app`) |
| `WeatherKit` | **Open-Meteo** (or equivalent) |
| Swift Charts | Canvas/charting without Swift Charts |

- Pin dependencies compatible with Swift 5.7 (e.g. **GRDB 6.x**).

## Efficiency budget

- Default **1080p / 30 fps cap**.
- **Hardware decode only** (H.264/HEVC) — no software decode fallback in the default path.
- **Pause on occlusion / battery / thermal.**
- Benchmark on this machine: record CPU/GPU for the original vs. Driftwall
  (see `docs/progress/phase-0.5.md` for the protocol).

## Backend

- Hosted Postgres (**Neon** or **Supabase**) — **no local Docker requirement**.
- T3 stack: Next.js + TypeScript + tRPC + Drizzle.

## Identity

- App name: **Driftwall**; bundle id: **`app.driftwall.mac`** (change if a different domain is
  registered).
- Package/share format: **`.dwpkg`** (no DRM, no watermark).
