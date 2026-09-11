import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Web build config — identical to the Electron renderer build but:
 *  • No Electron plugin (plain browser SPA)
 *  • base: '/app/' so assets resolve correctly under maskord.com/app
 *  • output goes to dist-web/ to avoid clobbering the Electron dist/
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@maskord/shared': path.resolve(__dirname, '../shared/src/index.ts'),
      '@maskord/convex': path.resolve(__dirname, '../../www/convex/_generated/api.js'),
    },
  },
  base: '/app/',
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
  },
  define: {
    __WEB_BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    // app/shared's firebase config falls back to process.env after import.meta.env;
    // the production web build never evaluates that branch, but the dev server does.
    'process.env': {},
  },
});
