import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import {
  CheckSquare,
  FolderOpen,
  Image as ImageIcon,
  LayoutGrid,
  MonitorPlay,
  Pencil,
  Plus,
  RefreshCw,
  Repeat,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import ContextMenu, { type MenuItem } from './ContextMenu.tsx';
import EmptyState from './EmptyState.tsx';
import Skeleton from './Skeleton.tsx';
import PreviewVideo from './PreviewVideo.tsx';
import { useToast } from './Toast.tsx';
import * as api from '../lib/api.ts';
import { isTauri } from '../lib/api.ts';
import { assetUrl, resolveThumbUrls } from '../lib/paths.ts';
import {
  LIBRARY_CHANGED_EVENT,
  WALLPAPER_CHANGED_EVENT,
  notifyWallpaperChanged,
} from '../lib/dom.ts';
import { importPaths, importWallpapers } from '../lib/importer.ts';
import { regenerateThumbnail, repairVideoThumbnails } from '../lib/thumbnails.ts';
import type { WallpaperRecord } from '../lib/domain.ts';

type Filter = 'all' | 'static' | 'video';
type SortKey = 'newest' | 'oldest' | 'name-asc' | 'name-desc';

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' },
];

interface MenuState {
  x: number;
  y: number;
  item: WallpaperRecord;
}

