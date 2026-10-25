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
import {
  DEFAULT_INTERVAL_SECS,
  MIN_INTERVAL_SECS,
  formatCountdown,
  fromSecs,
  toSecs,
  type IntervalUnit,
} from '../lib/rotation.ts';
import { sceneById, sceneIdFromCurrent } from '../lib/scenes.ts';
import type { EngineStatus, Playlist, WallpaperRecord } from '../lib/domain.ts';

interface MonitorInfo {
  name: string;
  width: number;
  height: number;
  scale: number;
}

const UNIT_FACTOR: Record<IntervalUnit, number> = { seconds: 1, minutes: 60, hours: 3600 };

const PRESETS: { label: string; value: number; unit: IntervalUnit }[] = [
  { label: '15 s', value: 15, unit: 'seconds' },
  { label: '1 min', value: 1, unit: 'minutes' },
  { label: '5 min', value: 5, unit: 'minutes' },
  { label: '30 min', value: 30, unit: 'minutes' },
  { label: '1 h', value: 1, unit: 'hours' },
];

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
  const initial = fromSecs(DEFAULT_INTERVAL_SECS);
  const [intervalValue, setIntervalValue] = useState(String(initial.value));
  const [unit, setUnit] = useState<IntervalUnit>(initial.unit);
  const [saving, setSaving] = useState(false);
  // Ticks once a second while a rotation runs, for the "next change" countdown.
  const [now, setNow] = useState(() => Date.now());

  const applyInterval = useCallback((secs: number) => {
    const next = fromSecs(secs);
    setIntervalValue(String(next.value));
    setUnit(next.unit);
  }, []);

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
        applyInterval(p.interval_secs);
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
  }, [applyInterval, loadLibrary, loadStatus]);

  const nextAt = playlist.enabled ? (status?.rotation_next_at ?? null) : null;
  useEffect(() => {
    if (!nextAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [nextAt]);

  // Drop selections whose wallpaper was deleted from the library.
  useEffect(() => {
    if (items.length === 0) return;
    setPlaylist((p) => {
      const known = new Set(items.map((i) => i.id));
      const ids = p.ids.filter((id) => known.has(id));
      return ids.length === p.ids.length ? p : { ...p, ids };
    });
  }, [items]);

  const current = useMemo(
    () => (status?.current_id ? items.find((i) => i.id === status.current_id) : undefined),
    [items, status],
  );

  const scene = sceneById(sceneIdFromCurrent(status?.current_id));
  const hasCurrent = !!current || !!scene;

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

  const typedSecs = toSecs(Number(intervalValue), unit);
  const rawSecs = Number(intervalValue) * UNIT_FACTOR[unit];
  const belowFloor = rawSecs > 0 && rawSecs < MIN_INTERVAL_SECS;

  // "Save" always means "use these wallpapers at this interval, starting now".
  const saveRotation = async () => {
    const ids = playlist.ids.filter((id) => items.some((i) => i.id === id));
    if (ids.length < 2) {
      toast('Pick at least two wallpapers for a rotation.', 'error');
      return;
    }
    setSaving(true);
    try {
      const saved = await api.playlistSet(
        { ids, interval_secs: typedSecs, shuffle: playlist.shuffle, enabled: true },
        true,
      );
      setPlaylist(saved);
      applyInterval(saved.interval_secs);
      const every = fromSecs(saved.interval_secs);
      toast(`Rotation started: ${saved.ids.length} wallpapers, every ${every.value} ${every.unit}.`);
      notifyWallpaperChanged();
      await loadStatus();
    } catch (error) {
      toast(String(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  const stopRotation = async () => {
    setSaving(true);
    try {
      const stored = await api.playlistGet();
      const saved = await api.playlistSet({ ...stored, enabled: false }, false);
      setPlaylist((p) => ({ ...p, enabled: saved.enabled }));
      toast('Rotation stopped. The current wallpaper stays.');
      notifyWallpaperChanged();
      await loadStatus();
    } catch (error) {
      toast(String(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  const selectAll = () => setPlaylist((p) => ({ ...p, ids: items.map((i) => i.id) }));
  const clearAll = () => setPlaylist((p) => ({ ...p, ids: [] }));

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
            {current?.title ?? scene?.name ?? 'Nothing playing'}
          </h2>
          {hasCurrent &&
            (status?.paused_reason ? (
              <span className="paused-pill">Paused · {status.paused_reason}</span>
            ) : (
              <span className="current-pill">
                {scene ? 'Animated scene' : status?.live_active ? 'Playing live' : 'Current wallpaper'}
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
              disabled={!hasCurrent}
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
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <span className="muted small">Choose the wallpapers to rotate through</span>
              <span className="spacer" />
              <button type="button" className="btn ghost" onClick={selectAll}>
                Select all
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={clearAll}
                disabled={playlist.ids.length === 0}
              >
                Clear
              </button>
            </div>
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
        <Row
          title="Change every"
          desc={
            belowFloor
              ? `Minimum is ${MIN_INTERVAL_SECS} seconds, so it will be saved as ${MIN_INTERVAL_SECS} s.`
              : 'How long each wallpaper stays before the next one.'
          }
        >
          <div className="interval-input">
            <input
              className="setting-input"
              type="number"
              min={1}
              step="any"
              value={intervalValue}
              aria-label="Rotation interval"
              onChange={(e) => setIntervalValue(e.target.value)}
            />
            <select
              className="select"
              value={unit}
              aria-label="Interval unit"
              onChange={(e) => setUnit(e.target.value as IntervalUnit)}
            >
              <option value="seconds">sec</option>
              <option value="minutes">min</option>
              <option value="hours">hours</option>
            </select>
          </div>
        </Row>
        <div className="setting-row">
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="chip"
                onClick={() => {
                  setIntervalValue(String(preset.value));
                  setUnit(preset.unit);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
        <Row title="Shuffle" desc="Pick the next wallpaper at random.">
          <Switch
            on={playlist.shuffle}
            onChange={() => setPlaylist((p) => ({ ...p, shuffle: !p.shuffle }))}
            label="Shuffle"
          />
        </Row>
        <div className="setting-row">
          <span className="muted small">
            {playlist.ids.length} selected
            {playlist.enabled
              ? nextAt
                ? ` · rotation running, next change in ${formatCountdown(nextAt - now)}`
                : ' · rotation running'
              : ' · rotation off'}
          </span>
          <div className="row" style={{ gap: 8 }}>
            {playlist.enabled && (
              <button
                type="button"
                className="btn"
                disabled={saving}
                onClick={() => void stopRotation()}
              >
                <Square size={14} aria-hidden="true" />
                <span>Stop rotation</span>
              </button>
            )}
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
              disabled={saving || playlist.ids.length < 2}
              onClick={() => void saveRotation()}
            >
              <Repeat size={14} aria-hidden="true" />
              <span>{saving ? 'Saving…' : playlist.enabled ? 'Save & apply' : 'Save & start'}</span>
            </button>
          </div>
        </div>
      </Section>
    </section>
  );
}
