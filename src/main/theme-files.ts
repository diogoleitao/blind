import { mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ThemeSource } from '../core/theme-import'
import { type ThemeFile, themeSchema, themeSchemaFileName } from '../core/themes'

// How long after a change the folder is read, so an editor's burst of writes for one save is read once.
const settleDelayMilliseconds = 100

const themeFileExtension = '.jsonc'

// Far larger than any theme file, so a file past it, e.g. a video picked by mistake, isn't read into memory.
const largestThemeSourceBytes = 1024 * 1024

// The file picked to Import a Theme from, with no text when it can't be read or is too large to be a theme.
export function readThemeSource (path: string): ThemeSource {
  const fileName = basename(path)
  try {
    if (statSync(path).size > largestThemeSourceBytes) return { fileName, text: undefined }
    return { fileName, text: readFileSync(path, 'utf8') }
  } catch {
    return { fileName, text: undefined }
  }
}

// The Theme files `*.jsonc` in `directory`, with the Theme schema written next to them.
export function createThemeFiles (directory: string) {
  // Every Theme file that could be read. Without the folder there are none.
  function read (): ThemeFile[] {
    let fileNames: string[]
    try {
      fileNames = readdirSync(directory).filter((fileName) => fileName.endsWith(themeFileExtension))
    } catch {
      return []
    }
    return fileNames.flatMap((fileName) => {
      try {
        return [{ fileName, text: readFileSync(join(directory, fileName), 'utf8') }]
      } catch (error) {
        console.error(`Couldn't read the Theme file ${join(directory, fileName)}:`, error)
        return []
      }
    })
  }

  return {
    read,
    // A new Theme file, made with the folder if need be. Never written over one already there, which answers false, as
    // does any other failure.
    write (fileName: string, text: string) {
      try {
        mkdirSync(directory, { recursive: true })
        writeFileSync(join(directory, fileName), text, { flag: 'wx' })
        return true
      } catch (error) {
        console.error(`Couldn't write the Theme file ${join(directory, fileName)}:`, error)
        return false
      }
    },
    // Written on every launch, making the folder too, so editors follow the Themes of the version that's running.
    writeSchema () {
      try {
        mkdirSync(directory, { recursive: true })
        writeFileSync(join(directory, themeSchemaFileName), `${JSON.stringify(themeSchema, null, 2)}\n`)
      } catch (error) {
        console.error(`Couldn't write the Theme schema to ${directory}:`, error)
      }
    },
    watch (onChange: (files: ThemeFile[]) => void) {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        watch(directory, (_event, fileName) => {
          if (fileName !== null && !fileName.endsWith(themeFileExtension)) return
          clearTimeout(timer)
          timer = setTimeout(() => onChange(read()), settleDelayMilliseconds)
        }).on('error', (error) => console.error(`Stopped watching ${directory} for Theme changes:`, error))
      } catch (error) {
        console.error(`Couldn't watch ${directory} for Theme changes:`, error)
      }
    },
  }
}
