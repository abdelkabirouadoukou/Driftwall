import { describe, expect, it } from 'vitest';
import type { DiscoverItem, DownloadProgress, Rendition } from './domain.ts';
import {
  type DownloadAction,
  type DownloadEntry,
  describeProgress,
  downloadsReducer,
  formatBytes,
  formatEta,
  formatSpeed,
  isActive,
  pickRendition,
  progressFraction,
} from './downloads.ts';

const rendition = (key: string, def = false): Rendition => ({
  key,
  label: key.toUpperCase(),
  url: `https://x/${key}.mp4`,
  default: def,
});

const item = (over: Partial<DiscoverItem> = {}): DiscoverItem => ({
  id: 'pexels-video-1',
  source: 'pexels-videos',
  kind: 'video',
  title: 'Calm sea',
  thumb_url: 'https://x/t.jpg',
  full_url: 'https://x/full.mp4',
  renditions: [rendition('4k'), rendition('1080p', true), rendition('540p')],
  ...over,
});

const progress = (over: Partial<DownloadProgress> = {}): DownloadProgress => ({
  id: 'pexels-video-1',
  bytes_done: 0,
  bytes_total: null,
  speed_bps: 0,
  phase: 'downloading',
  ...over,
});

function run(actions: DownloadAction[], from: DownloadEntry[] = []): DownloadEntry[] {
  return actions.reduce(downloadsReducer, from);
}

const start = (i = item(), r: Rendition | null = rendition('1080p', true)): DownloadAction => ({
  type: 'start',
  item: i,
  rendition: r,
  now: 1000,
});

describe('pickRendition', () => {
  it('prefers the requested key, then the default, then the first', () => {
    expect(pickRendition(item(), '540p')?.key).toBe('540p');
    expect(pickRendition(item(), 'nope')?.key).toBe('1080p');
    expect(pickRendition(item())?.key).toBe('1080p');
    expect(pickRendition(item({ renditions: [rendition('a'), rendition('b')] }))?.key).toBe('a');
    expect(pickRendition(item({ renditions: [] }))).toBeNull();
    expect(pickRendition(item({ renditions: undefined }))).toBeNull();
  });
});

describe('downloadsReducer', () => {
  it('adds a queued entry with the chosen quality, newest first', () => {
    const state = run([start(), start(item({ id: 'other', title: 'Other' }))]);
    expect(state.map((e) => e.id)).toEqual(['other', 'pexels-video-1']);
    expect(state[1]).toMatchObject({
      phase: 'queued',
      title: 'Calm sea',
      qualityLabel: '1080P',
      thumb: 'https://x/t.jpg',
      recordId: null,
    });
  });

  it('ignores a second start while the first is still active', () => {
    const once = run([start()]);
    const twice = run([start()], once);
    expect(twice).toBe(once);
  });

  it('lets a finished or failed download be started again', () => {
    const failed = run([start(), { type: 'fail', id: 'pexels-video-1', error: 'x' }]);
    const again = run([start()], failed);
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ phase: 'queued', error: null, bytesDone: 0 });
  });

  it('tracks byte progress, speed and total', () => {
    const state = run([
      start(),
      { type: 'progress', progress: progress({ bytes_done: 2000, bytes_total: 10000, speed_bps: 500 }) },
    ]);
    expect(state[0]).toMatchObject({
      phase: 'downloading',
      bytesDone: 2000,
      bytesTotal: 10000,
      speedBps: 500,
    });
    expect(progressFraction(state[0]!)).toBeCloseTo(0.2);
  });

  it('keeps a known total when later events omit it, and never goes backwards', () => {
    const state = run([
      start(),
      { type: 'progress', progress: progress({ bytes_done: 5000, bytes_total: 10000 }) },
      { type: 'progress', progress: progress({ bytes_done: 3000, bytes_total: null }) },
    ]);
    expect(state[0]).toMatchObject({ bytesDone: 5000, bytesTotal: 10000 });
  });

  it('treats the engine "done" as processing until the library import finishes', () => {
    const state = run([
      start(),
      { type: 'progress', progress: progress({ bytes_done: 10, bytes_total: 10, phase: 'done' }) },
    ]);
    expect(state[0]!.phase).toBe('processing');
    expect(isActive(state[0]!)).toBe(true);
    const finished = run([{ type: 'done', id: 'pexels-video-1', recordId: 'rec-1' }], state);
    expect(finished[0]).toMatchObject({ phase: 'done', recordId: 'rec-1', bytesDone: 10 });
    expect(isActive(finished[0]!)).toBe(false);
  });

  it('does not rewind phases when events arrive late', () => {
    const state = run([
      start(),
      { type: 'progress', progress: progress({ bytes_done: 9, bytes_total: 10, phase: 'processing' }) },
      { type: 'progress', progress: progress({ bytes_done: 4, bytes_total: 10, phase: 'downloading' }) },
      { type: 'progress', progress: progress({ phase: 'queued' }) },
    ]);
    expect(state[0]!.phase).toBe('processing');
    expect(state[0]!.bytesDone).toBe(9);
  });

  it('ignores progress after completion or failure', () => {
    const done = run([start(), { type: 'done', id: 'pexels-video-1', recordId: 'r' }]);
    expect(run([{ type: 'progress', progress: progress({ phase: 'downloading' }) }], done)[0]!.phase).toBe('done');
    const failed = run([start(), { type: 'fail', id: 'pexels-video-1', error: 'boom' }]);
    expect(run([{ type: 'progress', progress: progress() }], failed)[0]).toMatchObject({
      phase: 'error',
      error: 'boom',
    });
  });

  it('records engine errors with their message', () => {
    const state = run([
      start(),
      { type: 'progress', progress: progress({ phase: 'error', error: 'Stalled' }) },
    ]);
    expect(state[0]).toMatchObject({ phase: 'error', error: 'Stalled', speedBps: 0 });
    const blank = run([start(), { type: 'progress', progress: progress({ phase: 'error' }) }]);
    expect(blank[0]!.error).toBe('Download failed.');
  });

  it('removes entries and clears only finished ones', () => {
    const state = run([
      start(item({ id: 'a' })),
      start(item({ id: 'b' })),
      start(item({ id: 'c' })),
      { type: 'done', id: 'a', recordId: 'r' },
      { type: 'fail', id: 'b', error: 'x' },
    ]);
    expect(run([{ type: 'remove', id: 'c' }], state).map((e) => e.id)).toEqual(['b', 'a']);
    expect(run([{ type: 'clear-finished' }], state).map((e) => e.id)).toEqual(['c']);
  });

  it('is a no-op for unknown ids', () => {
    const state = run([start()]);
    expect(run([{ type: 'progress', progress: progress({ id: 'ghost' }) }], state)).toBe(state);
    expect(run([{ type: 'processing', id: 'ghost' }], state)).toBe(state);
    expect(run([{ type: 'fail', id: 'ghost', error: 'x' }], state)).toBe(state);
  });
});

