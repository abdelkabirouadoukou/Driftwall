/**
 * Tauri path helpers for Driftwall's on-disk library. All media lives under the
 * app data directory so the library is self-contained and easy to back up.
 */

import { appDataDir, join } from '@tauri-apps/api/path';
import { mkdir } from '@tauri-apps/plugin-fs';

/** Absolute path to the directory holding copied media files. */
export async function wallpapersDir(): Promise<string> {
  return join(await appDataDir(), 'wallpapers');
}

/** Absolute path to the directory holding generated thumbnails. */
export async function thumbnailsDir(): Promise<string> {
  return join(await appDataDir(), 'thumbnails');
}

/** Ensures both library directories exist. */
export async function ensureDirs(): Promise<void> {
  await mkdir(await wallpapersDir(), { recursive: true });
  await mkdir(await thumbnailsDir(), { recursive: true });
}
