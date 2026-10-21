import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { AlertCircle, ArrowDownToLine, Check, Loader2, RotateCcw, X } from 'lucide-react';
import { useToast } from './Toast.tsx';
import * as api from '../lib/api.ts';
import type { DiscoverItem, Rendition } from '../lib/domain.ts';
import { notifyLibraryChanged } from '../lib/dom.ts';
import { importDownloaded } from '../lib/importer.ts';
import {
  type DownloadEntry,
  describeProgress,
  downloadsReducer,
  isActive,
  pickRendition,
  progressFraction,
} from '../lib/downloads.ts';

interface DownloadsApi {
  entries: DownloadEntry[];
  /** Downloads that are queued, transferring or being added to the library. */
  activeCount: number;
  /** Starts a download (no-op if that item is already in flight). */
  start: (item: DiscoverItem, rendition?: Rendition | null) => void;
  /** Cancels a queued or transferring download. */
  cancel: (id: string) => void;
  retry: (id: string) => void;
  dismiss: (id: string) => void;
  clearFinished: () => void;
  get: (id: string) => DownloadEntry | undefined;
}

const DownloadsContext = createContext<DownloadsApi | null>(null);

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function DownloadsProvider({
  children,
  onOpenLibrary,
}: {
  children: ReactNode;
  onOpenLibrary: () => void;
}) {
  const { toast } = useToast();
  const [entries, dispatch] = useReducer(downloadsReducer, []);
  // What each download was started with, so Retry can repeat it exactly.
  const jobs = useRef(new Map<string, { item: DiscoverItem; rendition: Rendition | null }>());
  const running = useRef(new Set<string>());
  const cancelled = useRef(new Set<string>());
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const openLibraryRef = useRef(onOpenLibrary);
  openLibraryRef.current = onOpenLibrary;

  const run = useCallback(
    async (item: DiscoverItem, rendition: Rendition | null) => {
      const { id } = item;
      running.current.add(id);
      try {
        const file = await api.discoverDownload({
          item,
          rendition,
          onProgress: (progress) => dispatch({ type: 'progress', progress }),
        });
        dispatch({ type: 'processing', id });
        const record = await importDownloaded(file);
        if (!record) {
          const message = 'That file could not be read as a wallpaper, so it was skipped.';
          dispatch({ type: 'fail', id, error: message });
          toast(message, 'error');
          return;
        }
        dispatch({ type: 'done', id, recordId: record.id });
        notifyLibraryChanged();
        toast(`Added “${record.title}” to your library`, 'info', {
          label: 'Open Library',
          onClick: () => openLibraryRef.current(),
        });
      } catch (error) {
        if (cancelled.current.has(id)) {
          dispatch({ type: 'remove', id });
        } else {
          const message = errorText(error);
          dispatch({ type: 'fail', id, error: message });
          toast(`Could not add “${item.title}”: ${message}`, 'error');
        }
      } finally {
        running.current.delete(id);
        cancelled.current.delete(id);
      }
    },
    [toast],
  );

  const start = useCallback(
    (item: DiscoverItem, rendition?: Rendition | null) => {
      if (running.current.has(item.id)) return;
      const chosen = rendition ?? pickRendition(item);
      jobs.current.set(item.id, { item, rendition: chosen });
      cancelled.current.delete(item.id);
      dispatch({ type: 'start', item, rendition: chosen, now: Date.now() });
      void run(item, chosen);
    },
    [run],
  );

  const cancel = useCallback((id: string) => {
    const entry = entriesRef.current.find((e) => e.id === id);
    // Once the bytes are down the file is being added; that step is quick and
    // not cancellable.
    if (!entry || (entry.phase !== 'queued' && entry.phase !== 'downloading')) return;
    cancelled.current.add(id);
    void api.discoverCancel(id).catch(() => undefined);
  }, []);

  const retry = useCallback(
    (id: string) => {
      const job = jobs.current.get(id);
      if (job) start(job.item, job.rendition);
    },
    [start],
  );

  const dismiss = useCallback((id: string) => dispatch({ type: 'remove', id }), []);
  const clearFinished = useCallback(() => dispatch({ type: 'clear-finished' }), []);
  const get = useCallback((id: string) => entriesRef.current.find((e) => e.id === id), []);

  const value = useMemo<DownloadsApi>(
    () => ({
      entries,
      activeCount: entries.filter(isActive).length,
      start,
      cancel,
      retry,
      dismiss,
      clearFinished,
      get,
    }),
    [entries, start, cancel, retry, dismiss, clearFinished, get],
  );

  return <DownloadsContext.Provider value={value}>{children}</DownloadsContext.Provider>;
}

