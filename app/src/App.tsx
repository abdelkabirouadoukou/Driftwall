import { useEffect, useRef, useState } from 'react';
import Sidebar, { NAV, type View } from './components/Sidebar.tsx';
import TopBar from './components/TopBar.tsx';
import Home from './components/Home.tsx';
import Discover from './components/Discover.tsx';
import Library from './components/Library.tsx';
import Displays from './components/Displays.tsx';
import Scenes from './components/Scenes.tsx';
import Settings from './components/Settings.tsx';
import MusicView, { MusicProvider } from './components/Music.tsx';
import { DownloadsProvider } from './components/Downloads.tsx';
import { ToastProvider } from './components/Toast.tsx';
import { isTauri } from './lib/api.ts';
import { listen } from '@tauri-apps/api/event';
import { MAIN_SCROLL_ID, bridgeWallpaperEvents, mainScrollElement } from './lib/dom.ts';

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
  const [discoverCategory, setDiscoverCategory] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const inTauri = isTauri();

  // The menu-bar panel (and the Rust rotation timer) talk to this window.
  useEffect(() => {
    const stopBridge = bridgeWallpaperEvents();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (inTauri) {
      void listen<string>('driftwall-navigate', (event) => {
        const target = NAV.find((n) => n.id === event.payload);
        if (target) setView(target.id);
      })
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        })
        .catch(() => undefined);
    }
    return () => {
      disposed = true;
      unlisten?.();
      stopBridge();
    };
  }, [inTauri]);

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

  // The content pane is the only scroll container and neither <body> nor the
  // viewport scrolls, so the browser no longer has a default keyboard scroll
  // target. Map the usual keys onto it, leaving editable/interactive targets
  // (search fields, buttons, links) to their native behaviour. This is what
  // makes Space, PageUp/Down and the arrow keys work in every view.
  useEffect(() => {
    const INTERACTIVE = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A']);
    const SCROLL_KEYS = new Set([
      'PageUp',
      'PageDown',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
      ' ',
    ]);
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!SCROLL_KEYS.has(e.key)) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.isContentEditable || INTERACTIVE.has(active.tagName))) return;

      const scroller = mainScrollElement();
      if (!scroller || scroller.scrollHeight <= scroller.clientHeight) return;

      const prefersReducedMotion = window.matchMedia?.(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      const behavior: ScrollBehavior = prefersReducedMotion ? 'auto' : 'smooth';
      const page = scroller.clientHeight * 0.9;
      const line = 48;

      switch (e.key) {
        case 'PageDown':
          scroller.scrollBy({ top: page, behavior });
          break;
        case 'PageUp':
          scroller.scrollBy({ top: -page, behavior });
          break;
        case 'ArrowDown':
          scroller.scrollBy({ top: line, behavior });
          break;
        case 'ArrowUp':
          scroller.scrollBy({ top: -line, behavior });
          break;
        case ' ':
          scroller.scrollBy({ top: e.shiftKey ? -page : page, behavior });
          break;
        case 'Home':
          scroller.scrollTo({ top: 0, behavior });
          break;
        case 'End':
          scroller.scrollTo({ top: scroller.scrollHeight, behavior });
          break;
        default:
          return;
      }
      e.preventDefault();
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
    <DownloadsProvider onOpenLibrary={() => setView('library')}>
    <MusicProvider showVideo={view === 'music'}>
    <div className="app">
      {/* Draggable areas: the title bar is transparent (overlay style), so the
          top edge and the sidebar header have to move the window themselves. */}
      <div className="drag-top" data-tauri-drag-region />
      <div className="drag-side" data-tauri-drag-region />
      <Sidebar view={view} onNavigate={setView} />
      <div className="main">
        <TopBar query={query} onQuery={setQuery} inputRef={searchRef} />
        <main className="content" id={MAIN_SCROLL_ID}>
          <div className="content-inner">
            {view === 'home' && (
              <Home
                query={query}
                onNavigate={setView}
                onBrowseCategory={(category) => {
                  setDiscoverCategory(category);
                  setView('discover');
                }}
              />
            )}
            {view === 'discover' && (
              <Discover
                query={query}
                category={discoverCategory}
                onCategory={setDiscoverCategory}
                onOpenSettings={() => setView('settings')}
              />
            )}
            {view === 'library' && <Library query={query} />}
            {view === 'scenes' && <Scenes />}
            {view === 'music' && <MusicView />}
            {view === 'displays' && <Displays />}
            {view === 'settings' && <Settings />}
          </div>
        </main>
      </div>
    </div>
    </MusicProvider>
    </DownloadsProvider>
  );
}
