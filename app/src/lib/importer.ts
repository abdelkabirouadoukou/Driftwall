/**
 * Import/export side of the library (Tauri-dependent).
 *
 * Import flow: pick files -> validate format -> copy into the app data dir
 * under a UUID filename -> probe dimensions/duration + render a thumbnail ->
 * insert a row. Files that fail to decode are removed and reported. No
 * transcoding occurs.
 */

import { open } from '@tauri-apps/plugin-dialog';
import { copyFile, remove, writeFile } from '@tauri-apps/plugin-fs';
import { convertFileSrc } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  classifyMedia,
  rejectionMessage,
} from './media.ts';
import {
  serializeTags,
  storedFileName,
  thumbnailFileName,
  titleFromPath,
  uuid,
} from './library.ts';
import { insertWallpaper, deleteWallpaperRow } from './db.ts';
import { ensureDirs, wallpapersDir, thumbnailsDir } from './paths.ts';
import { probeMedia } from './probe.ts';
import type { WallpaperRecord } from './domain.ts';

export interface Rejection {
  path: string;
  reason: string;
}

export interface ImportSummary {
  imported: number;
  rejected: Rejection[];
}

/** Opens a file picker and imports the chosen media. */
export async function importWallpapers(): Promise<ImportSummary> {
  const selected = await open({
    multiple: true,
    directory: false,
    filters: [
      {
        name: 'Wallpapers',
        extensions: [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS],
      },
    ],
  });
  if (!selected) return { imported: 0, rejected: [] };
  const paths = Array.isArray(selected) ? selected : [selected];
  return importPaths(paths);
}

/** Imports an explicit list of source paths. */
export async function importPaths(paths: readonly string[]): Promise<ImportSummary> {
  await ensureDirs();
  const wDir = await wallpapersDir();
  const tDir = await thumbnailsDir();
  const rejected: Rejection[] = [];
  let imported = 0;

  for (const src of paths) {
    const kind = classifyMedia(src);
    if (!kind) {
      rejected.push({ path: src, reason: rejectionMessage(src) });
      continue;
    }

    const id = uuid();
    const dest = await join(wDir, storedFileName(id, src));

    try {
      await copyFile(src, dest);
      const probe = await probeMedia(convertFileSrc(dest), kind);
      if (!probe) {
        await remove(dest).catch(() => undefined);
        rejected.push({
          path: src,
          reason: `Could not decode ${src}. Driftwall accepts images and H.264/HEVC video only.`,
        });
        continue;
      }

      if (probe.thumbnail) {
        await writeFile(await join(tDir, thumbnailFileName(id)), probe.thumbnail);
      }

      await insertWallpaper({
        id,
        type: kind,
        file_path: dest,
        title: titleFromPath(src),
        tags: serializeTags([]),
        width: probe.width,
        height: probe.height,
        duration: probe.duration,
        created_at: new Date().toISOString(),
      });
      imported += 1;
    } catch (error) {
      await remove(dest).catch(() => undefined);
      rejected.push({
        path: src,
        reason: `Failed to import ${src}: ${String(error)}`,
      });
    }
  }

  return { imported, rejected };
}


/** Deletes the DB row plus the copied media and thumbnail for a wallpaper. */
export async function deleteWallpaper(item: WallpaperRecord): Promise<void> {
  await deleteWallpaperRow(item.id);
  await remove(item.file_path).catch(() => undefined);
  await remove(await join(await thumbnailsDir(), thumbnailFileName(item.id))).catch(
    () => undefined,
  );
}
