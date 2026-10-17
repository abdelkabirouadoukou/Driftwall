import { useState } from 'react';
import Sidebar, { type View } from './components/Sidebar.tsx';
import Library from './components/Library.tsx';
import Settings from './components/Settings.tsx';
import { isTauri } from './lib/api.ts';

export default function App() {
  const [view, setView] = useState<View>('library');
  const inTauri = isTauri();

  return (
    <div className="app">
      <Sidebar view={view} onNavigate={setView} />
      <main className="content">
        {!inTauri ? (
          <div className="fatal">
            <h2>Open the Driftwall app window</h2>
            <p className="muted">
              Driftwall’s library lives in the desktop app, not the browser.
              Launch the Driftwall app to manage your wallpapers.
            </p>
          </div>
        ) : view === 'library' ? (
          <Library />
        ) : (
          <Settings />
        )}
      </main>
    </div>
  );
}
