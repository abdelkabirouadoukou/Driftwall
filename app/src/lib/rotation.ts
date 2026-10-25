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

/** Units offered next to the rotation interval input. */
export type IntervalUnit = 'seconds' | 'minutes' | 'hours';

const UNIT_SECS: Record<IntervalUnit, number> = { seconds: 1, minutes: 60, hours: 3600 };

/** Value typed in the UI + its unit -> seconds, never below the floor. */
export function toSecs(value: number, unit: IntervalUnit): number {
  if (!Number.isFinite(value) || value <= 0) return MIN_INTERVAL_SECS;
  return Math.max(MIN_INTERVAL_SECS, Math.round(value * UNIT_SECS[unit]));
}

/** Seconds -> the friendliest whole `value` + `unit` pair for the UI. */
export function fromSecs(secs: number): { value: number; unit: IntervalUnit } {
  const s = Number.isFinite(secs) && secs > 0 ? Math.round(secs) : DEFAULT_INTERVAL_SECS;
  if (s % 3600 === 0) return { value: s / 3600, unit: 'hours' };
  if (s % 60 === 0) return { value: s / 60, unit: 'minutes' };
  if (s < 120) return { value: s, unit: 'seconds' };
  return { value: Math.round((s / 60) * 100) / 100, unit: 'minutes' };
}

/** "in 4 min", "in 25 s", "in 2 h 5 min" for a countdown to the next change. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
