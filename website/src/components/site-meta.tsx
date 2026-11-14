import { useEffect } from "react";

const TITLE = "Driftwall — Your desktop, alive";
const DESCRIPTION =
  "A native macOS wallpaper app for static and animated wallpapers. Power-aware, watermark-free, light on memory, with built-in YouTube and local music.";

/**
 * x (this version of @thexjs/core) always ships `<title>x app</title>` for
 * server-rendered pages, and islands are hydrated with no props at all
 * (`React.createElement(Component)`, see packages/core/src/island-bundle.ts)
 * -- so this can't take `title`/`description` as props even though it looks
 * like it should. It patches both in directly on mount instead, which also
 * reaches anything that reads the DOM after hydration (Google and Bing both
 * execute JS before indexing). Swap this out if x adds real per-page SSR
 * meta later; today this is the only page on the site, so one hardcoded
 * pair is enough.
 */
export default function SiteMeta() {
  useEffect(() => {
    document.title = TITLE;
    let tag = document.querySelector('meta[name="description"]');
    if (!tag) {
      tag = document.createElement("meta");
      tag.setAttribute("name", "description");
      document.head.appendChild(tag);
    }
    tag.setAttribute("content", DESCRIPTION);
  }, []);

  return null;
}
