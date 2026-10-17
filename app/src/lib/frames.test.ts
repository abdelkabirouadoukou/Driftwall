import { describe, expect, it } from 'vitest';
import {
  BLACK_LUMINANCE_THRESHOLD,
  candidateTimestamps,
  isBlackLuminance,
  isNearlyBlack,
  meanLuminance,
} from './frames.ts';

/** Builds RGBA pixel data filled with one opaque colour. */
function rgba(r: number, g: number, b: number, count = 64): Uint8ClampedArray {
  const data = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i += 1) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return data;
}

describe('meanLuminance', () => {
  it('is 0 for black and 255 for white', () => {
    expect(meanLuminance(rgba(0, 0, 0))).toBe(0);
    expect(meanLuminance(rgba(255, 255, 255))).toBeCloseTo(255, 5);
  });

  it('weights channels perceptually (green reads brighter than blue)', () => {
    expect(meanLuminance(rgba(0, 255, 0))).toBeGreaterThan(meanLuminance(rgba(0, 0, 255)));
  });

  it('treats fully transparent pixels as black', () => {
    const transparent = new Uint8ClampedArray(4 * 16); // all zero => alpha 0
    expect(meanLuminance(transparent)).toBe(0);
  });

  it('returns 0 for empty input rather than NaN', () => {
    expect(meanLuminance(new Uint8ClampedArray(0))).toBe(0);
  });
});

describe('isNearlyBlack', () => {
  it('flags black pixel data', () => {
    expect(isNearlyBlack(rgba(0, 0, 0))).toBe(true);
  });

  it('does not flag a visibly lit frame', () => {
    expect(isNearlyBlack(rgba(120, 90, 60))).toBe(false);
  });

  it('honours a custom threshold', () => {
    expect(isNearlyBlack(rgba(40, 40, 40), 10)).toBe(false);
    expect(isNearlyBlack(rgba(40, 40, 40), 50)).toBe(true);
  });
});

describe('isBlackLuminance', () => {
  it('is true below the threshold and false above it', () => {
    expect(isBlackLuminance(BLACK_LUMINANCE_THRESHOLD - 1)).toBe(true);
    expect(isBlackLuminance(BLACK_LUMINANCE_THRESHOLD + 1)).toBe(false);
  });

  it('treats an unknown luminance as black', () => {
    expect(isBlackLuminance(Number.POSITIVE_INFINITY)).toBe(true);
    expect(isBlackLuminance(Number.NaN)).toBe(true);
  });
});

describe('candidateTimestamps', () => {
  it('samples ~10% of the duration clamped to 0.5-3s', () => {
    // 60s clip -> 6s clamped down to 3s
    expect(candidateTimestamps(60)[0]).toBe(3);
    // 8s clip -> 0.8s
    expect(candidateTimestamps(8)[0]).toBeCloseTo(0.8, 5);
    // 1s clip -> 0.5s floor
    expect(candidateTimestamps(1)[0]).toBe(0.5);
  });

  it('falls back to 25/50/75% after the primary sample', () => {
    const times = candidateTimestamps(8);
    expect(times.slice(1)).toEqual([2, 4, 6]);
  });

  it('never seeks past the end of the clip', () => {
    for (const duration of [0.4, 1, 3, 8, 60]) {
      for (const time of candidateTimestamps(duration)) {
        expect(time).toBeGreaterThanOrEqual(0);
        expect(time).toBeLessThan(duration);
      }
    }
  });

  it('deduplicates on very short clips', () => {
    const times = candidateTimestamps(0.6);
    expect(new Set(times.map((t) => Math.round(t * 1000))).size).toBe(times.length);
  });

  it('returns a single zero for unknown/zero duration', () => {
    expect(candidateTimestamps(0)).toEqual([0]);
    expect(candidateTimestamps(Number.NaN)).toEqual([0]);
    expect(candidateTimestamps(Number.POSITIVE_INFINITY)).toEqual([0]);
  });
});
