import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            sourcemap: true,
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            sourcemap: true,
          },
        },
      },
    }),
  ],
  resolve: {
    alias: {
      '@maskord/shared': path.resolve(__dirname, '../shared/src/index.ts'),
      '@maskord/convex': path.resolve(__dirname, '../../www/convex/_generated/api.js'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
