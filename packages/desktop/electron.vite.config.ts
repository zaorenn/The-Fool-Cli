/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/main.ts'),
        external: ['electron'],
        onwarn: () => {},
      },
    },
  },

  preload: {
    build: {
      rollupOptions: {
        input: './preload/index.ts',
      },
    },
  },

  renderer: {
    entry: resolve(__dirname, '../src/renderer/index.tsx'),
    plugins: [],
    build: {
      rollupOptions: {
        external: ['electron'],
      },
    },
  },

  optimizeDeps: {
    exclude: ['electron', 'vue-demi', '@vueuse/shared'],
  },
})
