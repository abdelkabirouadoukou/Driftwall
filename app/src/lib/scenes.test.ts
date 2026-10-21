import { describe, expect, it } from 'vitest';
import { SCENES, mulberry32, sceneById, sceneIdFromCurrent } from './scenes.ts';

describe('scenes registry', () => {
  it('has unique ids that are safe to send to Rust', () => {
    const ids = SCENES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('looks scenes up and parses the engine id', () => {
    expect(sceneById('aurora')?.name).toBe('Aurora');
    expect(sceneById('nope')).toBeUndefined();
    expect(sceneIdFromCurrent('scene:rain')).toBe('rain');
    expect(sceneIdFromCurrent('abc-123')).toBeNull();
    expect(sceneIdFromCurrent(null)).toBeNull();
  });

  it('every scale is a sensible fraction', () => {
    for (const s of SCENES) {
      expect(s.scale).toBeGreaterThan(0);
      expect(s.scale).toBeLessThanOrEqual(1);
    }
  });
});

describe('mulberry32', () => {
  it('is deterministic and in [0, 1)', () => {
    const a = mulberry32(1);
    const b = mulberry32(1);
    for (let i = 0; i < 20; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
