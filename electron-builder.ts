import { readFileSync } from 'node:fs'
import type { Configuration } from 'electron-builder'

// The Build the app was just built as, which `npm run build` writes: the version, then the commit.
const versionFile = 'out/main/version'
const [, commit] = readFileSync(versionFile, 'utf8').split('\n')

// The app's Info.plist names the commit under BlindCommit, beside the version macOS shows, and its resources keep the
// version file as `Contents/Resources/version`.
const configuration: Configuration = {
  appId: 'com.diogoleitao.blind',
  productName: 'Blind',
  directories: {
    output: 'dist',
  },
  files: ['out/**', '!out/cli/**'],
  extraResources: [
    { from: 'resources', to: 'resources' },
    { from: 'native/build/Release/window_effects.node', to: 'native/window_effects.node' },
    { from: versionFile, to: 'version' },
  ],
  extraFiles: [
    { from: 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', to: 'MacOS/Blind Spot' },
  ],
  npmRebuild: false,
  protocols: [{ name: 'Blind', schemes: ['blind'] }],
  mac: {
    target: 'dir',
    icon: 'build/icon.icns',
    identity: '-',
    hardenedRuntime: false,
    extendInfo: {
      LSUIElement: true,
      BlindCommit: commit,
    },
  },
}

export default configuration
