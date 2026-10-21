import { type ReactNode, useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { ExternalLink, Eye, EyeOff, FolderOpen, Trash2 } from 'lucide-react';
import { useToast } from './Toast.tsx';
import Skeleton from './Skeleton.tsx';
import * as api from '../lib/api.ts';
import { wallpapersDir } from '../lib/paths.ts';
import { DEFAULT_POWER_POLICY, type PowerPolicy } from '../lib/domain.ts';

/** Sources that use an API key you create yourself (stored locally). */
const KEY_SOURCES: {
  setting: string;
  label: string;
  desc: string;
  keyUrl: string;
}[] = [
  {
    setting: 'pexels_api_key',
    label: 'Pexels',
    desc: 'Unlocks Pexels photos and videos. Free and instant; 200 requests an hour.',
    keyUrl: 'https://www.pexels.com/api/',
  },
  {
    setting: 'pixabay_api_key',
    label: 'Pixabay',
    desc: 'Unlocks Pixabay animated loops. Free after signing up.',
    keyUrl: 'https://pixabay.com/api/docs/',
  },
  {
    setting: 'nasa_api_key',
    label: 'NASA (optional)',
    desc: 'APOD works without one using NASA’s shared demo key (about 30 requests an hour). Your own key lifts that.',
    keyUrl: 'https://api.nasa.gov/',
  },
];

export function Switch({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={on ? 'switch on' : 'switch'}
      onClick={onChange}
      disabled={disabled}
    >
      <span className="knob" />
    </button>
  );
}

export function Row({
  title,
  desc,
  children,
}: {
  title: string;
  desc: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div>
        <div className="setting-title">{title}</div>
        <div className="setting-desc">{desc}</div>
      </div>
      {children}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      <div className="settings-card">{children}</div>
    </section>
  );
}

export default function Settings() {
  const { toast } = useToast();
  const [loaded, setLoaded] = useState(false);
  const [dock, setDock] = useState(true);
  const [libraryPath, setLibraryPath] = useState('');
  const [version, setVersion] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const [dockMode, dir] = await Promise.all([
          api.getDockMode().catch(() => true),
          wallpapersDir().catch(() => ''),
        ]);
        setDock(dockMode);
        setLibraryPath(dir);
      } finally {
        setLoaded(true);
      }
      setVersion(await getVersion().catch(() => ''));
    })();
  }, []);

  const toggleDock = async () => {
    const next = !dock;
    setDock(next);
    try {
      await api.setDockMode(next);
    } catch {
      setDock(!next);
      toast('Could not change Dock setting', 'error');
    }
  };

  const revealLibrary = () => {
    if (!libraryPath) return;
    void api.revealInFinder(libraryPath).catch(() => {
      toast('Could not open the library folder', 'error');
    });
  };

  return (
    <section aria-label="Settings">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="sub">Appearance, sources and playback.</p>
        </div>
      </header>

      <Section title="General">
        <Row
          title="Show in Dock"
          desc="When off, Driftwall runs from the menu bar only."
        >
          <Switch
            on={dock}
            onChange={toggleDock}
            label="Show in Dock"
            disabled={!loaded}
          />
        </Row>
        <Row
          title="Theme"
          desc="Driftwall ships a single, OLED-friendly dark theme."
        >
          <span className="muted small">Driftwall Dark</span>
        </Row>
      </Section>

      <Section title="Sources">
        <Row
          title="Wallhaven"
          desc="Gaming, anime and dark art. No key needed; only SFW results are ever requested."
        >
          <span className="muted small">Built in</span>
        </Row>
        <Row
          title="Bing Daily"
          desc="A fresh photo each day from Bing’s unofficial feed. No key needed."
        >
          <span className="muted small">Built in</span>
        </Row>
        {KEY_SOURCES.map((source) => (
          <KeyRow key={source.setting} {...source} />
        ))}
      </Section>

      <Section title="Library">
        <Row
          title="Storage folder"
          desc="Copied media and thumbnails live here."
        >
          <div className="row" style={{ gap: 8 }}>
            <span className="muted small mono" title={libraryPath}>
              {libraryPath ? ellipsize(libraryPath, 34) : '—'}
            </span>
            <button
              type="button"
              className="btn"
              onClick={revealLibrary}
              disabled={!libraryPath}
            >
              <FolderOpen size={14} aria-hidden="true" />
              <span>Reveal</span>
            </button>
          </div>
        </Row>
      </Section>

      <Section title="Playback">
        <Row
          title="Efficiency profile"
          desc="1080p / 30 fps cap, hardware decode, pause on occlusion, battery or thermal pressure."
        >
          <span className="muted small">Default</span>
        </Row>
        <Row
          title="Wallpaper engine"
          desc="Set a wallpaper from your Library, and manage rotation and restore-original in the Displays tab."
        >
          <span className="muted small">See Displays</span>
        </Row>
      </Section>

      <PowerSection />

      <Section title="About">
        <Row
          title="Driftwall"
          desc={version ? `Version ${version}` : 'Driftwall for macOS'}
        >
          {version ? (
            <span className="muted small mono">v{version}</span>
          ) : (
            <Skeleton height={15} width={42} radius={4} />
          )}
        </Row>
      </Section>
    </section>
  );
}

