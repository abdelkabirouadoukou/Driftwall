import { describe, expect, it } from 'vitest';
import type { DiscoverSource } from './domain.ts';
import { GROUPS, SOURCES, groupOf, sourceLabel, sourceMeta, sourcesIn } from './sources.ts';

describe('source presentation data', () => {
  it('lists every source once, with unique ids', () => {
    const ids = SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(6);
  });

  it('puts each source in exactly one known group, in a stable order', () => {
    const known = new Set(GROUPS.map((g) => g.id));
    for (const source of SOURCES) expect(known.has(source.group)).toBe(true);
    expect(sourcesIn('photos').map((s) => s.id)).toEqual(['wallhaven', 'pexels', 'bing', 'nasa']);
    expect(sourcesIn('live').map((s) => s.id)).toEqual(['pexels-videos', 'pixabay-videos']);
    expect(groupOf('pexels-videos')).toBe('live');
    expect(groupOf('bing')).toBe('photos');
  });

  it('gives key-based sources a sign-up link and every source a credit', () => {
    for (const id of ['pexels', 'pexels-videos', 'pixabay-videos', 'nasa'] as DiscoverSource[]) {
      expect(sourceMeta(id)?.keyUrl, id).toMatch(/^https:\/\//);
    }
    for (const id of ['wallhaven', 'bing'] as DiscoverSource[]) {
      expect(sourceMeta(id)?.keyUrl, id).toBeUndefined();
    }
    for (const source of SOURCES) {
      expect(source.credit.length, source.id).toBeGreaterThan(10);
      expect(source.creditUrl, source.id).toMatch(/^https:\/\//);
    }
  });

  it('credits Pexels and Pixabay as their terms ask', () => {
    expect(sourceMeta('pexels')?.credit).toMatch(/Pexels/);
    expect(sourceMeta('pexels-videos')?.credit).toMatch(/Pexels/);
    expect(sourceMeta('pixabay-videos')?.credit).toMatch(/Pixabay/);
  });

  it('names stored sources, including the legacy Pixabay id', () => {
    expect(sourceLabel('wallhaven')).toBe('Wallhaven');
    expect(sourceLabel('pexels-videos')).toBe('Pexels');
    expect(sourceLabel('pixabay-videos')).toBe('Pixabay');
    expect(sourceLabel('pixabay')).toBe('Pixabay');
    expect(sourceLabel('bing')).toBe('Bing Daily');
    expect(sourceLabel('something-new')).toBe('something-new');
    expect(sourceLabel(null)).toBe('');
    expect(sourceLabel(undefined)).toBe('');
  });
});
