import { defineConfig } from 'vite'

// Bundles the script `npm run docs` runs, which writes the docs pages generated from the app's settings and key
// bindings, into one file Node runs as it is.
export default defineConfig({
  build: {
    ssr: 'src/docs/main.ts',
    outDir: 'out/docs',
    emptyOutDir: true,
    target: 'node24',
    rolldownOptions: {
      output: { entryFileNames: 'main.js' },
    },
  },
})
