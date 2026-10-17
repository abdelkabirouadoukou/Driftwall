/**
 * Canonical TypeScript types for the Driftwall `.dwpkg` package manifest.
 *
 * These types are the single source of truth for the manifest shape shared by
 * the macOS app (`app/`) and the hosted backend (`backend/`). The machine-readable
 * JSON Schema that mirrors these types lives in `dwpkg.manifest.schema.json`.
 */

/** Whether a wallpaper is a still image or a looping video. */
export type WallpaperType = 'static' | 'video';

/** Role a file plays inside a package. */
export type FileRole = 'source' | 'thumbnail';

/** How the wallpaper is fitted to a display. */
export type ScaleMode = 'fill' | 'fit' | 'stretch' | 'center';

/** Where the wallpaper is anchored when it does not fill the display. */
export type Anchor =
  | 'center'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

/** A single file contained in the package. */
export interface DwpkgFile {
  /** Purpose of the file within the package. */
  role: FileRole;
  /** Relative POSIX path inside the package. Never absolute, never contains `..`. */
  path: string;
  /** Size in bytes (must be >= 1). */
  bytes: number;
  /** Lowercase hex SHA-256 digest of the file contents (64 chars). */
  sha256: string;
}

/** Loop configuration for a video wallpaper. */
export interface DwpkgLoop {
  /** Loop start time in seconds (>= 0). */
  start: number;
  /** Loop end time in seconds (> start). */
  end: number;
  /** Whether the loop plays muted. Defaults to `true`. */
  muted?: boolean;
}

/** Per-display presentation configuration. */
export interface DwpkgDisplayConfig {
  /** Target display id, or `null` for the default (all displays). */
  displayId?: string | null;
  /** How the wallpaper is fitted to the display. */
  scaleMode: ScaleMode;
  /** Anchor point used when the wallpaper does not fill the display. */
  anchor?: Anchor;
}

/** The current manifest schema version. */
export const MANIFEST_VERSION = 1 as const;

/**
 * The `.dwpkg` package manifest.
 *
 * `loop` is only permitted when `type === 'video'`.
 */
export interface DwpkgManifest {
  /** Schema version. Always `1` for now. */
  manifestVersion: typeof MANIFEST_VERSION;
  /** UUID v1-5 identifying the wallpaper. */
  id: string;
  /** Human-readable title. */
  title: string;
  /** Wallpaper kind. */
  type: WallpaperType;
  /** Files contained in the package. At least one. */
  files: DwpkgFile[];
  /** Free-form tags. Defaults to an empty array. */
  tags?: string[];
  /** Loop configuration (video only). */
  loop?: DwpkgLoop;
  /** Per-display configuration. */
  displays?: DwpkgDisplayConfig[];
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** Optional author/attribution string. */
  author?: string;
}
