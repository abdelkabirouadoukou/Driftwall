import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

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
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(LIBRARY_CHANGED_EVENT));
  // Tell the other windows (menu-bar panel <-> main window) too.
  if (inTauriWindow()) {
    void emit(LIBRARY_TAURI_EVENT, { from: windowLabel() }).catch(() => undefined);
  }
}

/** Name of the Tauri event that carries library changes between windows. */
export const LIBRARY_TAURI_EVENT = 'driftwall:library-changed';

/**
 * Fired on `window` whenever the applied wallpaper or rotation changes (set,
 * stopped, restored, or a rotation saved/advanced), so Home/Library/Displays
 * can refresh their "now playing" state without polling.
 */
export const WALLPAPER_CHANGED_EVENT = 'driftwall:wallpaper-changed';

export function notifyWallpaperChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(WALLPAPER_CHANGED_EVENT));
  // Tell the other windows (menu-bar panel <-> main window) too.
  if (inTauriWindow()) {
    void emit(WALLPAPER_TAURI_EVENT, { from: windowLabel() }).catch(() => undefined);
  }
}

/** Name of the Tauri event that carries wallpaper changes between windows. */
export const WALLPAPER_TAURI_EVENT = 'driftwall:wallpaper-changed';

function inTauriWindow(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function windowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    return '';
  }
}

/**
 * Re-dispatches wallpaper and library changes made in another window (or by
 * the Rust side: imports, deletes, the rotation timer) as local DOM events, so
 * every view and the menu-bar panel stay in sync with the library.
 * Returns the cleanup function.
 */
export function bridgeWallpaperEvents(): () => void {
  if (!inTauriWindow()) return () => undefined;
  let disposed = false;
  const unlisteners: Array<() => void> = [];

  const watch = (tauriEvent: string, domEvent: string) => {
    void listen<{ from?: string }>(tauriEvent, (event) => {
      if (event.payload?.from === windowLabel()) return;
      window.dispatchEvent(new Event(domEvent));
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisteners.push(fn);
      })
      .catch(() => undefined);
  };

  watch(WALLPAPER_TAURI_EVENT, WALLPAPER_CHANGED_EVENT);
  watch(LIBRARY_TAURI_EVENT, LIBRARY_CHANGED_EVENT);

  return () => {
    disposed = true;
    for (const fn of unlisteners) fn();
    unlisteners.length = 0;
  };
}
