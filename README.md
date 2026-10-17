# Driftwall

**Your desktop, alive.**

A native macOS wallpaper app for static and animated wallpapers: power-efficient, watermark-free
by design, and more capable than the app it was informed by.

> Driftwall is a clean-room reimplementation. It is informed by **observed behavior** of an
> existing wallpaper app, never by its code, assets, or branding. See
> `docs/spec/original-observations.md` and the rules of engagement in the mission.

## Layout

| Path | Purpose |
|---|---|
| `app/` | Swift native macOS app (SwiftUI + AppKit, AVFoundation, Metal, Core Image) |
| `backend/` | T3 service (Next.js, TypeScript, tRPC, Drizzle + Postgres) — AI generation proxy, jobs, accounts, cloud library |
| `contracts/` | OpenAPI + JSON Schema for wallpaper manifests |
| `docs/spec/` | Behavioral specs and gap analysis |
| `docs/progress/` | Per-phase progress reports |

## Package format

`.dwpkg` — Driftwall package (manifest + media). **No DRM. No watermark.**

## Status

- Phase 0 (Observe) — complete. See `docs/progress/phase-0.md`.
