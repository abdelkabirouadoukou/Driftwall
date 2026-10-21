/** Mirrors `MIN_INTERVAL_SECS` in `src-tauri/src/engine.rs`. */
export const MIN_INTERVAL_SECS = 15;
/** Matches `Playlist::default()` in Rust: 30 minutes. */
export const DEFAULT_INTERVAL_SECS = 30 * 60;

/** Rotation interval in seconds -> minutes shown in the UI (max 2 decimals). */
export function secsToMinutes(secs: number): number {
  if (!Number.isFinite(secs) || secs <= 0) return DEFAULT_INTERVAL_SECS / 60;
  return Math.round((secs / 60) * 100) / 100;
}

/** Minutes typed in the UI -> seconds, never below the server-side floor. */
export function minutesToSecs(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_INTERVAL_SECS;
  return Math.max(MIN_INTERVAL_SECS, Math.round(minutes * 60));
}
