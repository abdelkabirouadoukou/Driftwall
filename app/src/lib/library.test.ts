import { describe, expect, it } from 'vitest';
import {
  isAcceptedMedia,
  parseTags,
  sanitizeTitle,
  serializeTags,
  storedFileName,
  thumbnailFileName,
  titleFromPath,
  uuid,
} from './library.ts';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('storedFileName', () => {
  it('uses the uuid plus a lowercased extension', () => {
    expect(storedFileName('abc', '/a/b/Clip.MP4')).toBe('abc.mp4');
    expect(storedFileName('abc', 'photo.jpeg')).toBe('abc.jpeg');
  });

  it('omits the extension for extension-less and dotfile names', () => {
    expect(storedFileName('abc', '/a/b/noext')).toBe('abc');
    expect(storedFileName('abc', '/a/b/.hidden')).toBe('abc');
  });
});

describe('thumbnailFileName', () => {
  it('appends a png suffix', () => {
    expect(thumbnailFileName('abc')).toBe('abc.thumb.png');
  });
});

describe('sanitizeTitle', () => {
  it('collapses whitespace and trims', () => {
    expect(sanitizeTitle('  Hello   world  ')).toBe('Hello world');
  });

  it('truncates to 200 characters', () => {
    expect(sanitizeTitle('x'.repeat(300))).toHaveLength(200);
  });
});

describe('titleFromPath', () => {
  it('strips directories and the extension', () => {
    expect(titleFromPath('/Users/me/My Wallpaper.mp4')).toBe('My Wallpaper');
    expect(titleFromPath('sunset.HEIC.png')).toBe('sunset.HEIC');
  });

  it('resolves a trailing slash to the directory name', () => {
    expect(titleFromPath('/Users/me/')).toBe('me');
  });

  it('falls back to Untitled when nothing remains', () => {
    expect(titleFromPath('/')).toBe('Untitled');
  });
});

describe('tags serialisation', () => {
  it('round-trips', () => {
    expect(parseTags(serializeTags(['a', 'b']))).toEqual(['a', 'b']);
  });

  it('drops blank tags', () => {
    expect(serializeTags([' a ', '  ', '', 'b'])).toBe('["a","b"]');
  });

  it('returns [] on malformed input', () => {
    expect(parseTags('not json')).toEqual([]);
    expect(parseTags('{"a":1}')).toEqual([]);
  });
});

describe('isAcceptedMedia', () => {
  it('mirrors media classification', () => {
    expect(isAcceptedMedia('/x/a.mp4')).toBe(true);
    expect(isAcceptedMedia('/x/a.mkv')).toBe(false);
  });
});

describe('uuid', () => {
  it('returns an RFC 4122 v4 identifier', () => {
    expect(uuid()).toMatch(UUID_RE);
    expect(uuid()).not.toBe(uuid());
  });
});
