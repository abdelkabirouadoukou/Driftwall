import { useCallback, useEffect, useState } from 'react';
import { Image as ImageIcon, Plus, Video } from 'lucide-react';
import EmptyState from './EmptyState.tsx';
import Skeleton from './Skeleton.tsx';
import { useToast } from './Toast.tsx';
import * as api from '../lib/api.ts';
import { assetUrl, resolveThumbUrls } from '../lib/paths.ts';
import { importWallpapers } from '../lib/importer.ts';
import type { WallpaperRecord } from '../lib/domain.ts';

export default function Library({ query }: { query: string }) {
  const { toast } = useToast();
  const [items, setItems] = useState<WallpaperRecord[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const rows = await api.libraryList();
    setItems(rows);
    setThumbs(await resolveThumbUrls(rows.map((r) => r.id)));
  }, []);

  useEffect(() => {
    void refresh()
      .catch(() => toast('Could not load library', 'error'))
      .finally(() => setLoading(false));
  }, [refresh, toast]);

  const handleImport = async () => {
    setBusy(true);
    try {
      const summary = await importWallpapers();
      if (summary.imported > 0) toast(`Imported ${summary.imported} wallpaper(s).`);
      if (summary.rejected.length > 0) {
        toast(`${summary.rejected.length} file(s) skipped.`, 'error');
      }
      await refresh();
    } catch (error) {
      toast(`Import failed: ${String(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const q = query.trim().toLowerCase();
  const visible = q
    ? items.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.tags.some((t) => t.toLowerCase().includes(q)),
      )
    : items;

  return (
    <section aria-label="Library">
      <header className="page-head">
        <div>
          <h1>Library</h1>
          <p className="sub">
            {items.length} wallpaper{items.length === 1 ? '' : 's'}
          </p>
        </div>
        <button type="button" className="btn primary" onClick={handleImport} disabled={busy}>
          <Plus size={16} aria-hidden="true" />
          <span>{busy ? 'Importing…' : 'Import'}</span>
        </button>
      </header>

      {loading ? (
        <SkeletonGrid />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<ImageIcon size={22} />}
          title={q ? 'No matches' : 'No wallpapers yet'}
          body={
            q
              ? `Nothing in your library matches “${query.trim()}”.`
              : 'Import a photo or an H.264/HEVC video to get started. Files are copied into Driftwall’s library, thumbnails are generated automatically.'
          }
          actionLabel={q ? undefined : 'Import wallpapers'}
          onAction={q ? undefined : handleImport}
        />
      ) : (
        <ul className="grid">
          {visible.map((item) => {
            const thumb = thumbs[item.id];
            const src =
              thumb ?? (item.type === 'video' ? assetUrl(item.file_path) : undefined);
            return (
              <li key={item.id} className="tile">
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
                    {item.type === 'video' && item.duration
                      ? ` · ${Math.round(item.duration)}s`
                      : ''}
                  </span>
                  {item.tags.length > 0 && (
                    <span className="tags">
                      {item.tags.map((tag) => (
                        <span key={tag} className="tag">
                          {tag}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function SkeletonGrid() {
  return (
    <ul className="grid" aria-busy="true" aria-label="Loading wallpapers">
      {Array.from({ length: 8 }, (_, i) => (
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
