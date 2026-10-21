import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INTERVAL_SECS,
  MIN_INTERVAL_SECS,
  minutesToSecs,
  secsToMinutes,
} from './rotation.ts';

describe('rotation interval conversion', () => {
  it('converts minutes to seconds', () => {
    expect(minutesToSecs(30)).toBe(1800);
    expect(minutesToSecs(1.5)).toBe(90);
  });

  it('never goes below the server floor', () => {
    expect(minutesToSecs(0)).toBe(MIN_INTERVAL_SECS);
    expect(minutesToSecs(0.01)).toBe(MIN_INTERVAL_SECS);
    expect(minutesToSecs(-5)).toBe(MIN_INTERVAL_SECS);
  });

  it('falls back to the default for non-finite input', () => {
    expect(minutesToSecs(Number.NaN)).toBe(DEFAULT_INTERVAL_SECS);
  });

  it('converts seconds to minutes', () => {
    expect(secsToMinutes(1800)).toBe(30);
    expect(secsToMinutes(90)).toBe(1.5);
    expect(secsToMinutes(0)).toBe(30);
  });

  it('round-trips whole minutes', () => {
    for (const m of [1, 5, 30, 120]) expect(secsToMinutes(minutesToSecs(m))).toBe(m);
  });
});
