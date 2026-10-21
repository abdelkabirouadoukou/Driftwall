/**
 * Thumbnail maintenance (Tauri-dependent).
 *
 * Videos frequently produced black thumbnails before probe.ts learned to skip
 * a black first frame, so existing records may hold a black (or missing)
 * thumbnail. These helpers detect that and regenerate the frame in place; the
 * library runs a sweep on load and exposes a manual action in its context menu.
 */

import { convertFileSrc } from '@tauri-apps/api/core';
import { exists, writeFile } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { thumbnailFileName } from './library.ts';
import { thumbnailsDir } from './paths.ts';
import { luminanceOf, probeMedia } from './probe.ts';
import { isBlackLuminance } from './frames.ts';
import type { MediaKind } from './media.ts';
import type { WallpaperRecord } from './domain.ts';

/** Absolute path to a record's stored thumbnail. */
export async function thumbnailPath(id: string): Promise<string> {
  return join(await thumbnailsDir(), thumbnailFileName(id));
}

/** Mean luminance (0-255) of a stored thumbnail; null when unreadable. */
function imageLuminance(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(luminanceOf(img, img.naturalWidth, img.naturalHeight));
    img.onerror = () => resolve(null);
    img.src = convertFileSrc(filePath);
  });
}

/** True when a video's thumbnail is missing or (near) black. */
export async function thumbnailNeedsRepair(record: WallpaperRecord): Promise<boolean> {
  if (record.type !== 'video') return false;
  const path = await thumbnailPath(record.id);
  if (!(await exists(path).catch(() => false))) return true;
  const luminance = await imageLuminance(path);
  return luminance === null || isBlackLuminance(luminance);
}

/**
 * Re-renders a record's thumbnail from the media file and writes it out.
 * Returns false when the media cannot be decoded or yields no frame.
 */
export async function regenerateThumbnail(record: WallpaperRecord): Promise<boolean> {
  const kind: MediaKind = record.type === 'video' ? 'video' : 'static';
  const probe = await probeMedia(convertFileSrc(record.file_path), kind);
  if (!probe?.thumbnail) return false;
  await writeFile(await thumbnailPath(record.id), probe.thumbnail);
  return true;
}

/**
 * Regenerates every video thumbnail that is missing or black. Returns how many
 * were repaired. A single failure never aborts the sweep.
 */
export async function repairVideoThumbnails(
  records: readonly WallpaperRecord[],
): Promise<number> {
  let repaired = 0;
  for (const record of records) {
    if (record.type !== 'video') continue;
    try {
      if (await thumbnailNeedsRepair(record) && await regenerateThumbnail(record)) {
        repaired += 1;
      }
    } catch {
      // ignore and continue with the remaining records
    }
  }
  return repaired;
}
