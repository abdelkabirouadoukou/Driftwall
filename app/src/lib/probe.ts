/**
 * Media probing in the WebView: measures dimensions/duration and renders a
 * thumbnail using `<img>`/`<video>` + `<canvas>`. No external tooling (ffmpeg)
 * is required. Returns `null` when the browser cannot decode the media, which
 * the importer treats as a rejection (covers non-H.264/HEVC videos).
 *
 * Video frames are captured *after* the decoder has produced one (loadeddata ->
 * seeked -> requestVideoFrameCallback) and never at t=0, whose frame is often
 * black. If the first candidate is black we try later timestamps and keep the
 * brightest frame (see frames.ts).
 */

import type { MediaKind } from './media.ts';
import {
  candidateTimestamps,
  isBlackLuminance,
  meanLuminance,
} from './frames.ts';

export interface ProbeResult {
  width: number | null;
  height: number | null;
  duration: number | null;
  thumbnail: Uint8Array | null;
}

const THUMB_MAX = 480;
const LUMA_SAMPLE = 32;

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

/**
 * Mean luminance (0-255) of any drawable source, sampled from a small
 * downscaled copy so it stays cheap. Used to reject near-black video frames and
 * to check stored thumbnails. Returns 255 ("not black") if sampling fails.
 */
export function luminanceOf(
  source: CanvasImageSource,
  width: number,
  height: number,
): number {
  if (!width || !height) return 255;
  const canvas = document.createElement('canvas');
  canvas.width = LUMA_SAMPLE;
  canvas.height = LUMA_SAMPLE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 255;
  ctx.drawImage(source, 0, 0, LUMA_SAMPLE, LUMA_SAMPLE);
  return meanLuminance(ctx.getImageData(0, 0, LUMA_SAMPLE, LUMA_SAMPLE).data);
}

function probeImage(url: string): Promise<ProbeResult | null> {
  return new Promise((resolve) => {
    const img = new Image();
    // The asset protocol is cross-origin; without this the canvas is tainted and
    // toDataURL() throws inside onload, which used to leave this promise
    // pending forever ("Adding to library" never finished).
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let thumbnail: Uint8Array | null = null;
      try {
        thumbnail = drawThumbnail(img, img.naturalWidth, img.naturalHeight);
      } catch {
        thumbnail = null;
      }
      resolve({
        width: img.naturalWidth || null,
        height: img.naturalHeight || null,
        duration: null,
        thumbnail,
      });
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Resolves on the next `type` event, or after `timeoutMs` (never rejects). */
function waitForEvent(target: EventTarget, type: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      target.removeEventListener(type, finish);
      resolve();
    };
    target.addEventListener(type, finish);
    setTimeout(finish, timeoutMs);
  });
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = time;
    // Safety net for clips that cannot seek (e.g. zero-length).
    setTimeout(onSeeked, 1500);
  });
}

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
};

/** Waits until the just-seeked frame has actually been composed. */
function waitForFrame(video: VideoWithFrameCallback): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(finish);
      setTimeout(finish, 500);
    } else {
      requestAnimationFrame(() => requestAnimationFrame(finish));
    }
  });
}

async function captureBestFrame(video: HTMLVideoElement): Promise<Uint8Array | null> {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await waitForEvent(video, 'loadeddata', 2000);
  }

  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  let best: { bytes: Uint8Array; luminance: number } | null = null;

  for (const time of candidateTimestamps(duration)) {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) break;

    await seekTo(video, time);
    await waitForFrame(video as VideoWithFrameCallback);

    const bytes = drawThumbnail(video, width, height);
    if (!bytes) continue;
    const luminance = luminanceOf(video, width, height);
    if (!best || luminance > best.luminance) best = { bytes, luminance };
    // Bright enough: stop hunting further timestamps.
    if (!isBlackLuminance(luminance)) break;
  }

  return best?.bytes ?? null;
}

function probeVideo(url: string): Promise<ProbeResult | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;

    let settled = false;
    const finish = (result: ProbeResult | null) => {
      if (settled) return;
      settled = true;
      video.removeAttribute('src');
      video.load();
      resolve(result);
    };

    video.onloadedmetadata = () => {
      void captureBestFrame(video)
        .catch(() => null)
        .then((thumbnail) =>
          finish({
            width: video.videoWidth || null,
            height: video.videoHeight || null,
            duration: Number.isFinite(video.duration) ? video.duration : null,
            thumbnail,
          }),
        )
        .catch(() => finish(null));
    };
    video.onerror = () => finish(null);
    video.src = url;
  });
}

const PROBE_TIMEOUT_MS = 20000;

/**
 * Probes a media file at an asset-protocol URL. Never hangs: if the WebView
 * fires neither a load nor an error event within {@link PROBE_TIMEOUT_MS}, the
 * media is treated as undecodable (resolves `null`).
 */
export function probeMedia(
  url: string,
  kind: MediaKind,
): Promise<ProbeResult | null> {
  const work = kind === 'video' ? probeVideo(url) : probeImage(url);
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), PROBE_TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
