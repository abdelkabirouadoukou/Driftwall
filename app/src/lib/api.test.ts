import { afterEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import * as api from './api.ts';
import type { WallpaperRecord } from './domain.ts';

function enterTauri() {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
}

afterEach(() => {
  vi.unstubAllGlobals();
  invoke.mockReset();
});

const record: WallpaperRecord = {
  id: 'abc',
  type: 'video',
  file_path: '/data/wallpapers/abc.mp4',
  title: 'Clip',
  tags: ['nature'],
  width: 1920,
  height: 1080,
  duration: 10,
  created_at: '2026-01-01T00:00:00.000Z',
};

describe('isTauri', () => {
  it('is false outside the Tauri webview', () => {
    expect(api.isTauri()).toBe(false);
  });

  it('is true when the Tauri runtime is present', () => {
    enterTauri();
    expect(api.isTauri()).toBe(true);
  });
});

describe('not-in-Tauri guard', () => {
  it('rejects with NotInTauriError instead of a raw TypeError', async () => {
    await expect(api.libraryList()).rejects.toBeInstanceOf(api.NotInTauriError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('exposes a friendly message', async () => {
    await expect(api.libraryList()).rejects.toThrow(
      'Open the Driftwall app window, not the browser.',
    );
  });
});

describe('command wiring', () => {
  it('libraryList invokes library_list', async () => {
    enterTauri();
    invoke.mockResolvedValue([record]);
    await expect(api.libraryList()).resolves.toEqual([record]);
    expect(invoke).toHaveBeenCalledWith('library_list', undefined);
  });

  it('libraryAdd passes the wallpaper under an object arg', async () => {
    enterTauri();
    invoke.mockResolvedValue(undefined);
    await api.libraryAdd(record);
    expect(invoke).toHaveBeenCalledWith('library_add', { wallpaper: record });
  });

  it('libraryRename sends id and title', async () => {
    enterTauri();
    invoke.mockResolvedValue(undefined);
    await api.libraryRename('abc', 'New');
    expect(invoke).toHaveBeenCalledWith('library_rename', {
      id: 'abc',
      title: 'New',
    });
  });

  it('libraryDelete sends the id', async () => {
    enterTauri();
    invoke.mockResolvedValue(undefined);
    await api.libraryDelete('abc');
    expect(invoke).toHaveBeenCalledWith('library_delete', { id: 'abc' });
  });

  it('settingsGet / settingsSet use the key/value shape', async () => {
    enterTauri();
    invoke.mockResolvedValue(null);
    await api.settingsGet('theme');
    expect(invoke).toHaveBeenCalledWith('settings_get', { key: 'theme' });

    invoke.mockResolvedValue(undefined);
    await api.settingsSet('theme', 'dark');
    expect(invoke).toHaveBeenCalledWith('settings_set', {
      key: 'theme',
      value: 'dark',
    });
  });

  it('getDockMode / setDockMode use the dock flag', async () => {
    enterTauri();
    invoke.mockResolvedValue(true);
    await expect(api.getDockMode()).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith('get_dock_mode', undefined);

    invoke.mockResolvedValue(undefined);
    await api.setDockMode(false);
    expect(invoke).toHaveBeenCalledWith('set_dock_mode', { dock: false });
  });

  it('revealInFinder sends the path', async () => {
    enterTauri();
    invoke.mockResolvedValue(undefined);
    await api.revealInFinder('/data/wallpapers/abc.mp4');
    expect(invoke).toHaveBeenCalledWith('reveal_in_finder', {
      path: '/data/wallpapers/abc.mp4',
    });
  });

  it('discoverCategories invokes discover_categories', async () => {
    enterTauri();
    invoke.mockResolvedValue(['Space']);
    await expect(api.discoverCategories()).resolves.toEqual(['Space']);
    expect(invoke).toHaveBeenCalledWith('discover_categories', undefined);
  });

  it('discoverSearch passes the search shape through', async () => {
    enterTauri();
    invoke.mockResolvedValue({ items: [], page: 1, has_more: false });
    await api.discoverSearch({
      query: 'cats',
      source: 'wallhaven',
      category: 'Nature',
      page: 2,
    });
    expect(invoke).toHaveBeenCalledWith('discover_search', {
      query: 'cats',
      source: 'wallhaven',
      category: 'Nature',
      page: 2,
    });
  });

  it('discoverDownload flattens the item and camel-cases source_url', async () => {
    enterTauri();
    invoke.mockResolvedValue({
      id: 'x',
      file_path: '/data/wallpapers/x.mp4',
      kind: 'video',
      title: 'Clip',
      source: 'pixabay',
    });
    await api.discoverDownload({
      item: {
        id: 'pixabay-1',
        source: 'pixabay',
        kind: 'video',
        title: 'Clip',
        thumb_url: 'https://t/x.jpg',
        full_url: 'https://cdn/x.mp4',
        source_url: 'https://pixabay.com/videos/id-1/',
        author: 'artist',
      },
    });
    expect(invoke).toHaveBeenCalledWith('discover_download', {
      url: 'https://cdn/x.mp4',
      kind: 'video',
      title: 'Clip',
      source: 'pixabay',
      sourceUrl: 'https://pixabay.com/videos/id-1/',
      author: 'artist',
    });
  });
});
