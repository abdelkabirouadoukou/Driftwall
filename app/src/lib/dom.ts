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
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LIBRARY_CHANGED_EVENT));
}

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
 * Re-dispatches wallpaper changes made in another window (or by the Rust
 * rotation timer) as the local DOM event. Returns the cleanup function.
 */
export function bridgeWallpaperEvents(): () => void {
  if (!inTauriWindow()) return () => undefined;
  let disposed = false;
  let unlisten: (() => void) | undefined;
  void listen<{ from?: string }>(WALLPAPER_TAURI_EVENT, (event) => {
    if (event.payload?.from === windowLabel()) return;
    window.dispatchEvent(new Event(WALLPAPER_CHANGED_EVENT));
  })
    .then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    })
    .catch(() => undefined);
  return () => {
    disposed = true;
    unlisten?.();
  };
}
