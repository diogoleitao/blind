import { mkdirSync, readdirSync, readFileSync, watch, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type ThemeFile, themeSchema, themeSchemaFileName } from '../core/themes'

// How long after a change the folder is read, so an editor's burst of writes for one save is read once.
const settleDelayMilliseconds = 100

const themeFileExtension = '.jsonc'

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
