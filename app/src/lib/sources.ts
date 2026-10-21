/**
 * Presentation data for Discover sources.
 *
 * Behaviour (what needs a key, what supports search or sorting) is owned by
 * Rust and arrives through `discover_sources`; this file only adds the words and
 * links people read, including the attribution each provider asks for.
 */

import type { DiscoverSort, DiscoverSource } from './domain.ts';

export type SourceGroup = 'photos' | 'live';

export interface SourceMeta {
  id: DiscoverSource;
  group: SourceGroup;
  /** Short name on the source pill. */
  label: string;
  /** One line describing what the source is good for. */
  blurb: string;
  /** Attribution line shown while browsing the source. */
  credit: string;
  /** Provider home page the credit links to. */
  creditUrl: string;
  /** Where to get a free API key, for sources that use one. */
  keyUrl?: string;
}

export const SOURCES: readonly SourceMeta[] = [
  {
    id: 'wallhaven',
    group: 'photos',
    label: 'Wallhaven',
    blurb: 'Gaming, anime and dark art. No key needed.',
    credit: 'Wallpapers from Wallhaven. Artwork belongs to its creators; for personal use.',
    creditUrl: 'https://wallhaven.cc',
  },
  {
    id: 'pexels',
    group: 'photos',
    label: 'Pexels',
    blurb: 'Hi-res photography, free to use.',
    credit: 'Photos provided by Pexels.',
    creditUrl: 'https://www.pexels.com',
    keyUrl: 'https://www.pexels.com/api/',
  },
  {
    id: 'bing',
    group: 'photos',
    label: 'Bing Daily',
    blurb: 'A fresh photo every day, from around the world.',
    credit:
      'Daily images © Microsoft and the photographers, via Bing’s unofficial feed. For personal use.',
    creditUrl: 'https://www.bing.com',
  },
  {
    id: 'nasa',
    group: 'photos',
    label: 'NASA APOD',
    blurb: 'The astronomy picture of the day. Naturally dark.',
    credit:
      'NASA Astronomy Picture of the Day. Some images are copyrighted by their authors.',
    creditUrl: 'https://apod.nasa.gov',
    keyUrl: 'https://api.nasa.gov/',
  },
  {
    id: 'pexels-videos',
    group: 'live',
    label: 'Pexels',
    blurb: 'Cinematic stock loops, up to 4K.',
    credit: 'Videos provided by Pexels.',
    creditUrl: 'https://www.pexels.com',
    keyUrl: 'https://www.pexels.com/api/',
  },
  {
    id: 'pixabay-videos',
    group: 'live',
    label: 'Pixabay',
    blurb: 'Animated loops and motion backgrounds.',
    credit: 'Videos from Pixabay.',
    creditUrl: 'https://pixabay.com',
    keyUrl: 'https://pixabay.com/api/docs/',
  },
];

export const GROUPS: readonly { id: SourceGroup; label: string }[] = [
  { id: 'photos', label: 'Photos' },
  { id: 'live', label: 'Live' },
];

const BY_ID = new Map<string, SourceMeta>(SOURCES.map((s) => [s.id, s]));

/** Metadata for a source id, or `undefined` for unknown ids. */
export function sourceMeta(id: string | null | undefined): SourceMeta | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** Sources in a group, in display order. */
export function sourcesIn(group: SourceGroup): SourceMeta[] {
  return SOURCES.filter((s) => s.group === group);
}

/** The group a source belongs to (`photos` for unknown ids). */
export function groupOf(id: DiscoverSource): SourceGroup {
  return BY_ID.get(id)?.group ?? 'photos';
}

/**
 * Display name for a stored source id — including the legacy `pixabay` id that
 * library entries saved by earlier builds still carry.
 */
export function sourceLabel(id: string | null | undefined): string {
  if (!id) return '';
  if (id === 'pixabay') return 'Pixabay';
  const meta = BY_ID.get(id);
  if (!meta) return id;
  if (meta.id === 'pexels-videos') return 'Pexels';
  if (meta.id === 'pixabay-videos') return 'Pixabay';
  return meta.label;
}

export const SORT_LABELS: Record<DiscoverSort, string> = {
  relevance: 'Best match',
  popular: 'Popular',
  latest: 'Newest',
  random: 'Shuffle',
};

export const SORT_ORDER: readonly DiscoverSort[] = ['relevance', 'popular', 'latest', 'random'];
