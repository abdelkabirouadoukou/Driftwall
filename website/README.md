# Driftwall website

Static landing page (HTML + Tailwind). No build step.

## Deploy on Vercel (recommended)
1. Push the repo to GitHub.
2. vercel.com -> Add New Project -> import the repo.
3. Set **Root Directory** to `website`, Framework Preset **Other**, leave build/output empty.
4. Deploy. Every push to `main` redeploys; pull requests get preview URLs.

The existing `.github/workflows` only build the macOS app (`release.yml` on `v*` tags) and are not touched.
