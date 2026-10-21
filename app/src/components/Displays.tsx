import { useCallback, useEffect, useMemo, useState } from 'react';
import { availableMonitors } from '@tauri-apps/api/window';
import { Monitor, MonitorPlay, Repeat, RotateCcw, SkipForward, Square } from 'lucide-react';
import EmptyState from './EmptyState.tsx';
import { Row, Section, Switch } from './Settings.tsx';
import { useToast } from './Toast.tsx';
import * as api from '../lib/api.ts';
import { isTauri } from '../lib/api.ts';
import { resolveThumbUrls } from '../lib/paths.ts';
import { LIBRARY_CHANGED_EVENT, WALLPAPER_CHANGED_EVENT, notifyWallpaperChanged } from '../lib/dom.ts';
import { DEFAULT_INTERVAL_SECS, minutesToSecs, secsToMinutes } from '../lib/rotation.ts';
import type { EngineStatus, Playlist, WallpaperRecord } from '../lib/domain.ts';

interface MonitorInfo {
  name: string;
  width: number;
  height: number;
  scale: number;
}

const DEFAULT_PLAYLIST: Playlist = {
  ids: [],
  interval_secs: DEFAULT_INTERVAL_SECS,
  shuffle: false,
  enabled: false,
};

/**
 * Displays — what is playing now, connected displays and the rotation.
 * All displays currently mirror the same wallpaper (no per-display assignment yet).
 */
