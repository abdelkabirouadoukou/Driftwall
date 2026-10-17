import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Driftwall runs on macOS 12's WebKit, so we target Safari 15 output.
// Tauri's dev server and the macOS WebView expect a fixed port.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    target: 'safari15',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
