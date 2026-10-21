import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { appDataDir, join } from '@tauri-apps/api/path';
import { open } from '@tauri-apps/plugin-dialog';
import { copyFile, mkdir } from '@tauri-apps/plugin-fs';
import { FilePlus2, Link2, Music as MusicIcon, Pause, Play, SkipBack, SkipForward, Trash2, Volume2 } from 'lucide-react';
import { useToast } from './Toast.tsx';
import * as api from '../lib/api.ts';
import { assetUrl } from '../lib/paths.ts';
import {
  MUSIC_CMD_EVENT,
  MUSIC_SETTING_KEY,
  MUSIC_STATE_EVENT,
  parseYouTubeUrl,
  placeholderTitle,
  stepIndex,
  titleFromPath,
  type MusicCommand,
  type MusicState,
  type MusicTrack,
} from '../lib/music.ts';

/* ------------------------------------------------------- YouTube iframe API */

interface YTPlayer {
  loadVideoById(options: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  setVolume(volume: number): void;
  getVideoData(): { title?: string };
}

interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      width: string;
      height: string;
      playerVars: Record<string, number>;
      events: {
        onReady: () => void;
        onStateChange: (event: { data: number }) => void;
        onError: (event: { data: number }) => void;
      };
    },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!ytApiPromise) {
    ytApiPromise = new Promise<YTNamespace>((resolve, reject) => {
      window.onYouTubeIframeAPIReady = () => {
        if (window.YT) resolve(window.YT);
      };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => {
        ytApiPromise = null;
        reject(new Error('Could not load the YouTube player (offline?).'));
      };
      document.head.appendChild(script);
    });
  }
  return ytApiPromise;
}

/* ----------------------------------------------------------------- context */

interface MusicApi {
  tracks: MusicTrack[];
  index: number;
  playing: boolean;
  volume: number;
  title: string;
  playAt: (i: number) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  setVolume: (v: number) => void;
  addYouTube: (url: string) => string | null;
  addFiles: () => Promise<void>;
  remove: (id: string) => void;
}

const MusicContext = createContext<MusicApi | null>(null);

export function useMusic(): MusicApi {
  const ctx = useContext(MusicContext);
  if (!ctx) throw new Error('useMusic must be used inside <MusicProvider>');
  return ctx;
}

const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg'];

/**
 * Owns playback for the whole app (so music keeps playing while you browse)
 * and mirrors its state to the menu-bar panel through events. YouTube tracks
 * play through YouTube's official embedded player; local files use <audio>.
 */
