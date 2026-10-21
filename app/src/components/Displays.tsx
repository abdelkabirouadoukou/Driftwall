import { Monitor } from 'lucide-react';
import EmptyState from './EmptyState.tsx';

/**
 * Displays — the multi-display list, per-display assignment, fill/fit/centre
 * scaling and Restore Original all ship with Stage B (Phase 2 engine).
 */
export default function Displays() {
  return (
    <section aria-label="Displays">
      <header className="page-head">
        <div>
          <h1>Displays</h1>
          <p className="sub">Per-display wallpapers and scaling.</p>
        </div>
      </header>
      <EmptyState
        icon={<Monitor size={22} />}
        title="Display controls arrive with the engine"
        body="Once the wallpaper engine lands you’ll see every connected display here, with per-display wallpaper assignment, scaling modes and a one-click restore of your original desktop picture."
      />
    </section>
  );
}
