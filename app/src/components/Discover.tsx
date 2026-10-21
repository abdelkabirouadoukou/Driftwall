import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Download,
  ExternalLink,
  ImageDown,
  KeyRound,
  Loader2,
  MonitorPlay,
  Moon,
  Search as SearchIcon,
  Video,
  X,
} from 'lucide-react';
import EmptyState from './EmptyState.tsx';
import Skeleton from './Skeleton.tsx';
import { ProgressBar, useDownloads } from './Downloads.tsx';
import * as api from '../lib/api.ts';
import { mainScrollElement } from '../lib/dom.ts';
import type {
  DiscoverItem,
  DiscoverSort,
  DiscoverSource,
  Rendition,
  SourceInfo,
} from '../lib/domain.ts';
import {
  type DownloadEntry,
  describeProgress,
  isActive,
  pickRendition,
} from '../lib/downloads.ts';
import {
  GROUPS,
  SORT_LABELS,
  SORT_ORDER,
  type SourceGroup,
  groupOf,
  sourceLabel,
  sourceMeta,
  sourcesIn,
} from '../lib/sources.ts';

interface Props {
  query: string;
  category: string;
  onCategory: (category: string) => void;
  onOpenSettings: () => void;
}

export default function Discover({ query, category, onCategory, onOpenSettings }: Props) {
  const { entries, start, cancel } = useDownloads();
  const [infos, setInfos] = useState<SourceInfo[]>([]);
  const [source, setSource] = useState<DiscoverSource>('wallhaven');
  const [categories, setCategories] = useState<string[]>([]);
  const [sort, setSort] = useState<DiscoverSort>('relevance');
  const [dark, setDark] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [items, setItems] = useState<DiscoverItem[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DiscoverItem | null>(null);
  const requestRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const group: SourceGroup = groupOf(source);
  const meta = sourceMeta(source);
  const info = infos.find((i) => i.id === source);
  const needsKey = !!info && info.key_required && !info.has_key;
  const supportsSearch = info?.supports_search ?? true;
  const supportsSort = info?.supports_sort ?? false;
  const supportsDark = source !== 'bing' && source !== 'nasa';
  // Sources without search ignore the query and categories entirely; sending
  // empty values keeps their cache entries from fragmenting.
  const effectiveQuery = supportsSearch ? debouncedQuery : '';
  const effectiveCategory = supportsSearch ? category : '';

  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  useEffect(() => {
    void api.discoverCategories().then(setCategories).catch(() => undefined);
    void api.discoverSources().then(setInfos).catch(() => undefined);
  }, []);

  // Debounce the top-bar search so typing does not hammer the providers.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  const loadPage = useCallback(
    async (pageNumber: number) => {
      const token = ++requestRef.current;
      try {
        const result = await api.discoverSearch({
          query: effectiveQuery,
          source,
          category: effectiveCategory,
          page: pageNumber,
          options: { sort: supportsSort ? sort : 'relevance', dark: supportsDark && dark },
        });
        if (token !== requestRef.current) return;
        setItems((prev) => {
          if (pageNumber === 1) return result.items;
          // Some feeds (Bing markets) repeat pictures across pages.
          const seen = new Set(prev.map((i) => i.id));
          return [...prev, ...result.items.filter((i) => !seen.has(i.id))];
        });
        setPage(result.page);
        setHasMore(result.has_more);
        setError(null);
      } catch (e) {
        if (token !== requestRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setHasMore(false);
      }
    },
    [effectiveQuery, effectiveCategory, source, sort, dark, supportsSort, supportsDark],
  );

  useEffect(() => {
    setItems([]);
    setPage(0);
    setHasMore(true);
    setError(null);
    // No point asking a provider that will refuse us for want of a key.
    if (needsKey) {
      requestRef.current += 1;
      setLoading(false);
      return;
    }
    setLoading(true);
    void loadPage(1).finally(() => setLoading(false));
  }, [loadPage, needsKey]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading || !hasMore || error || needsKey) return;
    setLoadingMore(true);
    await loadPage(page + 1);
    setLoadingMore(false);
  }, [loadingMore, loading, hasMore, error, needsKey, page, loadPage]);

  // Infinite scroll via a sentinel at the end of the grid. The scroll
  // container (not the viewport) is the observer root, since <body> never
  // scrolls.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || error) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { root: mainScrollElement(), rootMargin: '480px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, error, loadMore]);

  const chooseGroup = (next: SourceGroup) => {
    if (next === group) return;
    const first = sourcesIn(next)[0];
    if (first) setSource(first.id);
  };

  const keyProblem = needsKey || (!!error && /api key/i.test(error));
  const activeCategory = category;

  return (
    <section aria-label="Discover">
      <header className="page-head">
        <div>
          <h1>Discover</h1>
          <p className="sub">{meta?.blurb}</p>
        </div>
        <span className="muted small mono">{items.length > 0 ? `${items.length} loaded` : ''}</span>
      </header>

      <div className="filter-row">
        <div className="segmented" role="tablist" aria-label="Wallpaper type">
          {GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={group === g.id}
              className={group === g.id ? 'active' : undefined}
              onClick={() => chooseGroup(g.id)}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="source-pills" role="tablist" aria-label="Source">
          {sourcesIn(group).map((s) => {
            const sInfo = infos.find((i) => i.id === s.id);
            const locked = !!sInfo && sInfo.key_required && !sInfo.has_key;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={source === s.id}
                className={source === s.id ? 'source-pill active' : 'source-pill'}
                onClick={() => setSource(s.id)}
                title={locked ? `${s.label} needs a free API key` : s.blurb}
              >
                {s.label}
                {locked && <KeyRound size={12} aria-label="Needs an API key" />}
              </button>
            );
          })}
        </div>
        <span className="spacer" />
        {supportsSort && (
          <label className="select-wrap">
            <span className="sr-only">Sort by</span>
            <select
              className="select"
              value={sort}
              onChange={(e) => setSort(e.target.value as DiscoverSort)}
            >
              {SORT_ORDER.map((s) => (
                <option key={s} value={s}>
                  {SORT_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        )}
        {supportsDark && (
          <button
            type="button"
            className={dark ? 'toggle-chip active' : 'toggle-chip'}
            aria-pressed={dark}
            onClick={() => setDark((v) => !v)}
            title="Prefer dark images, ideal for OLED screens"
          >
            <Moon size={13} aria-hidden="true" />
            Dark
          </button>
        )}
      </div>

      {supportsSearch ? (
        <div className="chips chips-row">
          <button
            type="button"
            className={activeCategory === '' ? 'chip active' : 'chip'}
            onClick={() => onCategory('')}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className={activeCategory === c ? 'chip active' : 'chip'}
              onClick={() => onCategory(c === activeCategory ? '' : c)}
            >
              {c}
            </button>
          ))}
        </div>
      ) : (
        <p className="inline-note">
          <AlertCircle size={14} aria-hidden="true" />
          <span>{meta?.label} is a curated feed, so search and categories don’t apply here.</span>
        </p>
      )}

      {meta && (
        <p className="credit">
          {meta.credit}{' '}
          <button
            type="button"
            className="link-btn"
            onClick={() => void api.openExternal(meta.creditUrl).catch(() => undefined)}
          >
            Visit {sourceLabel(source)} <ExternalLink size={11} aria-hidden="true" />
          </button>
        </p>
      )}

      {keyProblem ? (
        <KeySetup
          provider={info?.provider ?? meta?.label ?? 'this source'}
          rejected={!needsKey}
          keyUrl={meta?.keyUrl}
          onOpenSettings={onOpenSettings}
        />
      ) : loading ? (
        <DiscoverSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon={error ? <AlertCircle size={22} /> : <SearchIcon size={22} />}
          title={error ? 'Something went wrong' : 'Nothing found'}
          body={
            error
              ? error
              : `No results for “${effectiveQuery || activeCategory}”. Try another category or clear the search.`
          }
        />
      ) : (
        <>
          <ul className="grid">
            {items.map((item) => (
              <DiscoverTile
                key={item.id}
                item={item}
                entry={byId.get(item.id)}
                onOpen={() => setSelected(item)}
                onAdd={() => start(item)}
              />
            ))}
          </ul>

          <div ref={sentinelRef} className="sentinel" aria-hidden="true" />

          <div className="row" style={{ justifyContent: 'center', marginTop: 'var(--space-4)' }}>
            {loadingMore ? (
              <span className="row muted small" style={{ gap: 8 }}>
                <Loader2 size={14} className="spin" aria-hidden="true" />
                Loading more…
              </span>
            ) : hasMore ? (
              <button type="button" className="btn" onClick={() => void loadMore()}>
                Load more
              </button>
            ) : (
              <span className="muted small">That’s everything.</span>
            )}
          </div>
        </>
      )}

      {selected && (
        <DetailDrawer
          item={selected}
          entry={byId.get(selected.id)}
          onClose={() => setSelected(null)}
          onAdd={(rendition) => start(selected, rendition)}
          onCancel={() => cancel(selected.id)}
        />
      )}
    </section>
  );
}

