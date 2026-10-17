import { describe, expect, it } from 'vitest';
import {
  classifyMedia,
  extensionOf,
  isSupported,
  rejectionMessage,
} from './media.ts';

describe('extensionOf', () => {
  it('lowercases and extracts the extension', () => {
    expect(extensionOf('/Users/me/Clip.MP4')).toBe('mp4');
    expect(extensionOf('photo.JPEG')).toBe('jpeg');
  });

  it('handles paths without an extension', () => {
    expect(extensionOf('/Users/me/README')).toBe('');
    expect(extensionOf('/Users/me/folder.with.dots/noext')).toBe('');
  });

  it('ignores dotfiles and trailing slashes', () => {
    expect(extensionOf('/Users/me/.hidden')).toBe('');
    expect(extensionOf('/Users/me/video.mp4/')).toBe('mp4');
  });
});

describe('classifyMedia', () => {
  it('classifies images as static', () => {
    for (const name of ['a.jpg', 'a.jpeg', 'a.png', 'a.gif', 'a.webp', 'a.bmp', 'a.tiff']) {
      expect(classifyMedia(`/x/${name}`)).toBe('static');
    }
  });

  it('classifies mp4/mov/m4v as video', () => {
    for (const name of ['a.mp4', 'a.mov', 'a.m4v']) {
      expect(classifyMedia(`/x/${name}`)).toBe('video');
    }
  });

  it('rejects unsupported formats', () => {
    for (const name of ['a.mkv', 'a.avi', 'a.txt', 'a.webm', 'a']) {
      expect(classifyMedia(`/x/${name}`)).toBeNull();
    }
  });
});

describe('isSupported', () => {
  it('is true only for accepted media', () => {
    expect(isSupported('/x/a.png')).toBe(true);
    expect(isSupported('/x/a.mp4')).toBe(true);
    expect(isSupported('/x/a.mkv')).toBe(false);
  });
});

describe('rejectionMessage', () => {
  it('names the offending extension', () => {
    expect(rejectionMessage('/x/a.mkv')).toContain('.mkv');
    expect(rejectionMessage('/x/a.mkv')).toContain('H.264/HEVC');
  });

  it('handles extension-less paths', () => {
    expect(rejectionMessage('/x/noext')).toContain('(no extension)');
  });
});