export default function Library({ query }: { query: string }) {
  const { toast } = useToast();
  const [items, setItems] = useState<WallpaperRecord[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<SortKey>('newest');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const anchorRef = useRef<string | null>(null);
  // One-time sweep so clips imported before the black-frame fix get repaired.
  const repairedRef = useRef(false);

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

  // A Discover download can finish while this view is open.
  useEffect(() => {
    const onChanged = () => void refresh().catch(() => undefined);
    window.addEventListener(LIBRARY_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(LIBRARY_CHANGED_EVENT, onChanged);
  }, [refresh]);

  // Which wallpaper is applied right now (for the "current" tile outline).
  const refreshStatus = useCallback(async () => {
    try {
      const status = await api.engineStatus();
      setCurrentId(status.current_id);
    } catch {
      setCurrentId(null);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const onChanged = () => void refreshStatus();
    window.addEventListener(WALLPAPER_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(WALLPAPER_CHANGED_EVENT, onChanged);
  }, [refreshStatus]);

  useEffect(() => {
    if (repairedRef.current || loading || !isTauri()) return;
    repairedRef.current = true;
    const videos = items.filter((i) => i.type === 'video');
    if (videos.length === 0) return;
    let cancelled = false;
    void (async () => {
      const fixed = await repairVideoThumbnails(videos);
      if (cancelled || fixed === 0) return;
      await refresh();
      toast(`Regenerated ${fixed} video thumbnail${fixed === 1 ? '' : 's'}.`);
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, items, refresh, toast]);

  const importBatch = useCallback(
    async (paths: readonly string[]) => {
      setBusy(true);
      try {
        const summary = await importPaths(paths);
        if (summary.imported > 0) {
          toast(`Imported ${summary.imported} wallpaper(s).`);
        }
        if (summary.rejected.length > 0) {
          toast(`${summary.rejected.length} file(s) skipped: ${summary.rejected[0].reason}`, 'error');
        }
        await refresh();
      } catch (error) {
        toast(`Import failed: ${String(error)}`, 'error');
      } finally {
        setBusy(false);
      }
    },
    [refresh, toast],
  );

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

  /* ------------------------------------------------------------ selection */

  const handleTileClick = (e: React.MouseEvent, id: string) => {
    if (renaming) commitRename();
    const ids = visible.map((v) => v.id);
    const anchor = anchorRef.current;

    if (e.shiftKey && anchor) {
      const from = ids.indexOf(anchor);
      const to = ids.indexOf(id);
      if (from !== -1 && to !== -1) {
        const [start, end] = from < to ? [from, to] : [to, from];
        setSelected(new Set(ids.slice(start, end + 1)));
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      anchorRef.current = id;
      return;
    }
    setSelected(new Set([id]));
    anchorRef.current = id;
  };

  const clearSelection = () => {
    setSelected(new Set());
    anchorRef.current = null;
  };

  /* -------------------------------------------------------------- actions */

  const deleteIds = async (ids: readonly string[]) => {
    for (const id of ids) await api.libraryDelete(id);
    clearSelection();
    await refresh();
  };

  const deleteSelected = async () => {
    const count = selected.size;
    if (count === 0) return;
    const label = count === 1 ? 'this wallpaper' : `these ${count} wallpapers`;
    if (!window.confirm(`Delete ${label}? This removes the copied files.`)) return;
    await deleteIds([...selected]);
    toast(`Deleted ${count} wallpaper${count === 1 ? '' : 's'}.`);
  };

  // Drag-and-drop import: the whole window is a drop target.
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        switch (event.payload.type) {
          case 'enter':
          case 'over':
            setDragging(true);
            break;
          case 'leave':
            setDragging(false);
            break;
          case 'drop':
            setDragging(false);
            void importBatch(event.payload.paths);
            break;
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [importBatch]);

  // Escape clears the selection; Delete removes the selected wallpapers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (menu || renaming) return;
      if (e.key === 'Escape' && selected.size > 0) {
        e.preventDefault();
        clearSelection();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size > 0) {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        void deleteSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, menu, renaming, deleteSelected]);

  const deleteOne = async (item: WallpaperRecord) => {
    if (!window.confirm(`Delete “${item.title}”? This removes the copied file.`)) return;
    await deleteIds([item.id]);
    toast('Deleted.');
  };

  const reveal = (item: WallpaperRecord) => {
    void api.revealInFinder(item.file_path).catch((error) => {
      toast(`Could not reveal file: ${String(error)}`, 'error');
    });
  };

  const regenerate = async (item: WallpaperRecord) => {
    toast('Regenerating thumbnail…');
    try {
      const ok = await regenerateThumbnail(item);
      if (!ok) {
        toast('Could not regenerate that thumbnail.', 'error');
        return;
      }
      await refresh();
      toast('Thumbnail regenerated.');
    } catch (error) {
      toast(`Could not regenerate thumbnail: ${String(error)}`, 'error');
    }
  };

  const setAsWallpaper = async (item: WallpaperRecord) => {
    try {
      await api.wallpaperApply(item.id);
      toast(`“${item.title}” is now your wallpaper.`);
      notifyWallpaperChanged();
    } catch (error) {
      toast(`Could not set wallpaper: ${String(error)}`, 'error');
    }
  };

  const startRotation = async (ids: readonly string[]) => {
    try {
      await api.playlistSet(
        { ids: [...ids], interval_secs: 1800, shuffle: false, enabled: true },
        true,
      );
      toast(`Rotation started with ${ids.length} wallpapers.`);
      notifyWallpaperChanged();
    } catch (error) {
      toast(String(error), 'error');
    }
  };

  const startRename = (item: WallpaperRecord) => {
    setRenaming({ id: item.id, value: item.title });
  };

  const commitRename = async () => {
    const current = renaming;
    setRenaming(null);
    if (!current) return;
    const clean = current.value.trim();
    if (!clean) return;
    const item = items.find((i) => i.id === current.id);
    if (!item || item.title === clean) return;
    await api.libraryRename(current.id, clean);
    await refresh();
  };

  const handleContextMenu = (e: React.MouseEvent, item: WallpaperRecord) => {
    e.preventDefault();
    if (!selected.has(item.id)) {
      setSelected(new Set([item.id]));
      anchorRef.current = item.id;
    }
    setMenu({ x: e.clientX, y: e.clientY, item });
  };

  const menuItems = (item: WallpaperRecord): (MenuItem | 'sep')[] => {
    const count = selected.size;
    const many = count > 1 && selected.has(item.id);
    return [
      ...(many
        ? []
        : [
            {
              label: 'Set as wallpaper',
              icon: MonitorPlay,
              onSelect: () => void setAsWallpaper(item),
            },
          ]),
      { label: 'Rename', icon: Pencil, onSelect: () => startRename(item) },
      { label: 'Reveal in Finder', icon: FolderOpen, onSelect: () => reveal(item) },
      {
        label: 'Regenerate thumbnail',
        icon: RefreshCw,
        onSelect: () => void regenerate(item),
      },
      'sep',
      {
        label: many ? `Delete ${count} wallpapers` : 'Delete',
        icon: Trash2,
        danger: true,
        onSelect: () => (many ? void deleteSelected() : void deleteOne(item)),
      },
    ];
  };

  /* -------------------------------------------------------------- derived */

  const counts = useMemo(
    () => ({
      all: items.length,
      static: items.filter((i) => i.type === 'static').length,
      video: items.filter((i) => i.type === 'video').length,
    }),
    [items],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = items.filter((item) => {
      if (filter !== 'all' && item.type !== filter) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
    const sorted = filtered.slice();
    switch (sort) {
      case 'oldest':
        sorted.sort((a, b) => a.created_at.localeCompare(b.created_at));
        break;
      case 'name-asc':
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'name-desc':
        sorted.sort((a, b) => b.title.localeCompare(a.title));
        break;
      default:
        sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    return sorted;
  }, [items, filter, sort, query]);

  const selectedItems = visible.filter((i) => selected.has(i.id));

  /* ----------------------------------------------------------------- view */

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

      <div className="row" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="segmented" role="tablist" aria-label="Filter by type">
          {(
            [
              ['all', 'All', counts.all],
              ['static', 'Static', counts.static],
              ['video', 'Live', counts.video],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              className={filter === value ? 'active' : undefined}
              onClick={() => setFilter(value)}
            >
              {label} ({count})
            </button>
          ))}
        </div>
        <span className="spacer" />
        <label className="row small muted" style={{ gap: 8 }}>
          Sort
          <select
            className="select"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort wallpapers"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selected.size > 0 && (
        <div className="selection-bar">
          <CheckSquare size={15} aria-hidden="true" />
          <span className="small">
            {selected.size} selected
            {selectedItems.length === 1 && selectedItems[0].type === 'video'
              ? ' · Live'
              : ''}
          </span>
          <span className="spacer" />
          {selectedItems.length === 1 && (
            <button
              type="button"
              className="btn primary"
              onClick={() => void setAsWallpaper(selectedItems[0])}
            >
              <MonitorPlay size={14} aria-hidden="true" />
              <span>Set as wallpaper</span>
            </button>
          )}
          {selectedItems.length > 1 && (
            <button
              type="button"
              className="btn primary"
              onClick={() => void startRotation(selectedItems.map((i) => i.id))}
            >
              <Repeat size={14} aria-hidden="true" />
              <span>Start rotation ({selectedItems.length})</span>
            </button>
          )}
          {selectedItems.length === 1 && (
            <button
              type="button"
              className="btn"
              onClick={() => reveal(selectedItems[0])}
            >
              <FolderOpen size={14} aria-hidden="true" />
              <span>Reveal in Finder</span>
            </button>
          )}
          <button type="button" className="btn danger" onClick={deleteSelected}>
            <Trash2 size={14} aria-hidden="true" />
            <span>Delete</span>
          </button>
          <button type="button" className="btn icon ghost" onClick={clearSelection} aria-label="Clear selection">
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      {loading ? (
        <SkeletonGrid />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={items.length === 0 ? <ImageIcon size={22} /> : <LayoutGrid size={22} />}
          title={items.length === 0 ? 'No wallpapers yet' : 'No matches'}
          body={
            items.length === 0
              ? 'Import a photo or an H.264/HEVC video, or drop files anywhere in this window. Files are copied into Driftwall’s library and thumbnails are generated automatically.'
              : `Nothing here matches “${query.trim()}” or the current filter.`
          }
          actionLabel={items.length === 0 ? 'Import wallpapers' : undefined}
          onAction={items.length === 0 ? handleImport : undefined}
        />
      ) : (
        <ul className="grid">
          {visible.map((item) => {
            const thumb = thumbs[item.id];
            const isVideo = item.type === 'video';
            const previewing = isVideo && hoverId === item.id;
            const src =
              thumb ?? (isVideo ? assetUrl(item.file_path) : undefined);
            return (
              <li
                key={item.id}
                className={`tile${selected.has(item.id) ? ' selected' : ''}${currentId === item.id ? ' current' : ''}`}
                onClick={(e) => handleTileClick(e, item.id)}
                onContextMenu={(e) => handleContextMenu(e, item)}
                onMouseEnter={() => setHoverId(item.id)}
                onMouseLeave={() => setHoverId((h) => (h === item.id ? null : h))}
              >
                <div className="tile-thumb">
                  {currentId === item.id && <span className="current-pill">Current</span>}
                  <span className="badge">
                    {isVideo ? <Video size={12} /> : <ImageIcon size={12} />}
                  </span>
                  {src ? (
                    <img src={src} alt="" loading="lazy" />
                  ) : (
                    <div className="tile-fallback" aria-hidden="true" />
                  )}
                  {previewing && <PreviewVideo src={assetUrl(item.file_path)} />}
                  <div className="tile-overlay">
                    <span className="tile-sub">
                      {item.width && item.height ? `${item.width}×${item.height}` : '—'}
                    </span>
                    <div className="tile-actions">
                      <button
                        type="button"
                        aria-label={`Set ${item.title} as wallpaper`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void setAsWallpaper(item);
                        }}
                      >
                        <MonitorPlay size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Rename ${item.title}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          startRename(item);
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Reveal ${item.title} in Finder`}
                        onClick={(e) => {
                          e.stopPropagation();
                          reveal(item);
                        }}
                      >
                        <FolderOpen size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${item.title}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteOne(item);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="tile-meta">
                  {renaming?.id === item.id ? (
                    <input
                      className="tile-input"
                      value={renaming.value}
                      autoFocus
                      onChange={(e) =>
                        setRenaming({ id: item.id, value: e.target.value })
                      }
                      onBlur={() => void commitRename()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitRename();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      aria-label="Wallpaper title"
                    />
                  ) : (
                    <span className="tile-title" title={item.title}>
                      {item.title}
                    </span>
                  )}
                  <span className="tile-sub">
                    {item.width && item.height ? `${item.width}×${item.height}` : '—'}
                    {isVideo && item.duration ? ` · ${Math.round(item.duration)}s` : ''}
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

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.item)}
          onClose={() => setMenu(null)}
        />
      )}

      {dragging && (
        <div className="dropzone">
          <div className="dropzone-box">
            <Plus size={22} aria-hidden="true" />
            <strong>Drop to import</strong>
            <span className="muted small">Images and H.264/HEVC video</span>
          </div>
        </div>
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
