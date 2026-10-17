# Driftwall — Design System (Master)

> **LOGIC:** When building a specific page, first check
> `design-system/driftwall/pages/[page-name].md`. If that file exists, its rules
> **override** this Master file. If not, strictly follow the rules below.

---

**Project:** Driftwall — macOS desktop wallpaper manager & media gallery
**Product category:** Wallpaper & Theme App + File Manager (utility, gallery-first)
**Mode:** Dark only (base `#0A0A10`)
**Stack:** Tauri v2 + React 19 + TypeScript + Vite (plain CSS + CSS custom properties)
**Platform:** macOS 12+ desktop app (window, min **1000×680**) — **not** a website

> **Provenance.** Generated with the `ui-ux-pro-max` skill and then constrained to
> Driftwall's brand. Verified skill inputs: style `dark-mode-oled` (deep-black,
> high contrast, visible focus, minimal glow); product match "Wallpaper & Theme
> App" → "File Manager & Transfer" (flat, content-driven, download accent);
> typography "Modern Dark Cinema (Inter System)" (single-family precision);
> UX "Focus States" + "Keyboard Navigation" (High severity). All palette values
> are Driftwall's own (derived from the logo), **not** the skill defaults.

---

## 1. Brand & Logo

The mark is **concept B — a crescent moon, one wave, two stars** inside a rounded
tile. It is drawn as SVG and reused everywhere (Dock icon, menu-bar template icon,
in-app sidebar, favicon). Do **not** redraw it or approximate it with a font glyph.

- **Full mark:** `app/design/logo.svg` — viewBox `0 0 1024 1024`, **transparent**
  background, artwork inset to **824×824** (100px margin) so the Dock icon matches
  the visual weight of other macOS icons.
- **Tile:** `rect` 160×160, `rx=36`, fill `#0A0A10`.
- **Moon:** `#E8E6FF`. **Wave:** `#7C5CFF`, stroke width 8, round caps.
  **Stars:** `#E8E6FF`.
- **Menu-bar (template) icon:** `app/design/tray.svg` — **black only, no tile**,
  alpha-only template image (macOS recolors it for light/dark menu bars).
- Brand colors are fixed by the logo and must not be re-tinted.

---

## 2. Color Palette

Logo-locked brand colors, plus a flat neutral ramp derived from the `#0A0A10` base.
**Flat fills only — no gradients anywhere.**

| Role | Hex | CSS Variable | Notes |
|------|-----|--------------|-------|
| Background (base) | `#0A0A10` | `--bg` | App background; logo tile color |
| Surface (card) | `#12121A` | `--surface` | Cards, panels, sidebar |
| Surface 2 | `#171722` | `--surface-2` | Inputs, hover rows, wells |
| Surface 3 | `#1E1E2B` | `--surface-3` | Popovers, context menus, drawers |
| Border | `#26263A` | `--border` | 1px hairlines, dividers |
| Border strong | `#33334A` | `--border-strong` | Focused/selected outlines |
| Text | `#E8E6FF` | `--text` | Primary text (logo accent) |
| Text muted | `#A6A3C0` | `--text-muted` | Secondary text/labels |
| Primary | `#7C5CFF` | `--primary` | Brand purple — actions, selection |
| On primary | `#0A0A10` | `--on-primary` | Text/icon on primary |
| Primary soft | `#7C5CFF22` | `--primary-soft` | Selected/hover tint |
| Secondary | `#2DD4BF` | `--secondary` | Teal — "success"/live accents |
| On secondary | `#0A0A10` | `--on-secondary` | Text/icon on secondary |
| Danger | `#F87171` | `--danger` | Destructive actions, errors |
| Danger soft | `#F8717122` | `--danger-soft` | Error background tint |
| Focus ring | `#7C5CFF` | `--ring` | 2px ring, 2px offset |

**Contrast (verified ≥4.5:1 for text):**

| Pair | Ratio |
|------|-------|
| `--text` `#E8E6FF` on `--bg` `#0A0A10` | ≈16.2:1 |
| `--text-muted` `#A6A3C0` on `--bg` `#0A0A10` | ≈8.1:1 |
| `--on-primary` `#0A0A10` on `--primary` `#7C5CFF` | ≈4.5:1 |
| `--secondary` `#2DD4BF` on `--bg` | ≈10.6:1 |
| `--danger` `#F87171` on `--bg` | ≈7.1:1 |

