import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Download,
  ImageDown,
  Loader2,
  MonitorPlay,
  Search as SearchIcon,
  Video,
  X,
} from 'lucide-react';
import EmptyState from './EmptyState.tsx';
import Skeleton from './Skeleton.tsx';
import { useToast } from './Toast.tsx';
import * as api from '../lib/api.ts';
import { importDownloaded } from '../lib/importer.ts';
import { mainScrollElement } from '../lib/dom.ts';
import type { DiscoverItem, DiscoverSource } from '../lib/domain.ts';

const SOURCES: { value: DiscoverSource; label: string; kind: string }[] = [
  { value: 'wallhaven', label: 'Images', kind: 'Wallhaven' },
  { value: 'pixabay', label: 'Videos', kind: 'Pixabay' },
];

interface Props {
  query: string;
  category: string;
  onCategory: (category: string) => void;
}

export default function Discover({ query, category, onCategory }: Props) {
  const { toast } = useToast();
  const [source, setSource] = useState<DiscoverSource>('wallhaven');
  const [categories, setCategories] = useState<string[]>([]);
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [items, setItems] = useState<DiscoverItem[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DiscoverItem | null>(null);
  const [adding, setAdding] = useState<ReadonlySet<string>>(new Set());
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const requestRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api
      .discoverCategories()
      .then(setCategories)
      .catch(() => undefined);
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
          query: debouncedQuery,
          source,
          category,
          page: pageNumber,
        });
        if (token !== requestRef.current) return;
        setItems((prev) => (pageNumber === 1 ? result.items : [...prev, ...result.items]));
        setPage(result.page);
        setHasMore(result.has_more);
        setError(null);
      } catch (e) {
        if (token !== requestRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setHasMore(false);
      }
    },
    [debouncedQuery, source, category],
  );

  useEffect(() => {
    setItems([]);
    setPage(0);
    setHasMore(true);
    setError(null);
    setLoading(true);
    void loadPage(1).finally(() => setLoading(false));
  }, [loadPage]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading || !hasMore || error) return;
    setLoadingMore(true);
    await loadPage(page + 1);
    setLoadingMore(false);
  }, [loadingMore, loading, hasMore, error, page, loadPage]);

  // Infinite scroll via a sentinel at the end of the grid. The scroll
  // container (not the viewport) is the observer root, since <body> never
  // scrolls — without this the sentinel would never re-trigger.
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

  const add = useCallback(
    async (item: DiscoverItem) => {
      setAdding((prev) => new Set(prev).add(item.id));
      try {
        const downloaded = await api.discoverDownload({ item });
        const record = await importDownloaded(downloaded);
        if (!record) {
          toast('That file could not be decoded and was skipped.', 'error');
        } else {
          toast(`Added “${record.title}” to your library.`);
          setAdded((prev) => new Set(prev).add(item.id));
        }
      } catch (e) {
        toast(`Could not add: ${e instanceof Error ? e.message : String(e)}`, 'error');
      } finally {
        setAdding((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      }
    },
    [toast],
  );

  const missingKey = useMemo(
    () => source === 'pixabay' && !!error && /pixabay api key/i.test(error),
    [source, error],
  );

  const activeCategory = category;

  return (
    <section aria-label="Discover">
      <header className="page-head">
        <div>
          <h1>Discover</h1>
          <p className="sub">
            {source === 'wallhaven'
              ? 'Safe-for-work photos from Wallhaven.'
              : 'Looping clips from Pixabay, with your own key.'}
          </p>
        </div>
      </header>

      <div className="row" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="segmented" role="tablist" aria-label="Source">
          {SOURCES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="tab"
              aria-selected={source === s.value}
              className={source === s.value ? 'active' : undefined}
              onClick={() => setSource(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <span className="muted small mono">{items.length} loaded</span>
      </div>

      <div className="chips" style={{ marginBottom: 'var(--space-5)' }}>
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

      {missingKey ? (
        <div className="inline-note">
          <AlertCircle size={15} aria-hidden="true" />
          <span>
            Add a Pixabay API key in <strong>Settings → Sources</strong> to browse
            videos.
          </span>
        </div>
      ) : loading ? (
        <DiscoverSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon={error ? <AlertCircle size={22} /> : <SearchIcon size={22} />}
          title={error ? 'Something went wrong' : 'Nothing found'}
          body={
            error
              ? error
              : `No results for “${debouncedQuery || activeCategory}”. Try another category or clear the search.`
          }
        />
      ) : (
        <>
          <ul className="grid">
            {items.map((item) => (
              <DiscoverTile
                key={item.id}
                item={item}
                adding={adding.has(item.id)}
                added={added.has(item.id)}
                onOpen={() => setSelected(item)}
                onAdd={() => void add(item)}
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
          adding={adding.has(selected.id)}
          added={added.has(selected.id)}
          onClose={() => setSelected(null)}
          onAdd={() => void add(selected)}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------- tile */

function DiscoverTile({
  item,
  adding,
  added,
  onOpen,
  onAdd,
}: {
  item: DiscoverItem;
  adding: boolean;
  added: boolean;
  onOpen: () => void;
  onAdd: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const resolution =
    item.width && item.height ? `${item.width}×${item.height}` : '—';

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
          {item.kind === 'video' && item.duration ? (
            <span>{Math.round(item.duration)}s</span>
          ) : null}
        </span>
        {hovered && item.kind === 'video' ? (
          <video src={item.full_url} muted loop autoPlay playsInline />
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
              aria-label={added ? 'Added to library' : `Add ${item.title} to library`}
              disabled={adding}
              onClick={(e) => {
                e.stopPropagation();
                onAdd();
              }}
            >
              {adding ? (
                <Loader2 size={14} className="spin" />
              ) : added ? (
                <Check size={14} color="var(--secondary)" />
              ) : (
                <Download size={14} />
              )}
            </button>
          </div>
        </div>
      </div>
      <div className="tile-meta">
        <span className="tile-title" title={item.title}>
          {item.title}
        </span>
        <span className="tile-sub">
          {SOURCES.find((s) => s.value === item.source)?.kind ?? item.source}
          {item.author ? ` · ${item.author}` : ''}
        </span>
      </div>
    </li>
  );
}

/* ----------------------------------------------------------------- drawer */

function DetailDrawer({
  item,
  adding,
  added,
  onClose,
  onAdd,
}: {
  item: DiscoverItem;
  adding: boolean;
  added: boolean;
  onClose: () => void;
  onAdd: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
            {item.kind === 'video' ? (
              <video src={item.full_url} muted loop autoPlay playsInline controls />
            ) : (
              <img src={item.thumb_url} alt={item.title} />
            )}
          </div>

          <dl className="meta-grid">
            <dt>Source</dt>
            <dd>{item.source === 'wallhaven' ? 'Wallhaven' : 'Pixabay'}</dd>
            <dt>Type</dt>
            <dd>{item.kind === 'video' ? 'Video' : 'Photo'}</dd>
            <dt>Resolution</dt>
            <dd>
              {item.width && item.height ? `${item.width}×${item.height}` : 'Unknown'}
            </dd>
            {item.kind === 'video' && (
              <>
                <dt>Duration</dt>
                <dd>{item.duration ? `${Math.round(item.duration)}s` : '—'}</dd>
              </>
            )}
            {item.author && (
              <>
                <dt>Author</dt>
                <dd>{item.author}</dd>
              </>
            )}
          </dl>

          {item.source_url && (
            <p className="attribution">
              Original: <span className="mono">{item.source_url}</span>
            </p>
          )}
        </div>
        <div className="drawer-foot">
          <button
            type="button"
            className="btn primary"
            onClick={onAdd}
            disabled={adding || added}
          >
            {adding ? (
              <Loader2 size={15} className="spin" aria-hidden="true" />
            ) : added ? (
              <Check size={15} aria-hidden="true" />
            ) : (
              <Download size={15} aria-hidden="true" />
            )}
            <span>{added ? 'Added' : adding ? 'Adding…' : 'Add to library'}</span>
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