export function useDownloads(): DownloadsApi {
  const ctx = useContext(DownloadsContext);
  if (!ctx) throw new Error('useDownloads must be used inside <DownloadsProvider>');
  return ctx;
}

/* ------------------------------------------------------------ progress bar */

/** Determinate bar when the size is known, otherwise an indeterminate shimmer. */
export function ProgressBar({ entry, label }: { entry: DownloadEntry; label?: string }) {
  const fraction = progressFraction(entry);
  const failed = entry.phase === 'error';
  const indeterminate = fraction === null && isActive(entry);
  const percent = Math.round((fraction ?? 0) * 100);
  return (
    <div
      className={
        failed ? 'progress failed' : indeterminate ? 'progress indeterminate' : 'progress'
      }
      role="progressbar"
      aria-label={label ?? `Downloading ${entry.title}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : percent}
    >
      <div
        className="progress-fill"
        style={indeterminate ? undefined : { width: `${failed ? 100 : percent}%` }}
      />
    </div>
  );
}

/* -------------------------------------------------------- toolbar popover */

export function DownloadsButton() {
  const { entries, activeCount, cancel, retry, dismiss, clearFinished } = useDownloads();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const finished = entries.filter((e) => !isActive(e)).length;

  return (
    <div className="dl-root" ref={rootRef}>
      <button
        type="button"
        className={activeCount > 0 ? 'btn icon ghost dl-button busy' : 'btn icon ghost dl-button'}
        aria-label={
          activeCount > 0 ? `Downloads, ${activeCount} in progress` : 'Downloads'
        }
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {activeCount > 0 ? (
          <Loader2 size={16} className="spin" aria-hidden="true" />
        ) : (
          <ArrowDownToLine size={16} aria-hidden="true" />
        )}
        {activeCount > 0 && <span className="dl-badge">{activeCount}</span>}
      </button>

      {open && (
        <div className="dl-pop" role="dialog" aria-label="Downloads">
          <div className="dl-head">
            <strong>Downloads</strong>
            <span className="spacer" />
            {finished > 0 && (
              <button type="button" className="link-btn" onClick={clearFinished}>
                Clear finished
              </button>
            )}
          </div>

          {entries.length === 0 ? (
            <p className="dl-empty">
              Nothing downloading. Wallpapers you add from Discover show their progress here.
            </p>
          ) : (
            <ul className="dl-list">
              {entries.map((entry) => (
                <li key={entry.id} className={`dl-item ${entry.phase}`}>
                  <div className="dl-thumb">
                    <img src={entry.thumb} alt="" />
                  </div>
                  <div className="dl-main">
                    <div className="dl-title" title={entry.title}>
                      {entry.title}
                      {entry.qualityLabel && <span className="dl-q">{entry.qualityLabel}</span>}
                    </div>
                    <div className={entry.phase === 'error' ? 'dl-status error' : 'dl-status'}>
                      {entry.phase === 'done' && <Check size={12} aria-hidden="true" />}
                      {entry.phase === 'error' && <AlertCircle size={12} aria-hidden="true" />}
                      <span>{describeProgress(entry)}</span>
                    </div>
                    {isActive(entry) && <ProgressBar entry={entry} />}
                  </div>
                  <div className="dl-actions">
                    {(entry.phase === 'queued' || entry.phase === 'downloading') && (
                      <button
                        type="button"
                        className="btn icon ghost"
                        aria-label={`Cancel ${entry.title}`}
                        onClick={() => cancel(entry.id)}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    )}
                    {entry.phase === 'error' && (
                      <button
                        type="button"
                        className="btn icon ghost"
                        aria-label={`Retry ${entry.title}`}
                        onClick={() => retry(entry.id)}
                      >
                        <RotateCcw size={14} aria-hidden="true" />
                      </button>
                    )}
                    {!isActive(entry) && (
                      <button
                        type="button"
                        className="btn icon ghost"
                        aria-label={`Dismiss ${entry.title}`}
                        onClick={() => dismiss(entry.id)}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
