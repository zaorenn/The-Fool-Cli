/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',

  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    sourcemap: false,
    minify: true,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },

  server: {
    port: 3001,
  },

  resolve: {
    alias: {
      '@': resolve(__dirname, '../src'),
      '@/common': resolve(__dirname, '../src/common'),
      '@/process': resolve(__dirname, '../src/process'),
      '@/renderer': resolve(__dirname, '../src/renderer'),
      '@/preload': resolve(__dirname, '../src/preload'),
    },
  },

  optimizeDeps: {
    exclude: ['electron'],
  },
});