export function MusicProvider({ children, showVideo }: { children: ReactNode; showVideo: boolean }) {
  const { toast } = useToast();
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolumeState] = useState(80);
  const [loaded, setLoaded] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const ytRef = useRef<YTPlayer | null>(null);
  const ytPromiseRef = useRef<Promise<YTPlayer> | null>(null);
  const tracksRef = useRef(tracks);
  const indexRef = useRef(index);
  const volumeRef = useRef(volume);
  const playingRef = useRef(playing);
  tracksRef.current = tracks;
  indexRef.current = index;
  volumeRef.current = volume;
  playingRef.current = playing;

  const current = index >= 0 ? tracks[index] : undefined;
  const title = current?.title ?? '';

  // Load + persist the playlist.
  useEffect(() => {
    void api
      .settingsGet<MusicTrack[]>(MUSIC_SETTING_KEY)
      .then((stored) => {
        if (Array.isArray(stored)) setTracks(stored);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    void api.settingsSet(MUSIC_SETTING_KEY, tracks).catch(() => undefined);
  }, [tracks, loaded]);

  const setTrackTitle = useCallback((id: string, next: string) => {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, title: next } : t)));
  }, []);

  const nextRef = useRef<() => void>(() => undefined);

  const ensureYouTube = useCallback((): Promise<YTPlayer> => {
    if (ytPromiseRef.current) return ytPromiseRef.current;
    const promise = loadYouTubeApi().then(
      (YT) =>
        new Promise<YTPlayer>((resolve) => {
          const mount = mountRef.current;
          if (!mount) throw new Error('Player container missing.');
          const player: YTPlayer = new YT.Player(mount, {
            width: '100%',
            height: '100%',
            playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
            events: {
              onReady: () => {
                ytRef.current = player;
                player.setVolume(volumeRef.current);
                resolve(player);
              },
              onStateChange: (event) => {
                // 0 ended, 1 playing, 2 paused
                if (event.data === 0) nextRef.current();
                if (event.data === 1) {
                  setPlaying(true);
                  const cur = tracksRef.current[indexRef.current];
                  const t = player.getVideoData().title;
                  if (cur?.kind === 'youtube' && t && cur.title === placeholderTitle(cur.video_id ?? '')) {
                    setTrackTitle(cur.id, t);
                  }
                }
                if (event.data === 2) setPlaying(false);
              },
              onError: () => {
                setPlaying(false);
                toast('YouTube could not play this video here (it may block embedding).', 'error');
              },
            },
          });
        }),
    );
    ytPromiseRef.current = promise;
    promise.catch(() => {
      ytPromiseRef.current = null;
    });
    return promise;
  }, [setTrackTitle, toast]);

  const playAt = useCallback(
    (i: number) => {
      const track = tracksRef.current[i];
      if (!track) return;
      setIndex(i);
      indexRef.current = i;
      const audio = audioRef.current;
      void (async () => {
        try {
          if (track.kind === 'file' && track.path) {
            ytRef.current?.pauseVideo();
            if (!audio) return;
            audio.src = assetUrl(track.path);
            audio.volume = volumeRef.current / 100;
            await audio.play();
          } else if (track.video_id) {
            audio?.pause();
            const player = await ensureYouTube();
            player.setVolume(volumeRef.current);
            player.loadVideoById({ videoId: track.video_id, startSeconds: track.start ?? 0 });
          }
        } catch (error) {
          setPlaying(false);
          toast(`Could not play: ${String(error)}`, 'error');
        }
      })();
    },
    [ensureYouTube, toast],
  );

  const next = useCallback(() => {
    const i = stepIndex(indexRef.current, tracksRef.current.length, 1);
    if (i >= 0) playAt(i);
  }, [playAt]);
  nextRef.current = next;

  const prev = useCallback(() => {
    const i = stepIndex(indexRef.current, tracksRef.current.length, -1);
    if (i >= 0) playAt(i);
  }, [playAt]);

  const toggle = useCallback(() => {
    const track = tracksRef.current[indexRef.current];
    if (!track) {
      if (tracksRef.current.length > 0) playAt(0);
      return;
    }
    if (track.kind === 'file') {
      const audio = audioRef.current;
      if (!audio) return;
      if (audio.paused) void audio.play().catch(() => undefined);
      else audio.pause();
    } else if (playingRef.current) {
      ytRef.current?.pauseVideo();
    } else {
      ytRef.current?.playVideo();
    }
  }, [playAt]);

  const setVolume = useCallback((value: number) => {
    const v = Math.min(100, Math.max(0, Math.round(value)));
    setVolumeState(v);
    volumeRef.current = v;
    if (audioRef.current) audioRef.current.volume = v / 100;
    ytRef.current?.setVolume(v);
  }, []);

  const addYouTube = useCallback((url: string): string | null => {
    const parsed = parseYouTubeUrl(url);
    if (!parsed) return 'That doesn’t look like a YouTube link.';
    setTracks((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        kind: 'youtube',
        title: placeholderTitle(parsed.videoId),
        video_id: parsed.videoId,
        start: parsed.start,
      },
    ]);
    return null;
  }, []);

  const addFiles = useCallback(async () => {
    try {
      const picked = await open({
        multiple: true,
        filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }],
      });
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
      if (paths.length === 0) return;
      const dir = await join(await appDataDir(), 'music');
      await mkdir(dir, { recursive: true });
      const added: MusicTrack[] = [];
      for (const src of paths) {
        const ext = (src.split('.').pop() ?? 'mp3').toLowerCase();
        const id = crypto.randomUUID();
        const dest = await join(dir, `${id}.${ext}`);
        await copyFile(src, dest);
        added.push({ id, kind: 'file', title: titleFromPath(src), path: dest });
      }
      setTracks((prev) => [...prev, ...added]);
      toast(`Added ${added.length} song${added.length === 1 ? '' : 's'}.`);
    } catch (error) {
      toast(`Could not add files: ${String(error)}`, 'error');
    }
  }, [toast]);

  const remove = useCallback(
    (id: string) => {
      const i = tracksRef.current.findIndex((t) => t.id === id);
      if (i < 0) return;
      if (i === indexRef.current) {
        audioRef.current?.pause();
        ytRef.current?.pauseVideo();
        setIndex(-1);
        setPlaying(false);
      } else if (i < indexRef.current) {
        setIndex((v) => v - 1);
      }
      setTracks((prev) => prev.filter((t) => t.id !== id));
    },
    [],
  );

  // Mirror state to the menu-bar panel and obey its commands.
  const state: MusicState = useMemo(
    () => ({ playing, title, index, count: tracks.length, volume }),
    [playing, title, index, tracks.length, volume],
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    void emit(MUSIC_STATE_EVENT, state).catch(() => undefined);
  }, [state]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<MusicCommand>(MUSIC_CMD_EVENT, (event) => {
      const cmd = event.payload;
      switch (cmd.type) {
        case 'toggle':
          toggle();
          break;
        case 'next':
          next();
          break;
        case 'prev':
          prev();
          break;
        case 'volume':
          setVolume(cmd.value);
          break;
        case 'request-state':
          void emit(MUSIC_STATE_EVENT, stateRef.current).catch(() => undefined);
          break;
      }
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [toggle, next, prev, setVolume]);

  const value: MusicApi = {
    tracks,
    index,
    playing,
    volume,
    title,
    playAt,
    toggle,
    next,
    prev,
    setVolume,
    addYouTube,
    addFiles,
    remove,
  };

  const videoVisible = showVideo && current?.kind === 'youtube';

  return (
    <MusicContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => nextRef.current()}
      />
      <div className={videoVisible ? 'yt-host on' : 'yt-host'}>
        <div ref={mountRef} />
      </div>
    </MusicContext.Provider>
  );
}

