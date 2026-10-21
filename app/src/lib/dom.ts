// The single scroll container for every view (see `.content` in theme.css).
// Views that need to observe their own scrolling (e.g. Discover's infinite
// scroll) must use this element as the IntersectionObserver root, since
// neither <body> nor the viewport scrolls.
export const MAIN_SCROLL_ID = 'main-scroll';

export function mainScrollElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById(MAIN_SCROLL_ID);
}

/**
 * Fired on `window` whenever the library changes outside the view showing it
 * (e.g. a Discover download finishes while Library or Home is open), so those
 * views can reload.
 */
export const LIBRARY_CHANGED_EVENT = 'driftwall:library-changed';

export function notifyLibraryChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LIBRARY_CHANGED_EVENT));
}
