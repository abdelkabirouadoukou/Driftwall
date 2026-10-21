import { describe, expect, it } from 'vitest';
import {
  parseTimestamp,
  parseYouTubeUrl,
  placeholderTitle,
  stepIndex,
  titleFromPath,
} from './music.ts';

describe('parseTimestamp', () => {
  it('handles plain seconds and suffixed forms', () => {
    expect(parseTimestamp('3927')).toBe(3927);
    expect(parseTimestamp('3927s')).toBe(3927);
    expect(parseTimestamp('1h2m3s')).toBe(3723);
    expect(parseTimestamp('2m10s')).toBe(130);
  });
  it('returns 0 for junk', () => {
    expect(parseTimestamp(null)).toBe(0);
    expect(parseTimestamp('abc')).toBe(0);
  });
});

describe('parseYouTubeUrl', () => {
  it('parses a watch link with a radio list', () => {
    expect(
      parseYouTubeUrl('https://www.youtube.com/watch?v=Kylm5L2mVzY&list=RDKylm5L2mVzY&start_radio=1'),
    ).toEqual({ videoId: 'Kylm5L2mVzY', start: 0 });
  });
  it('reads the start time', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=AdgYT71N9aE&t=3927s')).toEqual({
      videoId: 'AdgYT71N9aE',
      start: 3927,
    });
  });
  it('parses short, shorts and music links', () => {
    expect(parseYouTubeUrl('https://youtu.be/AdgYT71N9aE?t=10')?.start).toBe(10);
    expect(parseYouTubeUrl('youtube.com/shorts/AdgYT71N9aE')?.videoId).toBe('AdgYT71N9aE');
    expect(parseYouTubeUrl('https://music.youtube.com/watch?v=AdgYT71N9aE')?.videoId).toBe(
      'AdgYT71N9aE',
    );
  });
  it('rejects other sites and bad ids', () => {
    expect(parseYouTubeUrl('https://example.com/watch?v=AdgYT71N9aE')).toBeNull();
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(parseYouTubeUrl('')).toBeNull();
    expect(parseYouTubeUrl('not a url at all')).toBeNull();
  });
});

describe('helpers', () => {
  it('stepIndex wraps both ways', () => {
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
    expect(stepIndex(0, 0, 1)).toBe(-1);
  });
  it('titles', () => {
    expect(placeholderTitle('abc')).toBe('YouTube · abc');
    expect(titleFromPath('/a/b/My Song.mp3')).toBe('My Song');
    expect(titleFromPath('C:\\x\\song')).toBe('song');
  });
});
