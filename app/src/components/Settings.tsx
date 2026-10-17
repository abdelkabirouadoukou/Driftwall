import { useEffect, useState } from 'react';
import { getDockMode, setDockMode } from '../lib/api.ts';

export default function Settings() {
  const [dock, setDock] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getDockMode()
      .then((value) => setDock(value))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const toggleDock = async () => {
    const next = !dock;
    setDock(next);
    try {
      await setDockMode(next);
    } catch {
      setDock(!next);
    }
  };

  return (
    <section aria-label="Settings">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="sub">Appearance, sources and playback.</p>
        </div>
      </header>

      <div className="settings-section">
        <h2>General</h2>
        <div className="settings-card">
          <div className="setting-row">
            <div>
              <div className="setting-title">Show in Dock</div>
              <div className="setting-desc">
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
              <div className="setting-desc">
                1080p / 30 fps cap, hardware decode, pause on occlusion/battery/thermal.
                Applied when playback ships (Phase 2).
              </div>
            </div>
            <span className="muted small">Default</span>
          </div>
        </div>
      </div>
    </section>
  );
}
