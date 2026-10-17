// The single scroll container for every view (see `.content` in theme.css).
// Views that need to observe their own scrolling (e.g. Discover's infinite
// scroll) must use this element as the IntersectionObserver root, since
// neither <body> nor the viewport scrolls.
export const MAIN_SCROLL_ID = 'main-scroll';

export function mainScrollElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById(MAIN_SCROLL_ID);
}
