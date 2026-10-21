import { useState } from 'react';

/**
 * Hover-preview clip drawn on top of a tile's still thumbnail. It stays
 * invisible until the first frame is decodable, then fades in, so the tile
 * never goes blank while the video loads. Unmounting it (hover ends) resets it.
 */
export default function PreviewVideo({ src }: { src: string }) {
  const [ready, setReady] = useState(false);
  return (
    <video
      className={ready ? 'tile-preview ready' : 'tile-preview'}
      src={src}
      muted
      loop
      autoPlay
      playsInline
      onLoadedData={() => setReady(true)}
      onPlaying={() => setReady(true)}
    />
  );
}
