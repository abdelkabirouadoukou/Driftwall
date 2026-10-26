/**
 * Talks to the YouTube player page served by the app's local HTTP server
 * (see `src-tauri/src/player_server.rs` and `src-tauri/player/player.js`).
 *
 * The player lives in an <iframe> on `http://localhost:<port>` because YouTube
 * refuses to play inside `tauri://localhost` (error 153). This module wraps
 * that iframe in the small subset of the YouTube player API the app uses.
 */

export type PlayerMessage =
  | { type: 'ready' }
  | { type: 'state'; state: number; title: string; muted: boolean }
  | { type: 'error'; code: number };

/** Validates a message coming from the player page; anything odd is dropped. */
export function parsePlayerMessage(data: unknown): PlayerMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const msg = data as Record<string, unknown>;
  switch (msg.type) {
    case 'ready':
      return { type: 'ready' };
    case 'state':
      if (typeof msg.state !== 'number') return null;
      return {
        type: 'state',
        state: msg.state,
        title: typeof msg.title === 'string' ? msg.title : '',
        muted: msg.muted === true,
      };
    case 'error':
      return typeof msg.code === 'number' ? { type: 'error', code: msg.code } : null;
    default:
      return null;
  }
}

export interface YTPlayer {
  loadVideoById(options: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  setVolume(volume: number): void;
  unMute(): void;
  isMuted(): boolean;
  getVideoData(): { title?: string };
  /** Paints the player page's own background (visible if the video letterboxes). */
  setTint(hex: string): void;
}

export interface YTEvents {
  onState: (event: { state: number; title: string; muted: boolean }) => void;
  onError: (code: number) => void;
}

const READY_TIMEOUT_MS = 20_000;

/**
 * Creates the player iframe inside `mount` and resolves once YouTube's player
 * inside it is ready. Only messages from that exact iframe and origin count.
 */
export function createYouTubePlayer(
  mount: HTMLElement,
  pageUrl: string,
  events: YTEvents,
): Promise<YTPlayer> {
  return new Promise<YTPlayer>((resolve, reject) => {
    const origin = new URL(pageUrl).origin;
    const frame = document.createElement('iframe');
    frame.src = pageUrl;
    frame.title = 'YouTube player';
    frame.allow = 'autoplay; encrypted-media';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';

    let volume = 80;
    let muted = false;
    let title = '';
    let settled = false;

    const post = (message: Record<string, unknown>) => {
      frame.contentWindow?.postMessage(message, origin);
    };

    const player: YTPlayer = {
      loadVideoById: ({ videoId, startSeconds }) =>
        post({ type: 'load', videoId, start: startSeconds ?? 0, volume }),
      playVideo: () => post({ type: 'play' }),
      pauseVideo: () => post({ type: 'pause' }),
      setVolume: (value) => {
        volume = value;
        post({ type: 'volume', value });
      },
      unMute: () => {
        muted = false;
        post({ type: 'volume', value: volume });
      },
      isMuted: () => muted,
      getVideoData: () => ({ title }),
      setTint: (hex) => post({ type: 'tint', color: hex }),
    };

    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('The YouTube player did not start in time.'));
    }, READY_TIMEOUT_MS);

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.origin !== origin) return;
      const msg = parsePlayerMessage(event.data);
      if (!msg) return;
      if (msg.type === 'ready') {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(player);
      } else if (msg.type === 'state') {
        muted = msg.muted;
        title = msg.title;
        events.onState(msg);
      } else if (!settled && msg.code === -1) {
        settled = true;
        window.clearTimeout(timer);
        reject(new Error('Could not load the YouTube player (offline?).'));
      } else {
        events.onError(msg.code);
      }
    });

    frame.addEventListener('load', () => post({ type: 'init' }));
    mount.replaceChildren(frame);
  });
}
