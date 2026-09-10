import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Build config for the standalone STT harness at /stt.html.
 *
 * It is a separate build rather than a second entry of the web build so that
 * the harness carries its own assets under /stt/ and cannot share a chunk with
 * the app. That keeps the two independent: the harness can be published beside
 * a build of the client it is not part of, which is how it gets tested before
 * the client change it exercises is merged.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@maskord/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  base: '/stt/',
  build: {
    outDir: 'dist-stt',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'stt.html'),
    },
  },
  define: {
    __WEB_BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
});
