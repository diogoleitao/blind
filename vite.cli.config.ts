import { defineConfig } from 'vite'

// Bundles the `blind` command, with the app's modules it reuses, such as the config file, into one file Node runs as it
// is.
export default defineConfig({
  build: {
    ssr: 'src/cli/main.ts',
    outDir: 'out/cli',
    emptyOutDir: true,
    target: 'node24',
    rolldownOptions: {
      output: { entryFileNames: 'main.js' },
    },
  },
})
