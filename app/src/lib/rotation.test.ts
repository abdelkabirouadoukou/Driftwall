import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INTERVAL_SECS,
  MIN_INTERVAL_SECS,
  formatCountdown,
  fromSecs,
  minutesToSecs,
  secsToMinutes,
  toSecs,
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

describe('rotation interval units', () => {
  it('converts a value + unit to seconds', () => {
    expect(toSecs(30, 'seconds')).toBe(30);
    expect(toSecs(5, 'minutes')).toBe(300);
    expect(toSecs(2, 'hours')).toBe(7200);
    expect(toSecs(0.5, 'minutes')).toBe(30);
  });

  it('applies the floor to empty, zero or invalid input', () => {
    expect(toSecs(0, 'minutes')).toBe(MIN_INTERVAL_SECS);
    expect(toSecs(Number.NaN, 'hours')).toBe(MIN_INTERVAL_SECS);
    expect(toSecs(1, 'seconds')).toBe(MIN_INTERVAL_SECS);
  });

  it('picks the friendliest unit when reading seconds back', () => {
    expect(fromSecs(30)).toEqual({ value: 30, unit: 'seconds' });
    expect(fromSecs(1800)).toEqual({ value: 30, unit: 'minutes' });
    expect(fromSecs(7200)).toEqual({ value: 2, unit: 'hours' });
    expect(fromSecs(90)).toEqual({ value: 90, unit: 'seconds' });
    expect(fromSecs(150)).toEqual({ value: 2.5, unit: 'minutes' });
    expect(fromSecs(0)).toEqual({ value: 30, unit: 'minutes' });
  });

  it('round-trips through fromSecs/toSecs', () => {
    for (const secs of [15, 30, 60, 300, 1800, 3600, 86400]) {
      const { value, unit } = fromSecs(secs);
      expect(toSecs(value, unit)).toBe(secs);
    }
  });

  it('formats a countdown', () => {
    expect(formatCountdown(25_000)).toBe('25 s');
    expect(formatCountdown(4 * 60_000 + 10_000)).toBe('4 min');
    expect(formatCountdown(2 * 3_600_000 + 5 * 60_000)).toBe('2 h 5 min');
    expect(formatCountdown(3_600_000)).toBe('1 h');
    expect(formatCountdown(-5)).toBe('0 s');
  });
});
