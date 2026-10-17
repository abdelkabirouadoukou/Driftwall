import { type ReactNode, useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { Eye, EyeOff, FolderOpen, Trash2 } from 'lucide-react';
import { useToast } from './Toast.tsx';
import Skeleton from './Skeleton.tsx';
import * as api from '../lib/api.ts';
import { wallpapersDir } from '../lib/paths.ts';

const PIXABAY_KEY = 'pixabay_api_key';

function Switch({
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

function Row({
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

function Section({ title, children }: { title: string; children: ReactNode }) {
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
  const [key, setKey] = useState('');
  const [savedKey, setSavedKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [libraryPath, setLibraryPath] = useState('');
  const [version, setVersion] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const [dockMode, storedKey, dir] = await Promise.all([
          api.getDockMode().catch(() => true),
          api.settingsGet<string>(PIXABAY_KEY).catch(() => null),
          wallpapersDir().catch(() => ''),
        ]);
        setDock(dockMode);
        setSavedKey(storedKey ?? '');
        setKey(storedKey ?? '');
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

  const saveKey = async () => {
    const clean = key.trim();
    try {
      await api.settingsSet(PIXABAY_KEY, clean);
      setSavedKey(clean);
      setKey(clean);
      toast(clean ? 'Pixabay key saved.' : 'Pixabay key cleared.');
    } catch {
      toast('Could not save the key', 'error');
    }
  };

  const clearKey = async () => {
    setKey('');
    try {
      await api.settingsSet(PIXABAY_KEY, '');
      setSavedKey('');
      toast('Pixabay key cleared.');
    } catch {
      toast('Could not clear the key', 'error');
    }
  };

  const revealLibrary = () => {
    if (!libraryPath) return;
    void api.revealInFinder(libraryPath).catch(() => {
      toast('Could not open the library folder', 'error');
    });
  };

  const dirty = key.trim() !== savedKey;

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
          title="Pixabay API key"
          desc={
            <>
              Needed for Pixabay video search. Stored locally in your library —
              never sent anywhere except Pixabay. Create a free key at
              pixabay.com/api/docs.
            </>
          }
        >
          <div className="row" style={{ gap: 8 }}>
            <input
              className="setting-input"
              type={showKey ? 'text' : 'password'}
              value={key}
              placeholder="Paste your Pixabay key"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setKey(e.target.value)}
              aria-label="Pixabay API key"
            />
            <button
              type="button"
              className="btn icon"
              onClick={() => setShowKey((v) => !v)}
              aria-label={showKey ? 'Hide key' : 'Show key'}
            >
              {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={saveKey}
              disabled={!dirty}
            >
              Save
            </button>
            {savedKey && (
              <button
                type="button"
                className="btn icon ghost"
                onClick={clearKey}
                aria-label="Clear Pixabay key"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </Row>
        <Row
          title="Wallhaven"
          desc="No key required. Only SFW results are ever requested."
        >
          <span className="muted small">Built in</span>
        </Row>
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
          desc="Per-display playback, scaling modes and restore-original ship with Phase 2."
        >
          <span className="muted small">Coming soon</span>
        </Row>
      </Section>

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
