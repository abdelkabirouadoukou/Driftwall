import { useEffect, useState } from 'react';
import Sidebar, { type View } from './components/Sidebar.tsx';
import Library from './components/Library.tsx';
import Settings from './components/Settings.tsx';
import { initDb } from './lib/db.ts';

export default function App() {
  const [view, setView] = useState<View>('library');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    initDb()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app">
      <Sidebar view={view} onNavigate={setView} />
      <main className="content">
        {error ? (
          <div className="fatal">
            <h2>Database unavailable</h2>
            <p className="muted">{error}</p>
          </div>
        ) : !ready ? (
          <div className="loading">Starting Driftwall…</div>
        ) : view === 'library' ? (
          <Library />
        ) : (
          <Settings />
        )}
      </main>
    </div>
  );
}
