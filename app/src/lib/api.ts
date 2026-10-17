/**
 * Typed wrapper around Tauri's `invoke`.
 *
 * Every command the UI calls goes through here so there is a single place that
 * (a) knows the command names and argument shapes, and (b) guards against the
 * page running outside the Tauri webview — where `invoke` would otherwise throw
 * a raw `TypeError`.
 */

import { invoke } from '@tauri-apps/api/core';
import type { WallpaperRecord } from './domain.ts';

/** Friendly, user-facing message for the "opened in a browser" case. */
export const NOT_IN_TAURI_MESSAGE =
  'Open the Driftwall app window, not the browser.';

/** Thrown by the API helpers when no Tauri runtime is present. */
export class NotInTauriError extends Error {
  constructor() {
    super(NOT_IN_TAURI_MESSAGE);
    this.name = 'NotInTauriError';
  }
}

/** True when running inside the Tauri webview. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) return Promise.reject(new NotInTauriError());
  return invoke<T>(command, args);
}

/** All wallpapers, newest first. */
export function libraryList(): Promise<WallpaperRecord[]> {
  return call<WallpaperRecord[]>('library_list');
}

/** Adds (or replaces, by id) a wallpaper entry. */
export function libraryAdd(wallpaper: WallpaperRecord): Promise<void> {
  return call<void>('library_add', { wallpaper });
}

/** Renames a wallpaper by id. */
export function libraryRename(id: string, title: string): Promise<void> {
  return call<void>('library_rename', { id, title });
}

/** Removes a wallpaper and its copied media + thumbnail files. */
export function libraryDelete(id: string): Promise<void> {
  return call<void>('library_delete', { id });
}

/** Reads a persisted setting value, or `null` when unset. */
export function settingsGet<T>(key: string): Promise<T | null> {
  return call<T | null>('settings_get', { key });
}

/** Writes a persisted setting value. */
export function settingsSet<T>(key: string, value: T): Promise<void> {
  return call<void>('settings_set', { key, value });
}

/** Current Dock-mode preference. */
export function getDockMode(): Promise<boolean> {
  return call<boolean>('get_dock_mode');
}

/** Sets the Dock-mode preference. */
export function setDockMode(dock: boolean): Promise<void> {
  return call<void>('set_dock_mode', { dock });
}
