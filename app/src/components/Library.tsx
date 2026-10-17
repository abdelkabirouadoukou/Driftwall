import { useCallback, useEffect, useState } from 'react';
import { Image as ImageIcon, Pencil, Plus, Trash2, Video } from 'lucide-react';
import EmptyState from './EmptyState.tsx';
import * as api from '../lib/api.ts';
import { resolveThumbUrls } from '../lib/paths.ts';
import { importWallpapers } from '../lib/importer.ts';
import type { WallpaperRecord } from '../lib/domain.ts';

export default function Library() {
  const [items, setItems] = useState<WallpaperRecord[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const rows = await api.libraryList();
    setItems(rows);
    setThumbs(await resolveThumbUrls(rows.map((r) => r.id)));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleImport = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const summary = await importWallpapers();
      if (summary.rejected.length > 0) {
        setNotice(
          `${summary.imported} imported, ${summary.rejected.length} skipped.\n` +
            summary.rejected.map((r) => `• ${r.reason}`).join('\n'),
        );
      } else if (summary.imported > 0) {
        setNotice(`${summary.imported} imported.`);
      }
      await refresh();
    } catch (error) {
      setNotice(`Import failed: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async (item: WallpaperRecord) => {
    const next = window.prompt('Rename wallpaper', item.title);
    if (next == null) return;
    const clean = next.trim();
    if (!clean) return;
    await api.libraryRename(item.id, clean);
    await refresh();
  };

  const handleDelete = async (item: WallpaperRecord) => {
    if (!window.confirm(`Delete “${item.title}”? This removes the copied file.`)) return;
    await api.libraryDelete(item.id);
    await refresh();
  };

  return (
    <section className="library">
      <header className="page-head">
        <div>
          <h1>Library</h1>
          <p className="muted small">
            {items.length} wallpaper{items.length === 1 ? '' : 's'}
          </p>
        </div>
        <button type="button" className="btn primary" onClick={handleImport} disabled={busy}>
          {busy ? <Video size={16} /> : <Plus size={16} />}
          <span>{busy ? 'Importing…' : 'Import'}</span>
        </button>
      </header>

      {notice && <pre className="notice">{notice}</pre>}

      {items.length === 0 ? (
        <EmptyState
          title="No wallpapers yet"
          body="Import a photo or an H.264/HEVC video to get started. Files are copied into Driftwall’s library, thumbnails are generated automatically."
          actionLabel="Import wallpapers"
          onAction={handleImport}
        />
      ) : (
        <ul className="grid">
          {items.map((item) => (
            <li key={item.id} className="card">
              <div className="thumb">
                <span className="badge">
                  {item.type === 'video' ? <Video size={14} /> : <ImageIcon size={14} />}
                </span>
                {thumbs[item.id] ? (
                  <img src={thumbs[item.id]} alt="" />
                ) : (
                  <div className="thumb-fallback" />
                )}
              </div>
              <div className="card-body">
                <span className="card-title" title={item.title}>
                  {item.title}
                </span>
                <span className="muted small">
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
              <div className="card-actions">
                <button type="button" aria-label="Rename" onClick={() => handleRename(item)}>
                  <Pencil size={14} />
                </button>
                <button type="button" aria-label="Delete" onClick={() => handleDelete(item)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
