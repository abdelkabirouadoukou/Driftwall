# Driftwall website

The marketing site, built on [x](https://thexjs.vercel.app/) (Bun-native, file-based routing,
islands architecture) instead of the old static HTML page.

## Develop

```sh
bun install
bun run dev        # http://localhost:3000
```

## Build

```sh
bun run build       # -> .x/ (static HTML + island JS)
bun run vercel-build # -> .vercel/output (Build Output API v3)
```

## Deploy on Vercel

1. vercel.com → Add New Project → import this repo.
2. Set **Root Directory** to `website`. Leave **Framework Preset** on "Other" —
   `vercel.json` already sets the install/build commands.
3. Deploy. Every push to `main` redeploys; pull requests get preview URLs.

No separate CI workflow touches this folder — `.github/workflows` only builds the macOS app.

## Structure

- `src/pages/` — file-based routes (`index.tsx` is the whole one-page site today)
- `src/layouts/main.tsx` — header + footer wrapping every page
- `src/components/` — `aurora-field.tsx` (hero backdrop, a nod to the app's own built-in
  Aurora scene) and `site-meta.tsx` (patches `<title>`/description client-side — see the
  comment in that file for why: this version of `@thexjs/core` doesn't support per-page
  SSR meta yet)
- `src/styles/globals.css` — Tailwind v4 + Driftwall's brand tokens (same dark/purple/teal
  palette as the app itself)
