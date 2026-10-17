/**
 * Tauri path helpers for Driftwall's on-disk library. All media lives under the
 * app data directory so the library is self-contained and easy to back up.
 */

import { convertFileSrc } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import { mkdir } from '@tauri-apps/plugin-fs';
import { thumbnailFileName } from './library.ts';

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

/** Resolves asset-protocol URLs for each wallpaper's generated thumbnail. */
export async function resolveThumbUrls(
  ids: readonly string[],
): Promise<Record<string, string>> {
  const dir = await thumbnailsDir();
  const out: Record<string, string> = {};
  for (const id of ids) {
    out[id] = convertFileSrc(await join(dir, thumbnailFileName(id)));
  }
  return out;
}
