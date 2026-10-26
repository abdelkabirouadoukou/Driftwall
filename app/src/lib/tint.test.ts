import { describe, expect, it } from 'vitest';
import { NEUTRAL_TINT, dominantColor, rgbToHsl, tintFromRgb } from './tint.ts';

const px = (r: number, g: number, b: number, a = 255) => [r, g, b, a];

describe('dominantColor', () => {
  it('returns the colour of a flat image', () => {
    expect(dominantColor([...px(200, 40, 40), ...px(200, 40, 40)])).toEqual([200, 40, 40]);
  });

  it('ignores letterbox black, burnt white and transparent pixels', () => {
    const data = [...px(0, 0, 0), ...px(255, 255, 255), ...px(10, 200, 10, 0), ...px(30, 90, 200)];
    expect(dominantColor(data)).toEqual([30, 90, 200]);
  });

  it('prefers saturated pixels over grey ones', () => {
    const result = dominantColor([...px(120, 120, 120), ...px(220, 30, 30)])!;
    expect(result[0]).toBeGreaterThan(170);
    expect(result[1]).toBeLessThan(80);
  });

  it('gives up on images with nothing usable', () => {
    expect(dominantColor([...px(0, 0, 0), ...px(255, 255, 255)])).toBeNull();
    expect(dominantColor([])).toBeNull();
  });
});

describe('rgbToHsl', () => {
  it('maps primary colours to their hue', () => {
    expect(rgbToHsl([255, 0, 0])[0]).toBe(0);
    expect(rgbToHsl([0, 255, 0])[0]).toBe(120);
    expect(rgbToHsl([0, 0, 255])[0]).toBe(240);
  });
});

describe('tintFromRgb', () => {
  it('falls back to the neutral app surface without a colour', () => {
    expect(tintFromRgb(null)).toBe(NEUTRAL_TINT);
  });

  it('keeps the hue of the video but stays dark', () => {
    const tint = tintFromRgb([30, 90, 220]);
    expect(tint.bg).toMatch(/^hsl\(2\d\d \d+% 16%\)$/);
    expect(tint.bar).toMatch(/ 11%\)$/);
    expect(tint.hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});
