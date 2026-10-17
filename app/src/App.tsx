import { useEffect, useRef, useState } from 'react';
import Sidebar, { NAV, type View } from './components/Sidebar.tsx';
import TopBar from './components/TopBar.tsx';
import Home from './components/Home.tsx';
import Discover from './components/Discover.tsx';
import Library from './components/Library.tsx';
import Displays from './components/Displays.tsx';
import Settings from './components/Settings.tsx';
import { ToastProvider } from './components/Toast.tsx';
import { isTauri } from './lib/api.ts';

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const [view, setView] = useState<View>('home');
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const inTauri = isTauri();

  // Global shortcuts: Cmd+F focus search, Cmd+1..5 jump between views.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.key === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      const index = Number(e.key);
      if (Number.isInteger(index) && index >= 1 && index <= NAV.length) {
        e.preventDefault();
        setView(NAV[index - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!inTauri) {
    return (
      <div className="fatal">
        <h2>Open the Driftwall app window</h2>
        <p className="muted">
          Driftwall’s library lives in the desktop app, not the browser. Launch
          the Driftwall app to manage your wallpapers.
        </p>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar view={view} onNavigate={setView} />
      <div className="main">
        <TopBar query={query} onQuery={setQuery} inputRef={searchRef} />
        <main className="content">
          <div className="content-inner">
            {view === 'home' && (
              <Home query={query} onNavigate={setView} />
            )}
            {view === 'discover' && <Discover query={query} />}
            {view === 'library' && <Library query={query} />}
            {view === 'displays' && <Displays />}
            {view === 'settings' && <Settings />}
          </div>
        </main>
      </div>
    </div>
  );
}