describe('formatting', () => {
  it('formats bytes in decimal units with sensible precision', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(NaN)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1500)).toBe('1.5 KB');
    expect(formatBytes(18_000_000)).toBe('18.0 MB');
    expect(formatBytes(150_000_000)).toBe('150 MB');
    expect(formatBytes(2_400_000_000)).toBe('2.4 GB');
  });

  it('formats speed', () => {
    expect(formatSpeed(0)).toBe('—');
    expect(formatSpeed(4_200_000)).toBe('4.2 MB/s');
  });

  it('estimates the time left', () => {
    const base = run([
      start(),
      {
        type: 'progress',
        progress: progress({ bytes_done: 2_000_000, bytes_total: 12_000_000, speed_bps: 1_000_000 }),
      },
    ])[0]!;
    expect(formatEta(base)).toBe('10 s left');
    expect(formatEta({ ...base, bytesDone: 11_999_999 })).toBe('almost done');
    expect(formatEta({ ...base, bytesDone: 0, bytesTotal: 65_000_000 })).toBe('1 min 5 s left');
    expect(formatEta({ ...base, bytesDone: 0, bytesTotal: 60_000_000 })).toBe('1 min left');
    expect(formatEta({ ...base, bytesDone: 0, bytesTotal: 5_000_000_000 })).toBe('1 h 23 min left');
    expect(formatEta({ ...base, bytesTotal: null })).toBeNull();
    expect(formatEta({ ...base, speedBps: 0 })).toBeNull();
    expect(formatEta({ ...base, phase: 'queued' })).toBeNull();
  });

  it('reports fractions, including unknown totals', () => {
    const entry = run([start()])[0]!;
    expect(progressFraction(entry)).toBeNull();
    expect(progressFraction({ ...entry, phase: 'processing' })).toBe(1);
    expect(progressFraction({ ...entry, phase: 'done' })).toBe(1);
    expect(progressFraction({ ...entry, phase: 'downloading', bytesDone: 50, bytesTotal: 40 })).toBe(1);
  });

  it('describes each phase in plain words', () => {
    const entry = run([start()])[0]!;
    expect(describeProgress(entry)).toBe('Waiting for a free slot…');
    expect(describeProgress({ ...entry, phase: 'processing' })).toBe('Adding to your library…');
    expect(describeProgress({ ...entry, phase: 'done' })).toBe('Added to your library');
    expect(describeProgress({ ...entry, phase: 'error', error: 'Stalled' })).toBe('Stalled');
    expect(describeProgress({ ...entry, phase: 'error', error: null })).toBe('Download failed');
    expect(
      describeProgress({
        ...entry,
        phase: 'downloading',
        bytesDone: 2_000_000,
        bytesTotal: 12_000_000,
        speedBps: 1_000_000,
      }),
    ).toBe('2.0 MB of 12.0 MB · 1.0 MB/s · 10 s left');
    expect(describeProgress({ ...entry, phase: 'downloading', bytesDone: 1_500_000 })).toBe('1.5 MB');
  });
});
