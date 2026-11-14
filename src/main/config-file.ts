import { mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { configSchema, configSchemaFileName, starterConfig } from '../core/config'

// How long after a change the file is read, so an editor's burst of writes for one save is read once.
const settleDelayMilliseconds = 100

const configFileName = 'config.jsonc'

function errorCode (error: unknown) {
  return (error as NodeJS.ErrnoException).code
}

// The file's text, undefined without a file; or a file that exists but couldn't be opened, e.g. for lack of permission.
export type ConfigRead = { readable: true; text: string | undefined } | { readable: false }

// The config file `config.jsonc` in `directory`, with its JSON schema written next to it.
export function createConfigFile (directory: string) {
  const path = join(directory, configFileName)
  // What was last read, to report only real changes.
  let lastRead: ConfigRead | undefined

  function read (): ConfigRead {
    try {
      lastRead = { readable: true, text: readFileSync(path, 'utf8') }
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        lastRead = { readable: true, text: undefined }
      } else {
        console.error(`Couldn't read the config file ${path}:`, error)
        lastRead = { readable: false }
      }
    }
    return lastRead
  }

  function changedSince (previous: ConfigRead | undefined, current: ConfigRead) {
    if (!previous || previous.readable !== current.readable) return true
    return current.readable && previous.readable && current.text !== previous.text
  }

  return {
    path,
    read,
    // Written on every launch, so editors follow the settings of the version that's running.
    writeSchema () {
      try {
        mkdirSync(directory, { recursive: true })
        writeFileSync(join(directory, configSchemaFileName), `${JSON.stringify(configSchema, null, 2)}\n`)
      } catch (error) {
        console.error(`Couldn't write the config schema to ${directory}:`, error)
      }
    },
    // Taken as read, since the core already holds the settings it wrote.
    write (text: string) {
      try {
        mkdirSync(directory, { recursive: true })
        writeFileSync(path, text)
        lastRead = { readable: true, text }
      } catch (error) {
        console.error(`Couldn't write the config file ${path}:`, error)
      }
    },
    // Leaves an existing file alone. Answers whether there's a file afterwards. The directory is made apart from the
    // file, as making it also fails with EEXIST when a file stands in its place.
    createIfMissing () {
      try {
        mkdirSync(directory, { recursive: true })
      } catch (error) {
        console.error(`Couldn't create ${directory}:`, error)
        return false
      }
      try {
        writeFileSync(path, starterConfig, { flag: 'wx' })
        return true
      } catch (error) {
        if (errorCode(error) === 'EEXIST') return true
        console.error(`Couldn't create ${path}:`, error)
        return false
      }
    },
    // Watches the directory rather than the file, since editors often save by replacing the file.
    watch (onChange: (read: ConfigRead) => void) {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        watch(directory, (_event, fileName) => {
          if (fileName !== null && fileName !== configFileName) return
          clearTimeout(timer)
          timer = setTimeout(() => {
            const previous = lastRead
            const current = read()
            if (changedSince(previous, current)) onChange(current)
          }, settleDelayMilliseconds)
        }).on('error', (error) => console.error(`Stopped watching ${directory} for config changes:`, error))
      } catch (error) {
        console.error(`Couldn't watch ${directory} for config changes:`, error)
      }
    },
  }
}