- Text on `--primary` is **dark** (`--on-primary`), never white (white fails at
  ≈4.35:1). Never place `--text-muted` on a lighter surface than `--surface-2`.
- Non-text UI (icons, borders) needs ≥3:1 — `--border-strong` and `--primary`
  satisfy this against their surfaces.

---

## 3. Typography

**Single-family precision system.** Use the macOS system UI font so the app looks
native and works **offline** (no network font fetch in a desktop app):

```css
--font-sans: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
--font-mono: ui-monospace, "SF Mono", "JetBrains Mono", monospace;
```

*(The skill recommends Inter; it is listed as a fallback only. We intentionally
omit the Google Fonts `@import` to keep the app offline-capable.)*

| Token | Size / line-height | Weight | Tracking | Use |
|-------|--------------------|--------|----------|-----|
| `--fs-display` | 32px / 1.15 | 700 | -0.02em | Page titles, hero |
| `--fs-h1` | 24px / 1.2 | 600 | -0.01em | Section headings |
| `--fs-h2` | 18px / 1.3 | 600 | 0 | Card titles |
| `--fs-body` | 14px / 1.5 | 400 | 0 | Default body |
| `--fs-label` | 12px / 1.4 | 500 | +0.01em | Labels, captions |
| `--fs-mono` | 12px / 1.4 | 500 | +0.01em | Resolution, size, counts |

Numbers in metadata (resolution, duration, file size) use `--font-mono` with
tabular figures (`font-variant-numeric: tabular-nums`).

---

## 4. Spacing, Radius, Elevation

4/8px rhythm. Desktop density.

| Token | Value | Token | Value |
|-------|-------|-------|-------|
| `--space-1` | 4px | `--space-6` | 32px |
| `--space-2` | 8px | `--space-7` | 40px |
| `--space-3` | 12px | `--space-8` | 48px |
| `--space-4` | 16px | `--space-9` | 64px |
| `--space-5` | 24px | | |

**Radius:** `--radius-sm 6px` · `--radius-md 10px` · `--radius-lg 14px` ·
`--radius-xl 18px` · `--radius-pill 999px`.

**Elevation** — flat colors, shadow *only* to separate layers (no gradients):

| Token | Value | Use |
|-------|-------|-----|
| `--shadow-1` | `0 1px 2px rgba(0,0,0,0.4)` | Cards, inputs |
| `--shadow-2` | `0 8px 24px rgba(0,0,0,0.45)` | Popovers, context menus |
| `--shadow-3` | `0 16px 48px rgba(0,0,0,0.55)` | Modals, detail drawer |

---

## 5. Icons

- **Library:** `lucide-react` (SVG only). **Never** emoji as structural icons.
- **Sizes are tokens:** `--icon-sm 16px` · `--icon-md 20px` · `--icon-lg 24px`.
  One stroke weight per layer (lucide default `1.75–2`).
- Decorative icons beside visible text: `aria-hidden="true"`.
- Icon-only controls: give an accessible name (`aria-label`) and expose state
  (`aria-pressed` / `aria-selected` / `aria-expanded`).
- Active sidebar icon uses `--primary`; inactive uses `--text-muted`.

---

## 6. Motion & Interaction

- **Duration:** 150–200ms for hovers/press; ≤220ms for overlays. Easing
  `cubic-bezier(0.2, 0, 0, 1)` (enters) / `ease-in` (exits, and exits faster).
- **`prefers-reduced-motion: reduce`** → set all transitions/animations to
  near-zero and disable parallax/auto-rotation:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .01ms !important;
      transition-duration: .01ms !important; }
  }
  ```
- **Hover/press** change color, opacity, or border only — **never** shift layout
  (no `translateY`/scale that moves neighbours).
- **`cursor: pointer`** on every clickable element.
- **Visible focus:** `:focus-visible { outline: 2px solid var(--ring);
  outline-offset: 2px; }` — never remove focus outline without a replacement.
- Full keyboard operability for every action; tab order matches visual order.

---

## 7. Component Specs

```css
/* Button — primary */
.btn-primary {
  background: var(--primary); color: var(--on-primary);
  height: 34px; padding: 0 var(--space-4); border-radius: var(--radius-md);
  font-weight: 600; border: 1px solid transparent; cursor: pointer;
  transition: background 150ms cubic-bezier(0.2,0,0,1), border-color 150ms;
}
.btn-primary:hover { background: #8C70FF; }
.btn-primary:active { background: #6B4BEE; }
.btn-primary:disabled { opacity: .5; cursor: not-allowed; }

/* Button — secondary / ghost */
.btn-ghost {
  background: transparent; color: var(--text);
  border: 1px solid var(--border-strong); border-radius: var(--radius-md);
  height: 34px; padding: 0 var(--space-4); cursor: pointer;
  transition: background 150ms, border-color 150ms;
}
.btn-ghost:hover { background: var(--surface-2); border-color: var(--primary); }

/* Card */
.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-lg); box-shadow: var(--shadow-1);
}
.card:hover { border-color: var(--border-strong); }

