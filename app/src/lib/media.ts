/**
 * Media classification for Driftwall's importer.
 *
 * Driftwall accepts common still images and H.264/HEVC video containers.
 * Anything else is rejected with a clear message (no software transcoding).
 */

export type MediaKind = 'static' | 'video';

/** Still-image extensions Driftwall accepts. */
export const IMAGE_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'tif',
  'tiff',
] as const;

/** Video container extensions Driftwall accepts (H.264 / HEVC expected inside). */
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v'] as const;

/** Returns the lowercase extension (without the dot) of a path, or `''`. */
export function extensionOf(path: string): string {
  const withoutTrailingSlash = path.replace(/[\\/]+$/, '');
  const base = withoutTrailingSlash.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

/** Classifies a path as `'static'`, `'video'`, or `null` when unsupported. */
export function classifyMedia(path: string): MediaKind | null {
  const ext = extensionOf(path);
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return 'video';
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return 'static';
  return null;
}

/** True when the path has an accepted image or video extension. */
export function isSupported(path: string): boolean {
  return classifyMedia(path) !== null;
}

/** Human-readable rejection reason for an unsupported path. */
export function rejectionMessage(path: string): string {
  const ext = extensionOf(path);
  const shown = ext ? `.${ext}` : '(no extension)';
  return (
    `Unsupported format ${shown}: ${path}. Driftwall accepts images ` +
    `(${IMAGE_EXTENSIONS.join(', ')}) and H.264/HEVC video ` +
    `(${VIDEO_EXTENSIONS.join(', ')}).`
  );
}
