/**
 * Application-side domain types for Driftwall's local library.
 *
 * The Rust core owns the library as `library.json` (see
 * `src-tauri/src/store.rs`); `WallpaperRecord` is the wire shape exchanged with
 * the `library_*` Tauri commands. The package manifest types (`.dwpkg`) live in
 * `@driftwall/contracts`.
 */

export type WallpaperKind = 'static' | 'video';

export interface WallpaperRecord {
  /** UUID identifying the wallpaper. */
  id: string;
  /** Static image or looping video. */
  type: WallpaperKind;
  /** Absolute path to the copied media file inside the app data dir. */
  file_path: string;
  /** Display title. */
  title: string;
  /** Tag strings. */
  tags: string[];
  /** Pixel width, when known. */
  width: number | null;
  /** Pixel height, when known. */
  height: number | null;
  /** Duration in seconds for videos, else null. */
  duration: number | null;
  /** ISO-8601 timestamp of import. */
  created_at: string;
}
