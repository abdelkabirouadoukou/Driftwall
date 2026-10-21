import { useCallback, useEffect, useState } from 'react';
import {
  ExternalLink,
  MonitorPlay,
  Music as MusicIcon,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Square,
  Volume2,
} from 'lucide-react';
import { emit, listen } from '@tauri-apps/api/event';
import { Switch } from './Settings.tsx';
import * as api from '../lib/api.ts';
import { resolveThumbUrls } from '../lib/paths.ts';
import { sceneById, sceneIdFromCurrent } from '../lib/scenes.ts';
import { WALLPAPER_CHANGED_EVENT, bridgeWallpaperEvents, notifyWallpaperChanged } from '../lib/dom.ts';
import { DEFAULT_POWER_POLICY, type EngineStatus, type PowerPolicy, type WallpaperRecord } from '../lib/domain.ts';
import {
  MUSIC_CMD_EVENT,
  MUSIC_STATE_EVENT,
  type MusicCommand,
  type MusicState,
} from '../lib/music.ts';

const QUICK_COUNT = 6;

function sendMusic(cmd: MusicCommand) {
  void emit(MUSIC_CMD_EVENT, cmd).catch(() => undefined);
}

/**
 * The small box that opens under the menu-bar icon (window label `panel`).
 * It is a remote control: wallpaper actions go straight to the engine, music
 * commands go to the main window, which owns playback.
 */
export default function TrayPanel() {
  const [items, setItems] = useState<WallpaperRecord[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [music, setMusic] = useState<MusicState | null>(null);
  const [policy, setPolicy] = useState<PowerPolicy>(DEFAULT_POWER_POLICY);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await api.libraryList();
      setItems(rows);
      setThumbs(await resolveThumbUrls(rows.map((r) => r.id)));
    } catch {
      /* keep what we have */
    }
    try {
      setStatus(await api.engineStatus());
    } catch {
      setStatus(null);
    }
    try {
      const stored = await api.settingsGet<Partial<PowerPolicy>>('power');
      setPolicy({ ...DEFAULT_POWER_POLICY, ...(stored ?? {}) });
    } catch {
      /* defaults */
    }
    sendMusic({ type: 'request-state' });
  }, []);

  useEffect(() => {
    void refresh();
    const stopBridge = bridgeWallpaperEvents();
    const onChanged = () => void refresh();
    window.addEventListener(WALLPAPER_CHANGED_EVENT, onChanged);
    // The panel window is reused, so refresh every time it is shown again.
    window.addEventListener('focus', onChanged);

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<MusicState>(MUSIC_STATE_EVENT, (e) => setMusic(e.payload))
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
      stopBridge();
      window.removeEventListener(WALLPAPER_CHANGED_EVENT, onChanged);
      window.removeEventListener('focus', onChanged);
    };
  }, [refresh]);

  const run = async (action: () => Promise<unknown>) => {
    setMessage(null);
    try {
      await action();
      notifyWallpaperChanged();
      await refresh();
    } catch (error) {
      setMessage(String(error));
    }
  };

  const savePolicy = async (next: PowerPolicy) => {
    setPolicy(next);
    try {
      await api.settingsSet('power', next);
      await api.powerRefresh();
      setStatus(await api.engineStatus());
    } catch {
      setMessage('Could not save battery setting.');
    }
  };

  const current = status?.current_id ? items.find((i) => i.id === status.current_id) : undefined;
  const scene = sceneById(sceneIdFromCurrent(status?.current_id));
  const hasCurrent = !!current || !!scene;
  const recent = items
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, QUICK_COUNT);

  return (
    <div className="panel">
      <div className="panel-head">
        <strong>Driftwall</strong>
        <button type="button" className="btn ghost" onClick={() => void api.openMainWindow()}>
          <ExternalLink size={14} aria-hidden="true" />
          <span>Open</span>
        </button>
      </div>

      <div className="panel-card">
        <div className="panel-thumb" aria-hidden="true">
          {current && thumbs[current.id] ? <img src={thumbs[current.id]} alt="" /> : <MonitorPlay size={20} />}
        </div>
        <div className="stack" style={{ gap: 4, minWidth: 0 }}>
          <span className="panel-title">{current?.title ?? scene?.name ?? 'Nothing playing'}</span>
          {hasCurrent &&
            (status?.paused_reason ? (
              <span className="paused-pill">Paused · {status.paused_reason}</span>
            ) : (
              <span className="current-pill">{scene ? 'Animated scene' : status?.live_active ? 'Playing live' : 'Current'}</span>
            ))}
          {status && (
            <span className="muted small">
              {status.on_battery ? 'On battery' : 'Plugged in'}
              {status.battery_percent != null ? ` · ${status.battery_percent}%` : ''}
            </span>
          )}
        </div>
        <button
          type="button"
          className="btn icon"
          disabled={!hasCurrent}
          onClick={() => void run(() => api.wallpaperStop())}
          aria-label="Stop wallpaper"
          title="Stop"
        >
          <Square size={14} />
        </button>
      </div>

      <div className="panel-section">Quick wallpapers</div>
      {recent.length === 0 ? (
        <p className="muted small">Import wallpapers to see them here.</p>
      ) : (
        <div className="panel-grid">
          {recent.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === current?.id ? 'panel-tile current' : 'panel-tile'}
              title={item.title}
              onClick={() => void run(() => api.wallpaperApply(item.id))}
            >
              {thumbs[item.id] ? <img src={thumbs[item.id]} alt={item.title} /> : <span>{item.title}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="panel-section">Music</div>
      <div className="panel-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <span className="panel-title">
          {music && music.count > 0 ? music.title || 'Ready to play' : 'No songs yet'}
        </span>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn icon" onClick={() => sendMusic({ type: 'prev' })} aria-label="Previous">
            <SkipBack size={14} />
          </button>
          <button
            type="button"
            className="btn primary icon"
            disabled={!music || music.count === 0}
            onClick={() => sendMusic({ type: 'toggle' })}
            aria-label={music?.playing ? 'Pause' : 'Play'}
          >
            {music?.playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button type="button" className="btn icon" onClick={() => sendMusic({ type: 'next' })} aria-label="Next">
            <SkipForward size={14} />
          </button>
          <Volume2 size={14} className="muted" aria-hidden="true" />
          <input
            type="range"
            min={0}
            max={100}
            value={music?.volume ?? 80}
            onChange={(e) => sendMusic({ type: 'volume', value: Number(e.target.value) })}
            aria-label="Volume"
            style={{ flex: 1, minWidth: 0 }}
          />
          <button
            type="button"
            className="btn icon ghost"
            onClick={() => void api.openMainWindow('music')}
            aria-label="Open music"
            title="Open music"
          >
            <MusicIcon size={14} />
          </button>
        </div>
      </div>

      <div className="panel-section">Battery</div>
      <div className="panel-card" style={{ justifyContent: 'space-between' }}>
        <span className="small">Pause live wallpaper on battery</span>
        <Switch
          on={policy.pause_on_battery}
          onChange={() => void savePolicy({ ...policy, pause_on_battery: !policy.pause_on_battery })}
          label="Pause on battery"
        />
      </div>

      {message && <p className="small" style={{ color: 'var(--danger, #ff6b6b)' }}>{message}</p>}
    </div>
  );
}
