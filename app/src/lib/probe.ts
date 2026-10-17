/**
 * Media probing in the WebView: measures dimensions/duration and renders a
 * thumbnail using `<img>`/`<video>` + `<canvas>`. No external tooling (ffmpeg)
 * is required. Returns `null` when the browser cannot decode the media, which
 * the importer treats as a rejection (covers non-H.264/HEVC videos).
 */

import type { MediaKind } from './media.ts';

export interface ProbeResult {
  width: number | null;
  height: number | null;
  duration: number | null;
  thumbnail: Uint8Array | null;
}

const THUMB_MAX = 480;

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function drawThumbnail(
  source: CanvasImageSource,
  width: number,
  height: number,
): Uint8Array | null {
  if (!width || !height) return null;
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, THUMB_MAX / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return dataUrlToBytes(canvas.toDataURL('image/png'));
}

function probeImage(url: string): Promise<ProbeResult | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
        duration: null,
        thumbnail: drawThumbnail(img, img.naturalWidth, img.naturalHeight),
      });
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function probeVideo(url: string): Promise<ProbeResult | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;

    const finish = (result: ProbeResult | null) => {
      video.removeAttribute('src');
      video.load();
      resolve(result);
    };

    const capture = () =>
      finish({
        width: video.videoWidth || null,
        height: video.videoHeight || null,
        duration: Number.isFinite(video.duration) ? video.duration : null,
        thumbnail: drawThumbnail(video, video.videoWidth, video.videoHeight),
      });

    video.onloadedmetadata = () => {
      if (Number.isFinite(video.duration) && video.duration > 1) {
        video.currentTime = 1;
      } else {
        capture();
      }
    };
    video.onseeked = capture;
    video.onerror = () => finish(null);
    video.src = url;
  });
}

/** Probes a media file at an asset-protocol URL. */
export function probeMedia(
  url: string,
  kind: MediaKind,
): Promise<ProbeResult | null> {
  return kind === 'video' ? probeVideo(url) : probeImage(url);
}
