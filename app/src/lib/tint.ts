/**
 * Colour helpers that make the video card and the "now playing" bar follow the
 * colour of the video that is playing. The colour comes from the video's
 * thumbnail (the YouTube iframe itself is cross-origin, so its pixels cannot
 * be read), and is always rendered dark so text stays readable.
 */

export type RGB = [number, number, number];

export interface VideoTint {
  /** Main surface behind the video and the now-playing bar. */
  bg: string;
  /** Slightly darker strip used for toolbars. */
  bar: string;
  /** Soft glow used for the card's shadow. */
  glow: string;
  /** `bg` as #rrggbb, for places that cannot take hsl(). */
  hex: string;
}

/** Used when no colour could be read; matches the app's own dark surfaces. */
export const NEUTRAL_TINT: VideoTint = {
  bg: '#151520',
  bar: '#0f0f16',
  glow: 'rgba(0, 0, 0, 0.5)',
  hex: '#151520',
};

/**
 * Average colour of an RGBA pixel buffer, favouring saturated pixels and
 * ignoring near-black and near-white ones (letterbox bars, burnt highlights).
 * Returns null when nothing colourful is left.
 */
export function dominantColor(data: ArrayLike<number>): RGB | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let total = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3]! < 128) continue;
    const pr = data[i]!;
    const pg = data[i + 1]!;
    const pb = data[i + 2]!;
    const max = Math.max(pr, pg, pb);
    const min = Math.min(pr, pg, pb);
    if (max < 28 || min > 235) continue;
    const saturation = max === 0 ? 0 : (max - min) / max;
    const weight = 0.1 + saturation * saturation;
    r += pr * weight;
    g += pg * weight;
    b += pb * weight;
    total += weight;
  }
  if (total === 0) return null;
  return [Math.round(r / total), Math.round(g / total), Math.round(b / total)];
}

export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [Math.round((h * 60 + 360) % 360), s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** Turns a video colour into the dark surface colours the UI uses. */
export function tintFromRgb(rgb: RGB | null): VideoTint {
  if (!rgb) return NEUTRAL_TINT;
  const [h, s] = rgbToHsl(rgb);
  const sat = Math.min(s, 0.6);
  const pct = (n: number) => Math.round(n * 100);
  return {
    bg: `hsl(${h} ${pct(sat)}% 16%)`,
    bar: `hsl(${h} ${pct(sat)}% 11%)`,
    glow: `hsl(${h} ${pct(Math.max(sat, 0.4))}% 45% / 0.35)`,
    hex: hslToHex(h, sat, 0.16),
  };
}

/** Reads the video's thumbnail and returns its dominant colour, or null. */
export function loadThumbnailColor(videoId: string): Promise<RGB | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 18;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(dominantColor(ctx.getImageData(0, 0, canvas.width, canvas.height).data));
      } catch {
        // A tainted canvas (no CORS headers) just means "no tint".
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;
  });
}