/* Input / search */
.input {
  background: var(--surface-2); color: var(--text);
  border: 1px solid var(--border); border-radius: var(--radius-md);
  height: 34px; padding: 0 var(--space-3); font-size: var(--fs-body);
  transition: border-color 150ms;
}
.input::placeholder { color: var(--text-muted); }
.input:focus-visible { border-color: var(--primary); outline: 2px solid
  var(--ring); outline-offset: 1px; }

/* Modal / drawer scrim — measured, isolates foreground, flat */}
.scrim { background: rgba(6,6,12,0.72); }
```

- **Selected / active list item:** `background: var(--primary-soft); border-left
  2px solid var(--primary);`
- **Wallpaper tile:** thumbnail on `--surface-2`; on hover show a flat scrim with
  the title + an "Add"/"Set" action; metadata in `--fs-mono`.
- **Toast:** `--surface-3`, `--shadow-2`, left accent bar (`--secondary` success /
  `--danger` error), auto-dismiss ~4s, `role="status"`.
- **Skeleton loader:** flat `--surface-2` blocks with a slow opacity pulse
  (disabled under reduced-motion).

---

## 8. Layout (desktop app)

- Window min size **1000×680**; content region scrolls independently of the
  sidebar. No mobile breakpoints.
- **Sidebar** (fixed ~220px): logo + nav — **Home, Discover, Library, Displays,
  Settings**. Active item uses the primary-soft treatment.
- **Top bar:** global search (`--input`), filtered as you type; `Cmd+F` focuses it.
- **Content grid:** responsive tiles via `repeat(auto-fill, minmax(200px, 1fr))`
  with `--space-4` gaps; large thumbnails in Library.
- Scrollbars: thin, `--border-strong` thumb on transparent track.
- Never hide content behind sticky bars; overlays never obscure focus.

---

## 9. Style

**Style:** Dark Mode (OLED) · **Flat Design** · **Minimalism & Swiss** — a
content-first gallery: the wallpaper art is the only saturated thing on screen;
chrome stays quiet and flat.

**Keywords:** dark, cinematic, precise, flat, high-contrast, technical, premium.

**Key effects:** 150–200ms color/opacity transitions, visible focus rings,
flat selected tints, muted-on-hover video previews, skeleton loaders.

---

## 10. Anti-Patterns (do NOT use)

- ❌ Gradients, glows, glassmorphism, skeuomorphism, or bevels.
- ❌ Emoji as icons — use `lucide-react` SVG.
- ❌ Missing `cursor: pointer` on clickable elements.
- ❌ Text or muted text below **4.5:1** contrast.
- ❌ White text on `--primary` (fails 4.5:1) — use `--on-primary`.
- ❌ Layout-shifting hovers (transform/scale that moves neighbours).
- ❌ Instant state changes (use 150–200ms transitions).
- ❌ Invisible/removed focus outlines.
- ❌ Ignoring `prefers-reduced-motion`.
- ❌ Hardcoded per-screen colors — always use the CSS variables above.

---

## 11. Pre-Delivery Checklist

- [ ] No emojis as icons; all icons from `lucide-react`, consistent sizing.
- [ ] `cursor-pointer` on every clickable element.
- [ ] Hover/active states use 150–200ms transitions and don't shift layout.
- [ ] All text ≥4.5:1 contrast; dark text on `--primary`.
- [ ] Visible focus ring (`:focus-visible`) on every interactive control.
- [ ] `prefers-reduced-motion` respected.
- [ ] Flat colors only — no gradients anywhere.
- [ ] Keyboard: `Cmd+F` search, `Cmd+1..4` nav; tab order matches visual order.
- [ ] Empty / loading / error states designed (skeletons, empty states, toasts).
- [ ] Logo SVG reused for sidebar + favicon; template `tray.svg` for menu bar.
- [ ] Verified at 1000×680 and maximized; no horizontal scroll.