function ellipsize(value: string, max: number): string {
  if (value.length <= max) return value;
  const head = value.slice(0, Math.ceil(max / 2) - 1);
  const tail = value.slice(-Math.floor(max / 2) + 1);
  return `${head}…${tail}`;
}

/** One API key: stored locally, masked, never sent anywhere but its provider. */
function KeyRow({
  setting,
  label,
  desc,
  keyUrl,
}: {
  setting: string;
  label: string;
  desc: string;
  keyUrl: string;
}) {
  const { toast } = useToast();
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState('');
  const [show, setShow] = useState(false);

  useEffect(() => {
    void api
      .settingsGet<string>(setting)
      .then((stored) => {
        setSaved(stored ?? '');
        setValue(stored ?? '');
      })
      .catch(() => undefined);
  }, [setting]);

  const write = async (next: string, message: string) => {
    try {
      await api.settingsSet(setting, next);
      setSaved(next);
      setValue(next);
      toast(message);
    } catch {
      toast(`Could not update the ${label} key`, 'error');
    }
  };

  return (
    <Row
      title={`${label} API key`}
      desc={
        <>
          {desc}{' '}
          <button
            type="button"
            className="link-btn"
            onClick={() => void api.openExternal(keyUrl).catch(() => undefined)}
          >
            Get a free key <ExternalLink size={11} aria-hidden="true" />
          </button>
        </>
      }
    >
      <div className="row" style={{ gap: 8 }}>
        <input
          className="setting-input"
          type={show ? 'text' : 'password'}
          value={value}
          placeholder={saved ? 'Key saved' : 'Paste your key'}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          aria-label={`${label} API key`}
        />
        <button
          type="button"
          className="btn icon"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? 'Hide key' : 'Show key'}
        >
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => void write(value.trim(), `${label} key ${value.trim() ? 'saved' : 'cleared'}.`)}
          disabled={value.trim() === saved}
        >
          Save
        </button>
        {saved && (
          <button
            type="button"
            className="btn icon ghost"
            onClick={() => void write('', `${label} key cleared.`)}
            aria-label={`Clear ${label} key`}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </Row>
  );
}

/** Battery policy for live wallpapers. Rust (`power.rs`) decides; this only stores it. */
function PowerSection() {
  const { toast } = useToast();
  const [policy, setPolicy] = useState<PowerPolicy>(DEFAULT_POWER_POLICY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void api
      .settingsGet<Partial<PowerPolicy>>('power')
      .then((stored) => setPolicy({ ...DEFAULT_POWER_POLICY, ...(stored ?? {}) }))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const save = async (next: PowerPolicy) => {
    const previous = policy;
    setPolicy(next);
    try {
      await api.settingsSet('power', next);
      // Apply right away instead of waiting for the 20s watcher tick.
      await api.powerRefresh();
    } catch {
      setPolicy(previous);
      toast('Could not save battery settings', 'error');
    }
  };

  return (
    <Section title="Battery">
      <Row
        title="Pause on battery"
        desc="Pause live wallpapers whenever the Mac is unplugged."
      >
        <Switch
          on={policy.pause_on_battery}
          onChange={() => void save({ ...policy, pause_on_battery: !policy.pause_on_battery })}
          label="Pause on battery"
          disabled={!loaded}
        />
      </Row>
      <Row
        title="Pause below"
        desc="Also pause on battery once charge drops to this level, even if the option above is off."
      >
        <div className="interval-input">
          <input
            className="setting-input"
            type="number"
            min={0}
            max={100}
            value={policy.battery_threshold}
            disabled={!loaded}
            aria-label="Pause below battery percent"
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isNaN(n)) return;
              void save({ ...policy, battery_threshold: Math.min(100, Math.max(0, Math.round(n))) });
            }}
          />
          <span className="muted small">%</span>
        </div>
      </Row>
      <Row
        title="Pause in Low Power Mode"
        desc="Pause live wallpapers while macOS Low Power Mode is on."
      >
        <Switch
          on={policy.pause_on_low_power}
          onChange={() => void save({ ...policy, pause_on_low_power: !policy.pause_on_low_power })}
          label="Pause in Low Power Mode"
          disabled={!loaded}
        />
      </Row>
    </Section>
  );
}
