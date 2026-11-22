import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  // Blind Spot is built beside the main process, which starts it from there.
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'blind-spot': resolve('src/blind-spot/main.ts'),
        },
      },
    },
  },
  preload: {},
  renderer: {},
})
