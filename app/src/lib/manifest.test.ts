import { describe, expect, it } from 'vitest';
import { isManifest, validateManifest } from './manifest.ts';

const VALID_SHA = 'a'.repeat(64);

function videoManifest() {
  return {
    manifestVersion: 1,
    id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    title: 'Aurora loop',
    type: 'video',
    files: [
      { role: 'source', path: 'media/clip.mp4', bytes: 1024, sha256: VALID_SHA },
      { role: 'thumbnail', path: 'media/clip.thumb.png', bytes: 12, sha256: VALID_SHA },
    ],
    tags: ['nature', 'night'],
    loop: { start: 0, end: 12.5, muted: true },
    displays: [
      { displayId: null, scaleMode: 'fill', anchor: 'center' },
      { displayId: 'abc', scaleMode: 'fit' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    author: 'Driftwall',
  };
}

describe('validateManifest', () => {
  it('accepts a valid video manifest', () => {
    const result = validateManifest(videoManifest());
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('accepts a valid static manifest without a loop', () => {
    const manifest = videoManifest();
    const staticManifest = {
      ...manifest,
      type: 'static',
      files: [{ role: 'source', path: 'media/pic.jpg', bytes: 10, sha256: VALID_SHA }],
      loop: undefined,
      displays: undefined,
    };
    expect(validateManifest(staticManifest).valid).toBe(true);
  });

  it('rejects a non-object', () => {
    expect(validateManifest('nope').valid).toBe(false);
    expect(validateManifest(null).valid).toBe(false);
  });

  it('rejects a missing required field', () => {
    const manifest: Record<string, unknown> = videoManifest();
    delete manifest.title;
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('title');
  });

  it('rejects a malformed id', () => {
    expect(validateManifest({ ...videoManifest(), id: 'not-a-uuid' }).valid).toBe(false);
  });

  it('rejects an unsupported type', () => {
    expect(validateManifest({ ...videoManifest(), type: 'webm' }).valid).toBe(false);
  });

  it('rejects absolute or traversal file paths', () => {
    const base = videoManifest();
    const absolute = {
      ...base,
      files: [{ role: 'source', path: '/etc/passwd', bytes: 1, sha256: VALID_SHA }],
    };
    const traversal = {
      ...base,
      files: [{ role: 'source', path: '../secret.mp4', bytes: 1, sha256: VALID_SHA }],
    };
    expect(validateManifest(absolute).valid).toBe(false);
    expect(validateManifest(traversal).valid).toBe(false);
  });

  it('rejects a malformed sha256 digest', () => {
    const bad = {
      ...videoManifest(),
      files: [{ role: 'source', path: 'a.mp4', bytes: 1, sha256: 'XYZ' }],
    };
    expect(validateManifest(bad).valid).toBe(false);
  });

  it('rejects an empty file list', () => {
    expect(validateManifest({ ...videoManifest(), files: [] }).valid).toBe(false);
  });

  it('rejects duplicate tags', () => {
    expect(validateManifest({ ...videoManifest(), tags: ['a', 'a'] }).valid).toBe(false);
  });

  it('rejects a loop on a static wallpaper', () => {
    const staticWithLoop = {
      ...videoManifest(),
      type: 'static',
      loop: { start: 0, end: 5 },
    };
    expect(validateManifest(staticWithLoop).valid).toBe(false);
  });

  it('rejects a non-positive loop end', () => {
    expect(validateManifest({ ...videoManifest(), loop: { start: 0, end: 0 } }).valid).toBe(
      false,
    );
  });

  it('rejects unknown scale modes', () => {
    const bad = {
      ...videoManifest(),
      displays: [{ scaleMode: 'cover' }],
    };
    expect(validateManifest(bad).valid).toBe(false);
  });
});

describe('isManifest', () => {
  it('narrows valid manifests', () => {
    expect(isManifest(videoManifest())).toBe(true);
    expect(isManifest({})).toBe(false);
  });
});
