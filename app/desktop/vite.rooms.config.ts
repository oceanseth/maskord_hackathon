import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Build config for the agent game rooms: /wizard.html and /wizardmap.html (the
 * D&D table and its map), /debate.html and /debatestats.html (the debate and
 * its second screen).
 *
 * Like the STT harness this is a separate build from the client, so the pages
 * carry their own assets under /rooms/ and never share a chunk with
 * /app/index.html — the client everyone loads stays byte-for-byte what main
 * built, and the rooms can be published beside it from another commit.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@maskord/shared': path.resolve(__dirname, '../shared/src/index.ts'),
      '@maskord/convex': path.resolve(__dirname, '../../www/convex/_generated/api.js'),
    },
  },
  base: '/rooms/',
  build: {
    outDir: 'dist-rooms',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        wizard: path.resolve(__dirname, 'wizard.html'),
        wizardmap: path.resolve(__dirname, 'wizardmap.html'),
        debate: path.resolve(__dirname, 'debate.html'),
        debatestats: path.resolve(__dirname, 'debatestats.html'),
      },
    },
  },
  define: {
    __WEB_BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
});
