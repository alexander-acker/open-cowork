import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import { resolve } from 'path';
import { builtinModules } from 'module';

// Node built-in modules must be external for Electron main process
const nodeBuiltins = builtinModules.flatMap(m => [m, `node:${m}`]);

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main/index.ts',
        onstart(args) {
          // Remove ELECTRON_RUN_AS_NODE so Electron starts as a real
          // Electron app instead of plain Node.js (the var may be
          // inherited from VSCode / Claude Code shells).
          const env = { ...process.env };
          delete env.ELECTRON_RUN_AS_NODE;
          args.startup(['.', '--no-sandbox'], { env });
        },
        vite: {
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              external: [
                ...nodeBuiltins,
                'better-sqlite3',
                'bufferutil',
                'utf-8-validate',
                'electron',
              ],
              output: {
                // Ensure consistent interop for CJS/ESM
                interop: 'auto',
              },
            },
          },
        },
      },
      {
        entry: 'src/preload/index.ts',
        onstart(args) {
          args.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron/preload',
          },
        },
      },
    ]),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@main': resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});

