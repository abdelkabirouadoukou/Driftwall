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
  /** Origin source when imported from Discover (e.g. `wallhaven`, `pexels-videos`). */
  source?: string | null;
  /** Attribution page for the original asset. */
  source_url?: string | null;
  /** Original author/uploader, for attribution. */
  author?: string | null;
  /** ISO-8601 timestamp of import. */
  created_at: string;
}

/* ------------------------------------------------------------- discover */

/**
 * Provider an item was discovered from. These ids are stable: they are stored
 * on library entries as attribution. (`pixabay` was the id of Pixabay videos in
 * earlier builds and may still appear on old library entries.)
 */
export type DiscoverSource =
  | 'wallhaven'
  | 'pexels'
  | 'bing'
  | 'nasa'
  | 'pixabay-videos'
  | 'pexels-videos';

/** Result ordering for providers that support it. */
export type DiscoverSort = 'relevance' | 'popular' | 'latest' | 'random';

/** Optional refinements chosen in the Discover toolbar. */
export interface SearchOptions {
  sort: DiscoverSort;
  /** Prefer dark imagery (great for OLED screens). */
  dark: boolean;
}

/** What a source can do and whether its API key is saved (from Rust). */
export interface SourceInfo {
  id: DiscoverSource;
  provider: string;
  kind: DiscoverKind;
  /** Settings entry holding this source's API key, when it has one. */
  key_setting: string | null;
  /** Browsing fails without a key. */
  key_required: boolean;
  /** A key is currently saved. */
  has_key: boolean;
  supports_search: boolean;
  supports_sort: boolean;
}

/** Whether a discovered asset is a still image or a video. */
export type DiscoverKind = 'image' | 'video';

/** A downloadable rendition of a discovered item. */
export interface Rendition {
  key: string;
  label: string;
  url: string;
  width?: number | null;
  height?: number | null;
  size_bytes?: number | null;
  default?: boolean;
}

/** A browsable remote asset returned by `discover_search`. */
export interface DiscoverItem {
  id: string;
  source: DiscoverSource;
  kind: DiscoverKind;
  title: string;
  thumb_url: string;
  full_url: string;
  /** Small clip for hover previews of videos (never the full file). */
  preview_url?: string | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  author?: string | null;
  source_url?: string | null;
  renditions?: Rendition[];
}

/** Download lifecycle phase reported by the Rust engine. */
export type DownloadPhase =
  | 'queued'
  | 'downloading'
  | 'processing'
  | 'done'
  | 'error';

/** A progress snapshot from the `download://` channel. */
export interface DownloadProgress {
  id: string;
  bytes_done: number;
  bytes_total: number | null;
  speed_bps: number;
  phase: DownloadPhase;
  error?: string | null;
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
