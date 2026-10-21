import { useCallback, useEffect, useState } from 'react';
import { MonitorPlay } from 'lucide-react';
import SceneCanvas from './SceneCanvas.tsx';
import { useToast } from './Toast.tsx';
import * as api from '../lib/api.ts';
import { WALLPAPER_CHANGED_EVENT, notifyWallpaperChanged } from '../lib/dom.ts';
import { SCENES, sceneIdFromCurrent } from '../lib/scenes.ts';

/**
 * Built-in animated wallpapers. They are drawn in code, so there is nothing to
 * download and no account or key. Previews only animate while hovered, which
 * keeps this page cheap on battery.
 */
export default function Scenes() {
  const { toast } = useToast();
  const [currentScene, setCurrentScene] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const status = await api.engineStatus();
      setCurrentScene(sceneIdFromCurrent(status.current_id));
    } catch {
      setCurrentScene(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    window.addEventListener(WALLPAPER_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(WALLPAPER_CHANGED_EVENT, refresh);
  }, [refresh]);

  const apply = async (id: string, name: string) => {
    try {
      await api.wallpaperApplyScene(id);
      toast(`${name} is now your wallpaper.`);
      notifyWallpaperChanged();
      await refresh();
    } catch (error) {
      toast(`Could not start ${name}: ${String(error)}`, 'error');
    }
  };

  return (
    <section aria-label="Scenes">
      <header className="page-head">
        <div>
          <h1>Scenes</h1>
          <p className="sub">Built-in animated wallpapers. No downloads, no keys.</p>
        </div>
      </header>

      <ul className="grid">
        {SCENES.map((scene) => (
          <li
            key={scene.id}
            className={currentScene === scene.id ? 'scene-card current' : 'scene-card'}
            onMouseEnter={() => setHoverId(scene.id)}
            onMouseLeave={() => setHoverId((h) => (h === scene.id ? null : h))}
          >
            <SceneCanvas sceneId={scene.id} fps={15} playing={hoverId === scene.id} />
            <div className="scene-meta">
              <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                <strong>{scene.name}</strong>
                <span className="muted small">{scene.description}</span>
              </div>
              {currentScene === scene.id ? (
                <span className="current-pill">Current</span>
              ) : (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void apply(scene.id, scene.name)}
                >
                  <MonitorPlay size={14} aria-hidden="true" />
                  <span>Set</span>
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
