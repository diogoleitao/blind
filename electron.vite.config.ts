import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Build } from './src/core/ports'

// The Build is read as the build starts: the version from package.json and the commit git has checked out. A dev run
// is marked, as it may hold changes not yet committed.
function readBuild (dev: boolean): Build {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  return dev ? { version, commit, dev: true } : { version, commit }
}

export default defineConfig(({ command }) => {
  const build = readBuild(command === 'serve')
  return {
    // Blind Spot is built beside the main process, which starts it from there. Both carry the Build. A build that isn't
    // a dev run also writes it to `out/main/version`, the version on the first line and the commit on the second, which
    // packaging puts in the app's resources.
    main: {
      define: { __BLIND_BUILD__: JSON.stringify(build) },
      plugins: command === 'build'
        ? [{
            name: 'blind-version-file',
            generateBundle () {
              this.emitFile({ type: 'asset', fileName: 'version', source: `${build.version}\n${build.commit}\n` })
            },
          }]
        : [],
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
  }
})
