/**
 * SQLite access for the wallpaper library, via `tauri-plugin-sql`.
 *
 * The schema (see the Rust-side migrations in `src-tauri/src/main.rs`) stores
 * one row per imported wallpaper. Tags are stored as a JSON-encoded array.
 */

import Database from '@tauri-apps/plugin-sql';
import { convertFileSrc } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import type { WallpaperKind, WallpaperRecord } from './domain.ts';
import { thumbnailFileName } from './library.ts';
import { thumbnailsDir } from './paths.ts';

const DB_URL = 'sqlite:driftwall.db';

let handle: Database | null = null;

/** Loads the SQLite database (migrations run inside the Rust plugin). */
export async function initDb(): Promise<void> {
  if (handle) return;
  handle = await Database.load(DB_URL);
}

function db(): Database {
  if (!handle) throw new Error('Database not initialised');
  return handle;
}

/** All wallpapers, newest first. */
export async function listWallpapers(): Promise<WallpaperRecord[]> {
  return db().select<WallpaperRecord[]>(
    'SELECT * FROM wallpapers ORDER BY created_at DESC',
  );
}

export interface NewWallpaper {
  id: string;
  type: WallpaperKind;
  file_path: string;
  title: string;
  tags: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  created_at: string;
}

/** Inserts a new wallpaper row. */
export async function insertWallpaper(row: NewWallpaper): Promise<void> {
  await db().execute(
    `INSERT INTO wallpapers (id, type, file_path, title, tags, width, height, duration, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      row.id,
      row.type,
      row.file_path,
      row.title,
      row.tags,
      row.width,
      row.height,
      row.duration,
      row.created_at,
    ],
  );
}

/** Updates a wallpaper's title. */
export async function renameWallpaper(id: string, title: string): Promise<void> {
  await db().execute('UPDATE wallpapers SET title = $1 WHERE id = $2', [title, id]);
}

/** Deletes a wallpaper row by id. */
export async function deleteWallpaperRow(id: string): Promise<void> {
  await db().execute('DELETE FROM wallpapers WHERE id = $1', [id]);
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
