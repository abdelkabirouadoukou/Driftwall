import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export default function Settings() {
  const [dock, setDock] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    invoke<boolean>('get_dock_mode')
      .then((value) => setDock(value))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const toggleDock = async () => {
    const next = !dock;
    setDock(next);
    try {
      await invoke('set_dock_mode', { dock: next });
    } catch {
      setDock(!next);
    }
  };

  return (
    <section className="settings">
      <header className="page-head">
        <h1>Settings</h1>
      </header>

      <div className="setting-row">
        <div>
          <div className="setting-title">Show in Dock</div>
          <div className="muted small">
            When off, Driftwall runs from the menu bar only.
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={dock}
          aria-label="Show in Dock"
          className={dock ? 'switch on' : 'switch'}
          onClick={toggleDock}
          disabled={!loaded}
        >
          <span className="knob" />
        </button>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-title">Efficiency profile</div>
          <div className="muted small">
            1080p / 30 fps cap, hardware decode, pause on occlusion/battery/thermal.
            Applied when playback ships (Phase 2).
          </div>
        </div>
        <span className="muted small">Default</span>
      </div>
    </section>
  );
}
