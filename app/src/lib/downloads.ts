/**
 * Pure state + formatting for Discover downloads.
 *
 * The React provider (`components/Downloads.tsx`) owns the side effects (the
 * Tauri channel, importing the finished file); everything decidable without a
 * browser lives here so it can be unit tested.
 */

import type {
  DiscoverItem,
  DiscoverKind,
  DownloadPhase,
  DownloadProgress,
  Rendition,
} from './domain.ts';

export interface DownloadEntry {
  /** The discover item id; also the id the Rust engine tracks. */
  id: string;
  title: string;
  /** Thumbnail shown in the downloads list. */
  thumb: string;
  kind: DiscoverKind;
  phase: DownloadPhase;
  bytesDone: number;
  /** Unknown when the server sends no Content-Length. */
  bytesTotal: number | null;
  speedBps: number;
  error: string | null;
  startedAt: number;
  /** Label of the chosen quality, e.g. "1080p". */
  qualityLabel: string | null;
  /** Library id once the file has been imported. */
  recordId: string | null;
}

export type DownloadAction =
  | { type: 'start'; item: DiscoverItem; rendition: Rendition | null; now: number }
  | { type: 'progress'; progress: DownloadProgress }
  | { type: 'processing'; id: string }
  | { type: 'done'; id: string; recordId: string }
  | { type: 'fail'; id: string; error: string }
  | { type: 'remove'; id: string }
  | { type: 'clear-finished' };

/** Order phases only move forward in, so late events cannot rewind the UI. */
const PHASE_RANK: Record<DownloadPhase, number> = {
  queued: 0,
  downloading: 1,
  processing: 2,
  done: 3,
  error: 3,
};

/** True while the download is still working (not finished or failed). */
export function isActive(entry: Pick<DownloadEntry, 'phase'>): boolean {
  return entry.phase === 'queued' || entry.phase === 'downloading' || entry.phase === 'processing';
}

/** Picks a rendition by key, else the default, else the first one. */
export function pickRendition(item: DiscoverItem, key?: string | null): Rendition | null {
  const list = item.renditions ?? [];
  if (list.length === 0) return null;
  return (
    (key ? list.find((r) => r.key === key) : undefined) ??
    list.find((r) => r.default) ??
    list[0] ??
    null
  );
}

function patch(
  state: DownloadEntry[],
  id: string,
  change: (entry: DownloadEntry) => DownloadEntry,
): DownloadEntry[] {
  let touched = false;
  const next = state.map((entry) => {
    if (entry.id !== id) return entry;
    touched = true;
    return change(entry);
  });
  return touched ? next : state;
}

export function downloadsReducer(
  state: DownloadEntry[],
  action: DownloadAction,
): DownloadEntry[] {
  switch (action.type) {
    case 'start': {
      const existing = state.find((e) => e.id === action.item.id);
      if (existing && isActive(existing)) return state;
      const entry: DownloadEntry = {
        id: action.item.id,
        title: action.item.title,
        thumb: action.item.thumb_url,
        kind: action.item.kind,
        phase: 'queued',
        bytesDone: 0,
        bytesTotal: null,
        speedBps: 0,
        error: null,
        startedAt: action.now,
        qualityLabel: action.rendition?.label ?? null,
        recordId: null,
      };
      return [entry, ...state.filter((e) => e.id !== entry.id)];
    }

    case 'progress': {
      const { progress } = action;
      return patch(state, progress.id, (entry) => {
        if (entry.phase === 'done' || entry.phase === 'error') return entry;
        // The Rust side says "done" once the bytes are on disk; the webview
        // still has to probe and thumbnail the file, so that is "processing".
        const incoming: DownloadPhase = progress.phase === 'done' ? 'processing' : progress.phase;
        if (incoming === 'error') {
          return {
            ...entry,
            phase: 'error',
            error: progress.error ?? 'Download failed.',
            speedBps: 0,
          };
        }
        if (PHASE_RANK[incoming] < PHASE_RANK[entry.phase]) return entry;
        return {
          ...entry,
          phase: incoming,
          bytesDone: Math.max(entry.bytesDone, progress.bytes_done),
          bytesTotal: progress.bytes_total ?? entry.bytesTotal,
          speedBps: incoming === 'downloading' ? progress.speed_bps : 0,
        };
      });
    }

    case 'processing':
      return patch(state, action.id, (entry) =>
        entry.phase === 'done' || entry.phase === 'error'
          ? entry
          : { ...entry, phase: 'processing', speedBps: 0 },
      );

    case 'done':
      return patch(state, action.id, (entry) => ({
        ...entry,
        phase: 'done',
        speedBps: 0,
        error: null,
        recordId: action.recordId,
        bytesDone: entry.bytesTotal ?? entry.bytesDone,
      }));

    case 'fail':
      return patch(state, action.id, (entry) => ({
        ...entry,
        phase: 'error',
        error: action.error,
        speedBps: 0,
      }));

    case 'remove':
      return state.filter((entry) => entry.id !== action.id);

    case 'clear-finished':
      return state.filter(isActive);
  }
}

/** Fraction complete in [0, 1], or `null` when the total size is unknown. */
export function progressFraction(entry: DownloadEntry): number | null {
  if (entry.phase === 'done' || entry.phase === 'processing') return 1;
  if (!entry.bytesTotal || entry.bytesTotal <= 0) return null;
  return Math.min(1, Math.max(0, entry.bytesDone / entry.bytesTotal));
}

/** "18.4 MB" (decimal units, like Finder). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

/** "4.2 MB/s", or an em dash when speed is unknown. */
export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '—';
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** Remaining time like "12 s left" or "1 min 5 s left"; `null` when unknown. */
export function formatEta(entry: DownloadEntry): string | null {
  if (entry.phase !== 'downloading') return null;
  if (!entry.bytesTotal || entry.speedBps <= 0) return null;
  const remaining = Math.max(0, entry.bytesTotal - entry.bytesDone);
  const exact = remaining / entry.speedBps;
  if (exact < 1.5) return 'almost done';
  const seconds = Math.ceil(exact);
  if (seconds < 60) return `${seconds} s left`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = seconds % 60;
    return rest === 0 ? `${minutes} min left` : `${minutes} min ${rest} s left`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min left`;
}

/** One line of status text for a download. */
export function describeProgress(entry: DownloadEntry): string {
  switch (entry.phase) {
    case 'queued':
      return 'Waiting for a free slot…';
    case 'processing':
      return 'Adding to your library…';
    case 'done':
      return 'Added to your library';
    case 'error':
      return entry.error ?? 'Download failed';
    case 'downloading': {
      const parts: string[] = [];
      parts.push(
        entry.bytesTotal
          ? `${formatBytes(entry.bytesDone)} of ${formatBytes(entry.bytesTotal)}`
          : formatBytes(entry.bytesDone),
      );
      if (entry.speedBps > 0) parts.push(formatSpeed(entry.speedBps));
      const eta = formatEta(entry);
      if (eta) parts.push(eta);
      return parts.join(' · ');
    }
  }
}
