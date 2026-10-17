/**
 * Pure helpers for the wallpaper library: file naming, title derivation, and
 * UUID generation.
 *
 * Kept free of Tauri/DOM imports so they are trivially unit-testable.
 */

import { classifyMedia } from './media.ts';

/** Filename used to store an imported file: `<uuid>.<ext>` (extension lowercased). */
export function storedFileName(id: string, sourcePath: string): string {
  const base = sourcePath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  return ext ? `${id}.${ext}` : id;
}

/** Filename used to store a generated thumbnail for a wallpaper id. */
export function thumbnailFileName(id: string): string {
  return `${id}.thumb.png`;
}

/** Collapses whitespace, trims, truncates to 200 chars. */
export function sanitizeTitle(input: string): string {
  return input.replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** Derives a display title from a source path (strips directories + extension). */
export function titleFromPath(path: string): string {
  const base = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return sanitizeTitle(stem) || 'Untitled';
}

/** True when the path is accepted media (image or supported video). */
export function isAcceptedMedia(path: string): boolean {
  return classifyMedia(path) !== null;
}

/** RFC 4122 v4 UUID, using the platform RNG when available. */
export function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return (
    `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-` +
    `${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-` +
    `${hex.slice(10, 16).join('')}`
  );
}
