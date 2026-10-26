import { useEffect, useRef, useState } from 'react';

/**
 * Still-first video: the poster image is painted immediately and given the
 * bandwidth first; the clip only starts loading once the poster is on screen,
 * and it fades in on top of it when the first frame is really playing.
 * Unmounting cancels the download, so closing a drawer never keeps fetching.
 */
export default function ProgressiveVideo({
  src,
  poster,
  alt = '',
  fit = 'contain',
}: {
  src: string;
  poster: string;
  alt?: string;
  fit?: 'contain' | 'cover';
}) {
  const [posterDone, setPosterDone] = useState(false);
  const [ready, setReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setPosterDone(false);
    setReady(false);
  }, [src, poster]);

  useEffect(() => {
    const video = videoRef.current;
    return () => {
      if (!video) return;
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [src, posterDone]);

  return (
    <div className="pv" data-fit={fit} aria-busy={!ready}>
      <img
        src={poster}
        alt={alt}
        decoding="async"
        fetchPriority="high"
        onLoad={() => setPosterDone(true)}
        onError={() => setPosterDone(true)}
      />
      {posterDone && (
        <video
          ref={videoRef}
          className={ready ? 'pv-video ready' : 'pv-video'}
          src={src}
          preload="auto"
          muted
          loop
          autoPlay
          playsInline
          aria-hidden="true"
          onPlaying={() => setReady(true)}
        />
      )}
      {!ready && (
        <span className="pv-status" role="status">
          <span className="pv-dot" aria-hidden="true" />
          Loading animation…
        </span>
      )}
    </div>
  );
}
