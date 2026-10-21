import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './styles/theme.css';
import App from './App.tsx';
import LivePlayer from './components/LivePlayer.tsx';

/**
 * The Rust engine opens one borderless `wallpaper-<n>` window per display
 * (see `engine::ensure_live_windows`), pointed at this same `index.html`, so
 * that window needs to render the tiny `<LivePlayer>` instead of the full
 * app shell. Guarded for the plain-browser / test environment, where there
 * is no Tauri window to ask.
 */
function isLiveWindow(): boolean {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return false;
  try {
    return getCurrentWindow().label.startsWith('wallpaper');
  } catch {
    return false;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isLiveWindow() ? <LivePlayer /> : <App />}
  </StrictMode>,
);
