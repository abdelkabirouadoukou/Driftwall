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
  /** Origin source when imported from Discover (`wallhaven` / `pixabay`). */
  source?: string | null;
  /** Attribution page for the original asset. */
  source_url?: string | null;
  /** Original author/uploader, for attribution. */
  author?: string | null;
  /** ISO-8601 timestamp of import. */
  created_at: string;
}

/* ------------------------------------------------------------- discover */

/** Provider an item was discovered from. */
export type DiscoverSource = 'wallhaven' | 'pixabay';

/** Whether a discovered asset is a still image or a video. */
export type DiscoverKind = 'image' | 'video';

/** A browsable remote asset returned by `discover_search`. */
export interface DiscoverItem {
  id: string;
  source: DiscoverSource;
  kind: DiscoverKind;
  title: string;
  thumb_url: string;
  full_url: string;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  author?: string | null;
  source_url?: string | null;
}

/** One page of Discover results. */
export interface DiscoverPage {
  items: DiscoverItem[];
  page: number;
  has_more: boolean;
}

/** Result of streaming a remote asset into the library directory. */
export interface DownloadedFile {
  id: string;
  file_path: string;
  kind: DiscoverKind;
  title: string;
  source: DiscoverSource;
  source_url?: string | null;
  author?: string | null;
}