/* --------------------------------------------------------------- key setup */

function KeySetup({
  provider,
  rejected,
  keyUrl,
  onOpenSettings,
}: {
  provider: string;
  rejected: boolean;
  keyUrl?: string;
  onOpenSettings: () => void;
}) {
  return (
    <div className="setup-card">
      <div className="setup-icon" aria-hidden="true">
        <KeyRound size={20} />
      </div>
      <h2>{rejected ? `${provider} didn’t accept that key` : `Add your free ${provider} key`}</h2>
      <p>
        {rejected
          ? 'Check it in Settings and try again.'
          : `${provider} needs a key of your own. It’s free, takes about a minute, and stays on this Mac.`}
      </p>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn primary" onClick={onOpenSettings}>
          Open Settings
        </button>
        {keyUrl && (
          <button
            type="button"
            className="btn"
            onClick={() => void api.openExternal(keyUrl).catch(() => undefined)}
          >
            Get a free key
            <ExternalLink size={13} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- tile */

function DiscoverTile({
  item,
  entry,
  onOpen,
  onAdd,
}: {
  item: DiscoverItem;
  entry?: DownloadEntry;
  onOpen: () => void;
  onAdd: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const resolution = item.width && item.height ? `${item.width}×${item.height}` : '';
  const busy = !!entry && isActive(entry);
  const added = entry?.phase === 'done';
  // Hover previews use the small clip only; loading the full file here is what
  // made browsing slow.
  const previewing = hovered && item.kind === 'video' && !!item.preview_url;

  return (
    <li
      className="tile"
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="tile-thumb">
        <span className="badge">
          {item.kind === 'video' ? <Video size={12} /> : <ImageDown size={12} />}
          {item.kind === 'video' && item.duration ? <span>{Math.round(item.duration)}s</span> : null}
        </span>
        {previewing ? (
          <video src={item.preview_url ?? undefined} muted loop autoPlay playsInline />
        ) : !thumbFailed ? (
          <img
            src={item.thumb_url}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setThumbFailed(true)}
          />
        ) : (
          <div className="tile-fallback" aria-hidden="true">
            {item.kind === 'video' ? <Video size={22} /> : <SearchIcon size={22} />}
          </div>
        )}
        <div className="tile-overlay">
          <span className="tile-sub">{resolution}</span>
          <div className="tile-actions">
            <button
              type="button"
              aria-label={
                added ? 'Added to library' : busy ? 'Adding…' : `Add ${item.title} to library`
              }
              disabled={busy || added}
              onClick={(e) => {
                e.stopPropagation();
                onAdd();
              }}
            >
              {busy ? (
                <Loader2 size={14} className="spin" />
              ) : added ? (
                <Check size={14} color="var(--secondary)" />
              ) : (
                <Download size={14} />
              )}
            </button>
          </div>
        </div>
        {entry && (busy || entry.phase === 'error') && (
          <div className="tile-progress">
            <ProgressBar entry={entry} />
          </div>
        )}
      </div>
      <div className="tile-meta">
        <span className="tile-title" title={item.title}>
          {item.title}
        </span>
        <span className="tile-sub">
          {entry && busy ? describeProgress(entry) : (
            <>
              {sourceLabel(item.source)}
              {item.author ? ` · ${item.author}` : ''}
            </>
          )}
        </span>
      </div>
    </li>
  );
}

/* ----------------------------------------------------------------- drawer */

function DetailDrawer({
  item,
  entry,
  onClose,
  onAdd,
  onCancel,
}: {
  item: DiscoverItem;
  entry?: DownloadEntry;
  onClose: () => void;
  onAdd: (rendition: Rendition | null) => void;
  onCancel: () => void;
}) {
  const renditions = item.renditions ?? [];
  const [renditionKey, setRenditionKey] = useState(() => pickRendition(item)?.key ?? '');
  const chosen = pickRendition(item, renditionKey);
  const busy = !!entry && isActive(entry);
  const added = entry?.phase === 'done';
  const cancellable = entry?.phase === 'queued' || entry?.phase === 'downloading';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const resolution = chosen?.width && chosen.height
    ? `${chosen.width}×${chosen.height}`
    : item.width && item.height
      ? `${item.width}×${item.height}`
      : 'Unknown';

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={`${item.title} details`}>
        <div className="drawer-head">
          <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.title}
          </strong>
          <button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="drawer-body">
          <div className="drawer-media">
            {item.kind === 'video' && item.preview_url ? (
              <video
                src={item.preview_url}
                poster={item.thumb_url}
                muted
                loop
                autoPlay
                playsInline
              />
            ) : (
              <img src={item.thumb_url} alt={item.title} />
            )}
          </div>

          {renditions.length > 1 && (
            <fieldset className="quality" disabled={busy || added}>
              <legend>Quality</legend>
              <div className="quality-list">
                {renditions.map((r) => (
                  <label
                    key={r.key}
                    className={r.key === chosen?.key ? 'quality-opt active' : 'quality-opt'}
                  >
                    <input
                      type="radio"
                      name="quality"
                      value={r.key}
                      checked={r.key === chosen?.key}
                      onChange={() => setRenditionKey(r.key)}
                    />
                    <span className="quality-label">{r.label}</span>
                    <span className="quality-sub mono">
                      {r.width && r.height ? `${r.width}×${r.height}` : r.key === 'preview' ? 'lighter file' : ''}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <dl className="meta-grid">
            <dt>Source</dt>
            <dd>{sourceLabel(item.source)}</dd>
            <dt>Type</dt>
            <dd>{item.kind === 'video' ? 'Video loop' : 'Photo'}</dd>
            <dt>Resolution</dt>
            <dd>{resolution}</dd>
            {item.kind === 'video' && (
              <>
                <dt>Duration</dt>
                <dd>{item.duration ? `${Math.round(item.duration)}s` : '—'}</dd>
              </>
            )}
            {item.author && (
              <>
                <dt>Credit</dt>
                <dd>{item.author}</dd>
              </>
            )}
          </dl>

          {entry && (busy || entry.phase === 'error') && (
            <div className="drawer-progress">
              <ProgressBar entry={entry} />
              <div className={entry.phase === 'error' ? 'dl-status error' : 'dl-status'}>
                <span>{describeProgress(entry)}</span>
                {cancellable && (
                  <button type="button" className="link-btn" onClick={onCancel}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}

          {item.source_url?.startsWith('https://') && (
            <p className="attribution">
              <button
                type="button"
                className="link-btn"
                onClick={() => void api.openExternal(item.source_url ?? '').catch(() => undefined)}
              >
                View original page <ExternalLink size={11} aria-hidden="true" />
              </button>
            </p>
          )}
        </div>
        <div className="drawer-foot">
          <button
            type="button"
            className="btn primary"
            onClick={() => onAdd(chosen)}
            disabled={busy || added}
          >
            {busy ? (
              <Loader2 size={15} className="spin" aria-hidden="true" />
            ) : added ? (
              <Check size={15} aria-hidden="true" />
            ) : (
              <Download size={15} aria-hidden="true" />
            )}
            <span>{added ? 'Added' : busy ? 'Adding…' : entry?.phase === 'error' ? 'Try again' : 'Add to library'}</span>
          </button>
          <button type="button" className="btn" disabled title="Arrives with the wallpaper engine">
            <MonitorPlay size={15} aria-hidden="true" />
            <span>Add and set</span>
          </button>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </aside>
    </>
  );
}

/* --------------------------------------------------------------- skeleton */

function DiscoverSkeleton() {
  return (
    <ul className="grid" aria-busy="true" aria-label="Loading results">
      {Array.from({ length: 12 }, (_, i) => (
        <li key={i} className="tile" style={{ pointerEvents: 'none' }}>
          <div className="tile-thumb">
            <Skeleton height="100%" width="100%" radius={0} />
          </div>
          <div className="tile-meta">
            <Skeleton height={13} width="70%" />
            <Skeleton height={11} width="40%" />
          </div>
        </li>
      ))}
    </ul>
  );
}
