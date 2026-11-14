import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Versions } from '../core/blur-warning'

// Where "Don't show again" on the blur-unavailable pop-up is kept: `blur-warning.json` in `directory`, holding the
// versions it was chosen on. Apart from the config file, which is the user's, and from the Sessions' state.
export function createBlurWarningFile (directory: string) {
  const path = join(directory, 'blur-warning.json')
  return {
    // Undefined when it was never chosen, or the file can't be read as versions.
    dismissedFor (): Versions | undefined {
      try {
        const saved = JSON.parse(readFileSync(path, 'utf8'))
        return typeof saved?.app === 'string' && typeof saved?.os === 'string' ? { app: saved.app, os: saved.os } : undefined
      } catch {
        return undefined
      }
    },
    dismiss (versions: Versions) {
      try {
        mkdirSync(directory, { recursive: true })
        writeFileSync(path, `${JSON.stringify(versions)}\n`)
      } catch (error) {
        console.error(`Couldn't write ${path}:`, error)
      }
    },
  }
}