/* -------------------------------------------------------------------- view */

export default function MusicView() {
  const music = useMusic();
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!link.trim()) return;
    const problem = music.addYouTube(link);
    setError(problem);
    if (!problem) setLink('');
  };

  return (
    <section aria-label="Music">
      <header className="page-head">
        <div>
          <h1>Music</h1>
          <p className="sub">
            {music.tracks.length} song{music.tracks.length === 1 ? '' : 's'}
            {music.title ? ` · ${music.title}` : ''}
          </p>
        </div>
        <button type="button" className="btn" onClick={() => void music.addFiles()}>
          <FilePlus2 size={16} aria-hidden="true" />
          <span>Add files</span>
        </button>
      </header>

      <form className="row" style={{ gap: 8, marginBottom: 'var(--space-4)' }} onSubmit={submit}>
        <input
          className="setting-input"
          style={{ flex: 1 }}
          type="text"
          value={link}
          placeholder="Paste a YouTube link"
          aria-label="YouTube link"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setLink(e.target.value);
            setError(null);
          }}
        />
        <button type="submit" className="btn primary" disabled={!link.trim()}>
          <Link2 size={15} aria-hidden="true" />
          <span>Add link</span>
        </button>
      </form>
      {error && (
        <p className="small" style={{ color: 'var(--danger, #ff6b6b)', marginTop: 0 }}>
          {error}
        </p>
      )}

      <div className="now-playing" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="stack" style={{ gap: 10, flex: 1 }}>
          <strong>{music.title || 'Nothing playing'}</strong>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn icon" onClick={music.prev} aria-label="Previous">
              <SkipBack size={15} />
            </button>
            <button
              type="button"
              className="btn primary icon"
              onClick={music.toggle}
              aria-label={music.playing ? 'Pause' : 'Play'}
            >
              {music.playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button type="button" className="btn icon" onClick={music.next} aria-label="Next">
              <SkipForward size={15} />
            </button>
            <Volume2 size={15} aria-hidden="true" className="muted" />
            <input
              type="range"
              min={0}
              max={100}
              value={music.volume}
              onChange={(e) => music.setVolume(Number(e.target.value))}
              aria-label="Volume"
            />
          </div>
        </div>
      </div>

      {music.tracks.length === 0 ? (
        <div className="empty">
          <MusicIcon size={22} aria-hidden="true" />
          <p className="muted">
            Paste a YouTube link or add audio files. YouTube songs play through YouTube’s
            embedded player (keep Driftwall running); files are copied into your library.
          </p>
        </div>
      ) : (
        <ul className="track-list">
          {music.tracks.map((track, i) => (
            <li key={track.id} className={i === music.index ? 'track-row active' : 'track-row'}>
              <button type="button" className="track-main" onClick={() => music.playAt(i)}>
                {i === music.index && music.playing ? (
                  <Pause size={14} aria-hidden="true" />
                ) : (
                  <Play size={14} aria-hidden="true" />
                )}
                <span className="track-title">{track.title}</span>
                <span className="muted small">{track.kind === 'youtube' ? 'YouTube' : 'File'}</span>
              </button>
              <button
                type="button"
                className="btn icon ghost"
                onClick={() => music.remove(track.id)}
                aria-label={`Remove ${track.title}`}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
