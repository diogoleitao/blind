import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Where the user dragged the Command Palette: `palette-position.json` in `directory`, holding its position as a fraction
// of the window's height. Apart from the config file, which is the user's, and from the Sessions' state.
export function createPalettePositionFile (directory: string) {
  const path = join(directory, 'palette-position.json')
  return {
    // Undefined when none was saved, or the file can't be read as a position within the window.
    read (): number | undefined {
      try {
        const saved = JSON.parse(readFileSync(path, 'utf8'))
        return typeof saved === 'number' && saved >= 0 && saved <= 1 ? saved : undefined
      } catch {
        return undefined
      }
    },
    save (position: number) {
      try {
        mkdirSync(directory, { recursive: true })
        writeFileSync(path, `${JSON.stringify(position)}\n`)
      } catch (error) {
        console.error(`Couldn't write ${path}:`, error)
      }
    },
    clear () {
      try {
        rmSync(path, { force: true })
      } catch (error) {
        console.error(`Couldn't remove ${path}:`, error)
      }
    },
  }
}