export default function Displays() {
  const { toast } = useToast();
  const [items, setItems] = useState<WallpaperRecord[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [playlist, setPlaylist] = useState<Playlist>(DEFAULT_PLAYLIST);
  const [minutes, setMinutes] = useState(DEFAULT_INTERVAL_SECS / 60);
  const [saving, setSaving] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api.engineStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  const loadLibrary = useCallback(async () => {
    try {
      const rows = await api.libraryList();
      setItems(rows);
      setThumbs(await resolveThumbUrls(rows.map((r) => r.id)));
    } catch {
      toast('Could not load library', 'error');
    }
  }, [toast]);

  useEffect(() => {
    void loadLibrary();
    void loadStatus();
    void api
      .playlistGet()
      .then((p) => {
        setPlaylist(p);
        setMinutes(secsToMinutes(p.interval_secs));
      })
      .catch(() => undefined);
    if (isTauri()) {
      void availableMonitors()
        .then((list) =>
          setMonitors(
            list.map((m, i) => ({
              name: m.name ?? `Display ${i + 1}`,
              width: m.size.width,
              height: m.size.height,
              scale: m.scaleFactor,
            })),
          ),
        )
        .catch(() => undefined);
    }
    const onWallpaper = () => void loadStatus();
    const onLibrary = () => void loadLibrary();
    window.addEventListener(WALLPAPER_CHANGED_EVENT, onWallpaper);
    window.addEventListener(LIBRARY_CHANGED_EVENT, onLibrary);
    return () => {
      window.removeEventListener(WALLPAPER_CHANGED_EVENT, onWallpaper);
      window.removeEventListener(LIBRARY_CHANGED_EVENT, onLibrary);
    };
  }, [loadLibrary, loadStatus]);

  const current = useMemo(
    () => (status?.current_id ? items.find((i) => i.id === status.current_id) : undefined),
    [items, status],
  );

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      toast(success);
      notifyWallpaperChanged();
    } catch (error) {
      toast(String(error), 'error');
    }
  };

  const toggleId = (id: string) => {
    setPlaylist((p) => ({
      ...p,
      ids: p.ids.includes(id) ? p.ids.filter((x) => x !== id) : [...p.ids, id],
    }));
  };

  const saveRotation = async () => {
    setSaving(true);
    try {
      const saved = await api.playlistSet(
        { ...playlist, interval_secs: minutesToSecs(minutes) },
        playlist.enabled,
      );
      setPlaylist(saved);
      setMinutes(secsToMinutes(saved.interval_secs));
      toast('Rotation saved.');
      notifyWallpaperChanged();
    } catch (error) {
      toast(String(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  const canSkip = playlist.enabled && playlist.ids.length >= 2;

  return (
    <section aria-label="Displays">
      <header className="page-head">
        <div>
          <h1>Displays</h1>
          <p className="sub">What’s playing, your displays and wallpaper rotation.</p>
        </div>
      </header>

      <div className="now-playing">
        <div className="now-playing-thumb" aria-hidden="true">
          {current && thumbs[current.id] ? (
            <img src={thumbs[current.id]} alt="" />
          ) : (
            <MonitorPlay size={26} />
          )}
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
            {current ? current.title : 'Nothing playing'}
          </h2>
          {current &&
            (status?.paused_reason ? (
              <span className="paused-pill">Paused · {status.paused_reason}</span>
            ) : (
              <span className="current-pill">
                {status?.live_active ? 'Playing live' : 'Current wallpaper'}
              </span>
            ))}
          {status && (
            <p className="muted small" style={{ margin: 0 }}>
              {status.on_battery ? 'On battery' : 'Plugged in'}
              {status.battery_percent != null ? ` · ${status.battery_percent}%` : ''}
              {status.low_power ? ' · Low Power Mode' : ''}
            </p>
          )}
          <div className="row" style={{ marginTop: 6 }}>
            <button
              type="button"
              className="btn"
              disabled={!current}
              onClick={() => void run(() => api.wallpaperStop(), 'Stopped.')}
            >
              <Square size={14} aria-hidden="true" />
              <span>Stop</span>
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void run(() => api.wallpaperRestoreOriginal(), 'Original desktop restored.')
              }
            >
              <RotateCcw size={14} aria-hidden="true" />
              <span>Restore original desktop</span>
            </button>
          </div>
        </div>
      </div>

      <Section title="Connected displays">
        {monitors.length === 0 ? (
          <EmptyState
            icon={<Monitor size={22} />}
            title="No display info"
            body="Display details are only available in the desktop app."
          />
        ) : (
          <>
            {monitors.map((m, i) => (
              <Row
                key={`${m.name}-${i}`}
                title={m.name}
                desc={`${m.width}×${m.height} px · ${m.scale}× scale`}
              >
                <span className="muted small">Mirrored</span>
              </Row>
            ))}
            <div className="setting-row">
              <span className="muted small">
                All displays show the same wallpaper and rotation for now; per-display
                assignment isn’t available yet. Plugging in a display takes effect the next
                time a wallpaper is applied.
              </span>
            </div>
          </>
        )}
      </Section>

      <Section title="Rotation">
        {items.length < 2 ? (
          <div className="setting-row">
            <span className="muted small">Import at least two wallpapers to use rotation.</span>
          </div>
        ) : (
          <div className="setting-row" style={{ display: 'block' }}>
            <div className="rotation-list">
              {items.map((item) => (
                <label key={item.id} className="rotation-item">
                  <input
                    type="checkbox"
                    checked={playlist.ids.includes(item.id)}
                    onChange={() => toggleId(item.id)}
                  />
                  <span className="rotation-thumb">
                    {thumbs[item.id] && <img src={thumbs[item.id]} alt="" />}
                  </span>
                  <span className="rotation-item-title">{item.title}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        <Row title="Change every" desc="How often the rotation advances (minimum 15 seconds).">
          <div className="interval-input">
            <input
              className="setting-input"
              type="number"
              min={0.25}
              step={1}
              value={minutes}
              aria-label="Rotation interval in minutes"
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
            <span className="muted small">min</span>
          </div>
        </Row>
        <Row title="Shuffle" desc="Pick the next wallpaper at random.">
          <Switch
            on={playlist.shuffle}
            onChange={() => setPlaylist((p) => ({ ...p, shuffle: !p.shuffle }))}
            label="Shuffle"
          />
        </Row>
        <Row title="Rotation enabled" desc="Needs at least two wallpapers selected.">
          <Switch
            on={playlist.enabled}
            onChange={() => setPlaylist((p) => ({ ...p, enabled: !p.enabled }))}
            label="Rotation enabled"
          />
        </Row>
        <div className="setting-row">
          <span className="muted small">{playlist.ids.length} selected</span>
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn"
              disabled={!canSkip}
              onClick={() => void run(() => api.playlistNext(), 'Skipped to next.')}
            >
              <SkipForward size={14} aria-hidden="true" />
              <span>Skip to next</span>
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={saving}
              onClick={() => void saveRotation()}
            >
              <Repeat size={14} aria-hidden="true" />
              <span>{saving ? 'Saving…' : 'Save'}</span>
            </button>
          </div>
        </div>
      </Section>
    </section>
  );
}
