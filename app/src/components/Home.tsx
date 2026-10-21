import { useEffect, useState } from 'react';
import { Image as ImageIcon, MonitorPlay, Plus, Sparkles, Video } from 'lucide-react';
import EmptyState from './EmptyState.tsx';
import Skeleton from './Skeleton.tsx';
import { useToast } from './Toast.tsx';
import * as api from '../lib/api.ts';
import { assetUrl, resolveThumbUrls } from '../lib/paths.ts';
import { LIBRARY_CHANGED_EVENT, WALLPAPER_CHANGED_EVENT } from '../lib/dom.ts';
import { importWallpapers } from '../lib/importer.ts';
import { sceneById, sceneIdFromCurrent } from '../lib/scenes.ts';
import type { EngineStatus, WallpaperRecord } from '../lib/domain.ts';
import type { View } from './Sidebar.tsx';

/** Category chips shown as shortcuts; A3 wires these to the Discover source. */
const CATEGORIES = [
  'Gaming',
  'Anime',
  'Cyberpunk',
  'Space',
  'Nature',
  'Minimal',
  'OLED black',
  'Abstract',
];

interface Props {
  query: string;
  onNavigate: (view: View) => void;
  onBrowseCategory: (category: string) => void;
}

export default function Home({ query, onNavigate, onBrowseCategory }: Props) {
  const { toast } = useToast();
  const [items, setItems] = useState<WallpaperRecord[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<EngineStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await api.libraryList();
        if (cancelled) return;
        setItems(rows);
        setThumbs(await resolveThumbUrls(rows.map((r) => r.id)));
      } catch {
        if (!cancelled) toast('Could not load library', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  // A Discover download can finish while this view is open.
  useEffect(() => {
    const onChanged = () => {
      void (async () => {
        try {
          const rows = await api.libraryList();
          setItems(rows);
          setThumbs(await resolveThumbUrls(rows.map((r) => r.id)));
        } catch {
          /* keep the current list */
        }
      })();
    };
    window.addEventListener(LIBRARY_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(LIBRARY_CHANGED_EVENT, onChanged);
  }, []);

  // "Now playing" follows the engine; refresh whenever the wallpaper changes.
  useEffect(() => {
    const load = () => void api.engineStatus().then(setStatus).catch(() => setStatus(null));
    load();
    window.addEventListener(WALLPAPER_CHANGED_EVENT, load);
    return () => window.removeEventListener(WALLPAPER_CHANGED_EVENT, load);
  }, []);

  const handleImport = async () => {
    setBusy(true);
    try {
      const summary = await importWallpapers();
      if (summary.imported > 0) toast(`Imported ${summary.imported} wallpaper(s).`);
      if (summary.rejected.length > 0) {
        toast(`${summary.rejected.length} file(s) skipped.`, 'error');
      }
      const rows = await api.libraryList();
      setItems(rows);
      setThumbs(await resolveThumbUrls(rows.map((r) => r.id)));
    } catch (error) {
      toast(`Import failed: ${String(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const nowPlaying = status?.current_id ? items.find((i) => i.id === status.current_id) : undefined;
  const nowThumb = nowPlaying ? thumbs[nowPlaying.id] : undefined;
  const scene = sceneById(sceneIdFromCurrent(status?.current_id));
  const hasCurrent = !!nowPlaying || !!scene;

  const q = query.trim().toLowerCase();
  const recent = (q
    ? items.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.tags.some((t) => t.toLowerCase().includes(q)),
      )
    : items
  )
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 8);

  return (
    <section aria-label="Home">
      <header className="page-head">
        <div>
          <h1>Home</h1>
          <p className="sub">Your desktop, alive.</p>
        </div>
        <button type="button" className="btn primary" onClick={handleImport} disabled={busy}>
          <Plus size={16} aria-hidden="true" />
          <span>{busy ? 'Importing…' : 'Import'}</span>
        </button>
      </header>

      <div className="now-playing">
        <div className="now-playing-thumb" aria-hidden="true">
          {nowThumb ? <img src={nowThumb} alt="" /> : <MonitorPlay size={26} />}
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
            {nowPlaying?.title ?? scene?.name ?? 'Nothing playing yet'}
          </h2>
          {hasCurrent ? (
            <div className="row" style={{ gap: 8 }}>
              {status?.paused_reason ? (
                <span className="paused-pill">Paused · {status.paused_reason}</span>
              ) : (
                <span className="current-pill">
                  {scene ? 'Animated scene' : nowPlaying?.type === 'video' ? 'Playing live' : 'Current wallpaper'}
                </span>
              )}
            </div>
          ) : (
            <p className="muted" style={{ margin: 0, maxWidth: 460 }}>
              Import a wallpaper or pick one from Discover, then choose “Set as
              wallpaper” in your library.
            </p>
          )}
          <div className="row" style={{ marginTop: 6 }}>
            <button
              type="button"
              className="btn"
              onClick={() => onNavigate('discover')}
            >
              <Sparkles size={15} aria-hidden="true" />
              <span>Browse Discover</span>
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => onNavigate('library')}
            >
              Open library
            </button>
          </div>
        </div>
      </div>

      <div className="section-title">
        <h2>Recently added</h2>
        {items.length > 0 && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => onNavigate('library')}
          >
            See all
          </button>
        )}
      </div>

      {loading ? (
        <ul className="grid" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
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
      ) : recent.length === 0 ? (
        <EmptyState
          icon={<ImageIcon size={22} />}
          title={q ? 'No matches' : 'No wallpapers yet'}
          body={
            q
              ? `Nothing in your library matches “${query.trim()}”.`
              : 'Import a photo or an H.264/HEVC video to get started. Files are copied into Driftwall’s library and thumbnails are generated automatically.'
          }
          actionLabel={q ? undefined : 'Import wallpapers'}
          onAction={q ? undefined : handleImport}
        />
      ) : (
        <ul className="grid">
          {recent.map((item) => {
            const thumb = thumbs[item.id];
            const src = thumb ?? (item.type === 'video' ? assetUrl(item.file_path) : undefined);
            return (
              <li
                key={item.id}
                className="tile"
                onClick={() => onNavigate('library')}
              >
                <div className="tile-thumb">
                  <span className="badge">
                    {item.type === 'video' ? <Video size={12} /> : <ImageIcon size={12} />}
                  </span>
                  {src ? (
                    <img src={src} alt="" loading="lazy" />
                  ) : (
                    <div className="tile-fallback" aria-hidden="true" />
                  )}
                </div>
                <div className="tile-meta">
                  <span className="tile-title" title={item.title}>
                    {item.title}
                  </span>
                  <span className="tile-sub">
                    {item.width && item.height ? `${item.width}×${item.height}` : '—'}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="section-title">
        <h2>Browse by category</h2>
      </div>
      <div className="chips">
        {CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            className="chip"
            onClick={() => onBrowseCategory(category)}
          >
            {category}
          </button>
        ))}
      </div>
    </section>
  );
}
