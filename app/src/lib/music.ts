/** Music playlist helpers (pure, unit-tested). */

export interface MusicTrack {
  id: string;
  kind: 'youtube' | 'file';
  title: string;
  /** YouTube video id (kind === 'youtube'). */
  video_id?: string;
  /** Start offset in seconds (kind === 'youtube'). */
  start?: number;
  /** Absolute path of the copied audio file (kind === 'file'). */
  path?: string;
}

export type RepeatMode = 'off' | 'all' | 'one';

/** Snapshot the main window broadcasts so the menu-bar panel can mirror it. */
export interface MusicState {
  playing: boolean;
  title: string;
  index: number;
  count: number;
  volume: number;
  progress: number;
  duration: number;
  shuffle: boolean;
  repeat: RepeatMode;
}

export type MusicCommand =
  | { type: 'toggle' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'volume'; value: number }
  | { type: 'seek'; value: number }
  | { type: 'shuffle'; value: boolean }
  | { type: 'repeat'; value: RepeatMode }
  | { type: 'request-state' };

export const MUSIC_STATE_EVENT = 'music-state';
export const MUSIC_CMD_EVENT = 'music-cmd';
export const MUSIC_SETTING_KEY = 'music_tracks';

const ID_RE = /^[\w-]{11}$/;
const YT_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'www.youtube-nocookie.com',
  'youtu.be',
]);

/** "3927", "3927s", "1h2m3s", "2m10s" -> seconds. Returns 0 when unparseable. */
export function parseTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const v = value.trim().toLowerCase();
  if (/^\d+$/.test(v)) return Number(v);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(v);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** Extracts the video id (and start time) from any common YouTube link. */
export function parseYouTubeUrl(raw: string): { videoId: string; start: number } | null {
  const text = raw.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!YT_HOSTS.has(url.hostname.toLowerCase())) return null;

  let id: string | null = null;
  if (url.hostname.toLowerCase() === 'youtu.be') {
    id = url.pathname.split('/')[1] ?? null;
  } else if (url.pathname === '/watch') {
    id = url.searchParams.get('v');
  } else {
    const m = /^\/(?:shorts|embed|live|v)\/([^/?#]+)/.exec(url.pathname);
    id = m ? m[1] : null;
  }
  if (!id || !ID_RE.test(id)) return null;
  const start = parseTimestamp(url.searchParams.get('t') ?? url.searchParams.get('start'));
  return { videoId: id, start };
}

/** Index after `current`, wrapping; -1 for an empty list. */
export function stepIndex(current: number, count: number, delta: 1 | -1): number {
  if (count <= 0) return -1;
  return (((current + delta) % count) + count) % count;
}

/** off -> all -> one -> off, for the repeat button. */
export function nextRepeatMode(mode: RepeatMode): RepeatMode {
  if (mode === 'off') return 'all';
  if (mode === 'all') return 'one';
  return 'off';
}

/** mm:ss (or h:mm:ss past an hour), for the seek bar. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Friendly default title for a not-yet-loaded YouTube track. */
export function placeholderTitle(videoId: string): string {
  return `YouTube · ${videoId}`;
}

/** File name without directory or extension, for local tracks. */
export function titleFromPath(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Friendly text for a YouTube IFrame API error code
 * (https://developers.google.com/youtube/iframe_api_reference#onError).
 */
export function youtubeErrorMessage(code: number): string {
  switch (code) {
    case 2:
      return 'That YouTube link has an invalid video id.';
    case 5:
      return 'YouTube’s player hit an error on this video.';
    case 100:
      return 'That video was removed or is private.';
    case 101:
    case 150:
      return 'The owner of that video does not allow it to play in other apps.';
    case 153:
      return 'YouTube refused to play inside the app (error 153: missing referrer).';
    default:
      return `YouTube could not play this video (error ${code}).`;
  }
}
