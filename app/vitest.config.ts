import { defineConfig } from 'vitest/config';

// Unit tests cover pure logic (manifest validation, media classification,
// library helpers) so they run in a plain Node environment with no Tauri or DOM.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
