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
import {
  FilePlus2,
  Link2,
  ListMusic,
  Music as MusicIcon,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useToast } from './Toast.tsx';
import * as api from '../lib/api.ts';
import { assetUrl } from '../lib/paths.ts';
import { createYouTubePlayer, type YTPlayer } from '../lib/ytBridge.ts';
import { loadThumbnailColor, tintFromRgb, type VideoTint } from '../lib/tint.ts';
import {
  formatTime,
  MUSIC_CMD_EVENT,
  MUSIC_SETTING_KEY,
  MUSIC_STATE_EVENT,
  nextRepeatMode,
  parseYouTubeUrl,
  placeholderTitle,
  stepIndex,
  titleFromPath,
  youtubeErrorMessage,
  type MusicCommand,
  type MusicState,
  type MusicTrack,
  type RepeatMode,
} from '../lib/music.ts';

/** Small square artwork for a track: YouTube's own thumbnail, or a blank for files. */
export function trackArt(track: MusicTrack | undefined): string | null {
  return track?.kind === 'youtube' && track.video_id
    ? `https://i.ytimg.com/vi/${encodeURIComponent(track.video_id)}/mqdefault.jpg`
    : null;
}

/* ----------------------------------------------------------------- context */

interface MusicApi {
  tracks: MusicTrack[];
  index: number;
  playing: boolean;
  volume: number;
  title: string;
  progress: number;
  duration: number;
  shuffle: boolean;
  repeat: RepeatMode;
  tint: VideoTint | null;
  playAt: (i: number) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;
  setVolume: (v: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
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
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('off');
  // Colour of the playing video, so the video card and the now-playing bar match it.
  const [tint, setTint] = useState<VideoTint | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const ytRef = useRef<YTPlayer | null>(null);
  const tintRef = useRef<VideoTint | null>(null);
  const ytPromiseRef = useRef<Promise<YTPlayer> | null>(null);
  const tracksRef = useRef(tracks);
  const indexRef = useRef(index);
  const volumeRef = useRef(volume);
  const playingRef = useRef(playing);
  const shuffleRef = useRef(shuffle);
  const repeatRef = useRef(repeat);
  tracksRef.current = tracks;
  indexRef.current = index;
  volumeRef.current = volume;
  playingRef.current = playing;
  shuffleRef.current = shuffle;
  repeatRef.current = repeat;

  const current = index >= 0 ? tracks[index] : undefined;
  const title = current?.title ?? '';
  const videoId = current?.kind === 'youtube' ? current.video_id : undefined;

  // A new track starts from zero; the real duration/progress arrive once it loads.
  useEffect(() => {
    setProgress(0);
    setDuration(0);
  }, [index]);

  useEffect(() => {
    if (!videoId) {
      setTint(null);
      return;
    }
    let stale = false;
    void loadThumbnailColor(videoId).then((rgb) => {
      if (!stale) setTint(tintFromRgb(rgb));
    });
    return () => {
      stale = true;
    };
  }, [videoId]);

  // Publish the colour as CSS variables (the stylesheet falls back to the
  // normal surfaces when they are absent) and to the player page itself.
  useEffect(() => {
    tintRef.current = tint;
    const root = document.documentElement.style;
    if (tint) {
      root.setProperty('--video-tint', tint.bg);
      root.setProperty('--video-tint-bar', tint.bar);
      root.setProperty('--video-tint-glow', tint.glow);
      ytRef.current?.setTint(tint.hex);
    } else {
      root.removeProperty('--video-tint');
      root.removeProperty('--video-tint-bar');
      root.removeProperty('--video-tint-glow');
    }
  }, [tint]);

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
  // Natural end-of-track (as opposed to the user pressing "next"): respects repeat/shuffle.
  const advanceRef = useRef<() => void>(() => undefined);
  // Consecutive YouTube failures, so a playlist of blocked videos doesn't skip forever.
  const failStreakRef = useRef(0);

  const ensureYouTube = useCallback((): Promise<YTPlayer> => {
    if (ytPromiseRef.current) return ytPromiseRef.current;
    // The player page is served by the app's local HTTP server: YouTube
    // refuses to play inside tauri://localhost (error 153).
    const promise = api
      .playerUrl()
      .then((url) => {
        const mount = mountRef.current;
        if (!mount) throw new Error('Player container missing.');
        return createYouTubePlayer(mount, url, {
          onState: ({ state, title: videoTitle }) => {
            // The iframe reports asynchronously: ignore events that arrive
            // after the user already moved on to a local file, otherwise a
            // late "paused" flips the UI while the file is playing.
            const cur = tracksRef.current[indexRef.current];
            if (cur?.kind !== 'youtube') return;
            // 0 ended, 1 playing, 2 paused
            if (state === 0) advanceRef.current();
            if (state === 1) {
              failStreakRef.current = 0;
              setPlaying(true);
              // YouTube can start muted (autoplay policy) or reset the
              // volume when a new video loads: that was the "no audio" bug.
              const yt = ytRef.current;
              if (yt?.isMuted()) yt.unMute();
              yt?.setVolume(volumeRef.current);
              if (videoTitle && cur.title === placeholderTitle(cur.video_id ?? '')) {
                setTrackTitle(cur.id, videoTitle);
              }
            }
            if (state === 2) setPlaying(false);
          },
          onProgress: ({ currentTime, duration: total }) => {
            if (tracksRef.current[indexRef.current]?.kind !== 'youtube') return;
            setProgress(currentTime);
            setDuration(total);
          },
          onError: (code) => {
            setPlaying(false);
            const count = tracksRef.current.length;
            failStreakRef.current += 1;
            const willSkip = count > 1 && failStreakRef.current < count;
            toast(
              `${youtubeErrorMessage(code)}${willSkip ? ' Skipping to the next song.' : ''}`,
              'error',
            );
            if (willSkip) window.setTimeout(() => nextRef.current(), 1500);
          },
        });
      })
      .then((player) => {
        ytRef.current = player;
        player.unMute();
        player.setVolume(volumeRef.current);
        if (tintRef.current) player.setTint(tintRef.current.hex);
        return player;
      });
    ytPromiseRef.current = promise;
    promise.catch(() => {
      ytPromiseRef.current = null;
    });
    return promise;
  }, [setTrackTitle, toast]);

  // Warm the YouTube player up as soon as the playlist has a YouTube song.
  // Otherwise the first click waits for the API script to download, the browser
  // no longer sees a user gesture and starts the video muted or blocked.
  const hasYouTube = tracks.some((t) => t.kind === 'youtube');
  useEffect(() => {
    if (loaded && hasYouTube) void ensureYouTube().catch(() => undefined);
  }, [loaded, hasYouTube, ensureYouTube]);

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
            player.unMute();
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

  // A random track other than the current one (falls back to sequential
  // order for a 1-2 song playlist, where "random" has nowhere else to go).
  const randomIndex = useCallback((): number => {
    const count = tracksRef.current.length;
    if (count <= 1) return stepIndex(indexRef.current, count, 1);
    let i = indexRef.current;
    for (let tries = 0; tries < 8 && i === indexRef.current; tries++) {
      i = Math.floor(Math.random() * count);
    }
    return i;
  }, []);

  const next = useCallback(() => {
    const i = shuffleRef.current ? randomIndex() : stepIndex(indexRef.current, tracksRef.current.length, 1);
    if (i >= 0) playAt(i);
  }, [playAt, randomIndex]);
  nextRef.current = next;

  const prev = useCallback(() => {
    const i = shuffleRef.current ? randomIndex() : stepIndex(indexRef.current, tracksRef.current.length, -1);
    if (i >= 0) playAt(i);
  }, [playAt, randomIndex]);

  // Called when a track ends on its own: honours repeat-one (replay) and
  // repeat-off (stop at the end of a non-shuffled queue) before falling back
  // to the same "go to the next track" behaviour as the Next button.
  const advance = useCallback(() => {
    if (repeatRef.current === 'one') {
      playAt(indexRef.current);
      return;
    }
    const list = tracksRef.current;
    const atEnd = !shuffleRef.current && indexRef.current === list.length - 1;
    if (atEnd && repeatRef.current === 'off') {
      setPlaying(false);
      return;
    }
    next();
  }, [next, playAt]);
  advanceRef.current = advance;

  const seek = useCallback((seconds: number) => {
    const track = tracksRef.current[indexRef.current];
    if (!track) return;
    const clamped = Math.max(0, seconds);
    if (track.kind === 'file') {
      if (audioRef.current) audioRef.current.currentTime = clamped;
    } else {
      ytRef.current?.seekTo(clamped);
    }
    setProgress(clamped);
  }, []);

  const toggleShuffle = useCallback(() => setShuffle((v) => !v), []);
  const cycleRepeat = useCallback(() => setRepeat((v) => nextRepeatMode(v)), []);

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
    () => ({
      playing,
      title,
      index,
      count: tracks.length,
      volume,
      progress,
      duration,
      shuffle,
      repeat,
    }),
    [playing, title, index, tracks.length, volume, progress, duration, shuffle, repeat],
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  // Progress ticks (every ~250-500ms while playing) would otherwise fire an
  // IPC emit at the same rate just to move a seek bar. Play/pause, track,
  // volume, shuffle and repeat changes still go out immediately; a bare
  // progress tick is coalesced into one emit per second.
  const lastSentRef = useRef<Omit<MusicState, 'progress' | 'duration'> | null>(null);
  useEffect(() => {
    const { progress: _progress, duration: _duration, ...important } = state;
    const changed =
      !lastSentRef.current || Object.keys(important).some((k) => {
        const key = k as keyof typeof important;
        return lastSentRef.current![key] !== important[key];
      });
    lastSentRef.current = important;
    if (changed) void emit(MUSIC_STATE_EVENT, state).catch(() => undefined);
  }, [state]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      void emit(MUSIC_STATE_EVENT, stateRef.current).catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(id);
  }, [playing]);

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
        case 'seek':
          seek(cmd.value);
          break;
        case 'shuffle':
          setShuffle(cmd.value);
          break;
        case 'repeat':
          setRepeat(cmd.value);
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
  }, [toggle, next, prev, setVolume, seek]);

  const value: MusicApi = {
    tracks,
    index,
    playing,
    volume,
    title,
    progress,
    duration,
    shuffle,
    repeat,
    tint,
    playAt,
    toggle,
    next,
    prev,
    seek,
    setVolume,
    toggleShuffle,
    cycleRepeat,
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
        onPlay={() => {
          if (tracksRef.current[indexRef.current]?.kind === 'file') setPlaying(true);
        }}
        onPause={() => {
          if (tracksRef.current[indexRef.current]?.kind === 'file') setPlaying(false);
        }}
        onEnded={() => {
          if (tracksRef.current[indexRef.current]?.kind === 'file') advanceRef.current();
        }}
        onTimeUpdate={(e) => {
          if (tracksRef.current[indexRef.current]?.kind === 'file') {
            setProgress(e.currentTarget.currentTime);
          }
        }}
        onLoadedMetadata={(e) => {
          if (tracksRef.current[indexRef.current]?.kind === 'file') {
            setDuration(e.currentTarget.duration || 0);
          }
        }}
        onError={() => {
          if (tracksRef.current[indexRef.current]?.kind === 'file') {
            setPlaying(false);
            toast('That audio file could not be played.', 'error');
          }
        }}
      />
      <div className={videoVisible ? 'yt-host on' : 'yt-host'} inert={!videoVisible}>
        <div className="yt-frame">
          <div ref={mountRef} />
        </div>
        <div
          className="yt-seek"
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={duration || 0}
          aria-valuenow={progress}
          onClick={(e) => {
            if (!duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            seek(((e.clientX - rect.left) / rect.width) * duration);
          }}
        >
          <div className="yt-seek-fill" style={{ width: duration ? `${(progress / duration) * 100}%` : '0%' }} />
        </div>
        <div className="yt-bar">
          <span className="yt-title">{title || 'YouTube'}</span>
          <button
            type="button"
            className={shuffle ? 'yt-btn active' : 'yt-btn'}
            onClick={toggleShuffle}
            aria-label="Shuffle"
            aria-pressed={shuffle}
          >
            <Shuffle size={13} />
          </button>
          <button type="button" className="yt-btn" onClick={prev} aria-label="Previous">
            <SkipBack size={14} />
          </button>
          <button
            type="button"
            className="yt-btn"
            onClick={toggle}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button type="button" className="yt-btn" onClick={next} aria-label="Next">
            <SkipForward size={14} />
          </button>
          <button
            type="button"
            className={repeat !== 'off' ? 'yt-btn active' : 'yt-btn'}
            onClick={cycleRepeat}
            aria-label={`Repeat: ${repeat}`}
            aria-pressed={repeat !== 'off'}
          >
            {repeat === 'one' ? <Repeat1 size={13} /> : <Repeat size={13} />}
          </button>
        </div>
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
        <div className="now-playing-thumb" aria-hidden="true">
          {trackArt(music.tracks[music.index]) ? (
            <img src={trackArt(music.tracks[music.index])!} alt="" />
          ) : (
            <MusicIcon size={22} />
          )}
        </div>
        <div className="stack" style={{ gap: 10, flex: 1, minWidth: 0 }}>
          <strong className="track-title">{music.title || 'Nothing playing'}</strong>

          <div
            className="seek-bar"
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={music.duration || 0}
            aria-valuenow={music.progress}
            onClick={(e) => {
              if (!music.duration) return;
              const rect = e.currentTarget.getBoundingClientRect();
              music.seek(((e.clientX - rect.left) / rect.width) * music.duration);
            }}
          >
            <div
              className="seek-bar-fill"
              style={{ width: music.duration ? `${(music.progress / music.duration) * 100}%` : '0%' }}
            />
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted small">{formatTime(music.progress)}</span>
            <span className="muted small">{formatTime(music.duration)}</span>
          </div>

          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className={music.shuffle ? 'btn icon ghost active' : 'btn icon ghost'}
              onClick={music.toggleShuffle}
              aria-label="Shuffle"
              aria-pressed={music.shuffle}
              title="Shuffle"
            >
              <Shuffle size={15} />
            </button>
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
            <button
              type="button"
              className={music.repeat !== 'off' ? 'btn icon ghost active' : 'btn icon ghost'}
              onClick={music.cycleRepeat}
              aria-label={`Repeat: ${music.repeat}`}
              aria-pressed={music.repeat !== 'off'}
              title={`Repeat: ${music.repeat}`}
            >
              {music.repeat === 'one' ? <Repeat1 size={15} /> : <Repeat size={15} />}
            </button>
            <div className="spacer" />
            <VolumeIcon value={music.volume} />
            <input
              type="range"
              min={0}
              max={100}
              value={music.volume}
              onChange={(e) => music.setVolume(Number(e.target.value))}
              aria-label="Volume"
              style={{ width: 90 }}
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
        <>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
            <span className="panel-section" style={{ margin: 0 }}>
              <ListMusic size={13} aria-hidden="true" style={{ verticalAlign: -2, marginRight: 6 }} />
              Queue
            </span>
          </div>
          <ul className="track-list">
            {music.tracks.map((track, i) => {
              const art = trackArt(track);
              return (
                <li key={track.id} className={i === music.index ? 'track-row active' : 'track-row'}>
                  <button type="button" className="track-main" onClick={() => music.playAt(i)}>
                    <span className="track-art" aria-hidden="true">
                      {art ? <img src={art} alt="" /> : <MusicIcon size={14} />}
                      <span className="track-art-overlay">
                        {i === music.index && music.playing ? (
                          <Pause size={14} aria-hidden="true" />
                        ) : (
                          <Play size={14} aria-hidden="true" />
                        )}
                      </span>
                    </span>
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
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

/** Mutes / low / full volume glyph, like Spotify's volume control. */
function VolumeIcon({ value }: { value: number }) {
  if (value <= 0) return <VolumeX size={15} aria-hidden="true" className="muted" />;
  if (value < 50) return <Volume1 size={15} aria-hidden="true" className="muted" />;
  return <Volume2 size={15} aria-hidden="true" className="muted" />;
}
