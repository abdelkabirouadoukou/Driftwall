/**
 * Pure helpers for detecting near-black video frames and choosing which
 * timestamps to sample. Kept free of DOM APIs so they can be unit-tested in
 * Node (the canvas plumbing lives in probe.ts).
 */

/** Mean luminance (0-255) below which a frame is considered "nearly black". */
export const BLACK_LUMINANCE_THRESHOLD = 16;

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/**
 * Mean perceptual luminance of RGBA pixel data (0-255). Fully transparent
 * pixels contribute black so an empty canvas is not mistaken for a bright frame.
 */
export function meanLuminance(data: ArrayLike<number>): number {
  let total = 0;
  let count = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    total += (LUMA_R * data[i] + LUMA_G * data[i + 1] + LUMA_B * data[i + 2]) * alpha;
    count += 1;
  }
  return count === 0 ? 0 : total / count;
}

/** True when RGBA pixel data is (near) black on average. */
export function isNearlyBlack(
  data: ArrayLike<number>,
  threshold: number = BLACK_LUMINANCE_THRESHOLD,
): boolean {
  return meanLuminance(data) < threshold;
}

/** True when a precomputed luminance is (near) black; unknown counts as black. */
export function isBlackLuminance(
  luminance: number,
  threshold: number = BLACK_LUMINANCE_THRESHOLD,
): boolean {
  return !Number.isFinite(luminance) || luminance < threshold;
}

/**
 * Ordered timestamps (seconds) to try for a video thumbnail: ~10% of the
 * duration (clamped to 0.5-3s) first, then 25%, 50% and 75% as fallbacks for
 * clips whose opening frames are black. All values stay strictly inside the
 * clip and duplicates (e.g. on very short clips) are removed.
 */
export function candidateTimestamps(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [0];
  const end = Math.max(0, duration - 0.05);
  const primary = Math.min(3, Math.max(0.5, duration * 0.1));
  const raw = [primary, duration * 0.25, duration * 0.5, duration * 0.75];

  const out: number[] = [];
  const seen = new Set<number>();
  for (const time of raw) {
    const clamped = Math.min(Math.max(time, 0), end);
    const key = Math.round(clamped * 1000);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clamped);
  }
  return out;
}
