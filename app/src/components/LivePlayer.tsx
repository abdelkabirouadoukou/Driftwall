import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import * as api from '../lib/api.ts';
import { assetUrl } from '../lib/paths.ts';
import SceneCanvas from './SceneCanvas.tsx';

/** How often the watchdog checks that the video is really moving. */
const WATCHDOG_MS = 3000;
/** Reload attempts after a decode/network error before giving up. */
const MAX_RETRIES = 3;

/**
 * Renders inside the click-through `wallpaper-*` windows the Rust engine
 * creates (one per display, see `engine::ensure_live_windows`). This is
 * intentionally tiny: no sidebar, no router, no library state — just a
 * looping, muted `<video>` — so each display window stays cheap on memory
 * and battery while it sits behind the desktop icons.
 *
 * Rust is the single source of truth for *what* plays and *whether* it's
 * paused (see `power.rs`); this component only reflects that state.
 *
 * Because the window sits at desktop level, WebKit regards it as occluded
 * and happily pauses or freezes the video. Rust says it should be playing, so
 * this component keeps it moving: it resumes on `pause`, on visibility
 * changes and from a small watchdog, and reloads the clip if it stalls.
 */
export default function LivePlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  // Still picture (the clip's thumbnail) painted under the video, so there is
  // never a blank or black frame while a new wallpaper loads.
  const [poster, setPoster] = useState<string | null>(null);
  // Built-in animated scene (instead of a video file), see lib/scenes.ts.
  const [scene, setScene] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [ready, setReady] = useState(false);
  // Bumped to force a fresh <video> element after an error or a freeze.
  const [attempt, setAttempt] = useState(0);

  const playingRef = useRef(playing);
  playingRef.current = playing;
  const retriesRef = useRef(0);

  useEffect(() => {
    let disposed = false;

    const show = (path: string | undefined, sceneId: string | undefined, art?: string | null) => {
      setScene(sceneId ?? null);
      setSrc(!sceneId && path ? assetUrl(path) : null);
      setPoster(!sceneId && art ? assetUrl(art) : null);
      retriesRef.current = 0;
    };

    const unlistenLoad = listen<{ path?: string; scene?: string; poster?: string | null }>(
      'live-load',
      (event) => {
        if (disposed) return;
        const { path, scene: sceneId, poster: art } = event.payload;
        show(path, sceneId, art);
        setPlaying(true);
      },
    );
    const unlistenState = listen<{ playing: boolean; reason: string | null }>(
      'live-state',
      (event) => {
        if (!disposed) setPlaying(event.payload.playing);
      },
    );

    // The window may be created (or reloaded) after `live-load` already
    // fired once, so ask Rust what should be showing right now.
    void api
      .liveCurrent()
      .then((current) => {
        if (disposed || !current) return;
        show(current.path, current.scene, current.poster);
        setPlaying(current.playing);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      void unlistenLoad.then((fn) => fn());
      void unlistenState.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    setReady(false);
  }, [src, attempt]);

  // Follow Rust's play/pause decision.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      // Autoplay can be blocked until the element has a source; ignore the
      // rejection, the watchdog and `canplay` retry.
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [playing, src, attempt]);

  // Keep it moving while it should be playing.
  useEffect(() => {
    if (!src) return;
    const resume = () => {
      const video = videoRef.current;
      if (video && playingRef.current && video.paused && !video.ended) {
        void video.play().catch(() => undefined);
      }
    };

    let lastTime = -1;
    let frozen = 0;
    const watchdog = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || !playingRef.current || document.hidden) {
        frozen = 0;
        return;
      }
      if (video.paused) {
        resume();
        return;
      }
      // "Playing" but the clock is not advancing: the decoder stalled.
      if (Math.abs(video.currentTime - lastTime) < 0.01) frozen += 1;
      else frozen = 0;
      lastTime = video.currentTime;
      if (frozen >= 2) {
        frozen = 0;
        if (retriesRef.current < MAX_RETRIES) {
          retriesRef.current += 1;
          setAttempt((n) => n + 1);
        }
      }
    }, WATCHDOG_MS);

    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    return () => {
      window.clearInterval(watchdog);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
    };
  }, [src]);

  if (scene) {
    return (
      <div className="live-root">
        <SceneCanvas sceneId={scene} fps={30} playing={playing} className="live-canvas" />
      </div>
    );
  }

  if (!src) return <div className="live-root" />;

  return (
    <div
      className="live-root"
      style={poster ? { backgroundImage: `url("${poster}")` } : undefined}
    >
      <video
        key={`${src}#${attempt}`}
        ref={videoRef}
        className={ready ? 'ready' : undefined}
        src={src}
        preload="auto"
        onLoadedData={() => {
          setReady(true);
          retriesRef.current = 0;
        }}
        onCanPlay={() => {
          if (playingRef.current) void videoRef.current?.play().catch(() => undefined);
        }}
        // WebKit pauses occluded media on its own; Rust decides, not WebKit.
        onPause={() => {
          const video = videoRef.current;
          if (video && playingRef.current && !video.ended) {
            window.setTimeout(() => {
              if (playingRef.current && video.paused) void video.play().catch(() => undefined);
            }, 250);
          }
        }}
        // Backstop if `loop` ever fails to wrap around.
        onEnded={() => {
          const video = videoRef.current;
          if (!video) return;
          video.currentTime = 0;
          if (playingRef.current) void video.play().catch(() => undefined);
        }}
        onError={() => {
          if (retriesRef.current < MAX_RETRIES) {
            retriesRef.current += 1;
            window.setTimeout(() => setAttempt((n) => n + 1), 1500);
          }
        }}
        autoPlay
        loop
        muted
        playsInline
        disablePictureInPicture
        disableRemotePlayback
        aria-hidden="true"
      />
    </div>
  );
}
