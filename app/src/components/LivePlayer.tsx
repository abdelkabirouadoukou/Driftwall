import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import * as api from '../lib/api.ts';
import { assetUrl } from '../lib/paths.ts';
import SceneCanvas from './SceneCanvas.tsx';

/**
 * Renders inside the click-through `wallpaper-*` windows the Rust engine
 * creates (one per display, see `engine::ensure_live_windows`). This is
 * intentionally tiny: no sidebar, no router, no library state — just a
 * looping, muted `<video>` — so each display window stays cheap on memory
 * and battery while it sits behind the desktop icons.
 *
 * Rust is the single source of truth for *what* plays and *whether* it's
 * paused (see `power.rs`); this component only reflects that state.
 */
export default function LivePlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  // Built-in animated scene (instead of a video file), see lib/scenes.ts.
  const [scene, setScene] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  // Fade the video in once it can show a frame, so there's never a black flash
  // over the still picture set behind it.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;

    const unlistenLoad = listen<{ path?: string; scene?: string }>('live-load', (event) => {
      if (disposed) return;
      const { path, scene: sceneId } = event.payload;
      setScene(sceneId ?? null);
      setSrc(!sceneId && path ? assetUrl(path) : null);
      setPlaying(true);
    });
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
        setScene(current.scene ?? null);
        setSrc(!current.scene && current.path ? assetUrl(current.path) : null);
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
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      // Autoplay can be blocked until the element has a source; ignore the
      // rejection, playback resumes on the next `live-state`/load.
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [playing, src]);

  if (scene) {
    return (
      <div className="live-root">
        <SceneCanvas sceneId={scene} fps={30} playing={playing} className="live-canvas" />
      </div>
    );
  }

  if (!src) return <div className="live-root" />;

  return (
    <div className="live-root">
      <video
        ref={videoRef}
        className={ready ? 'ready' : undefined}
        src={src}
        preload="auto"
        onLoadedData={() => setReady(true)}
        autoPlay
        loop
        muted
        playsInline
        disablePictureInPicture
        aria-hidden="true"
      />
    </div>
  );
}
