import { configSchema, parseConfig, type Settings, unlimitedScrollbackLines } from '../core/config'
import { readJsonc, setJsoncProperty } from '../core/jsonc'
import type { ConfigRead } from '../main/config-file'

// A key pressed: a named one, or the character it types.
export type Key = 'up' | 'down' | 'left' | 'right' | 'enter' | 'escape' | 'backspace' | 'interrupt' | { char: string }

export interface SettingsEditorDependencies {
  // The installed app's config file.
  configFile: {
    path: string;
    // Writes the starter config, leaving an existing file alone; answers whether there's a file afterwards.
    createIfMissing(): boolean;
    read(): ConfigRead;
    // Answers whether the text was written.
    write(text: string): boolean;
  };
  // Every Theme's name, built in and from Theme files, in the order the Command Palette lists them.
  themeNames(): string[];
  // The terminal the editor draws on and reads keys from.
  terminal: {
    // Whether it's a terminal at all, rather than a pipe or a file.
    interactive: boolean;
    keys(): AsyncIterable<Key>;
    // Replaces what the editor last drew.
    draw(lines: string[]): void;
    // Gives the terminal back as it was before the editor drew on it.
    close(): void;
  };
  stdout(text: string): void;
  stderr(text: string): void;
}

// What the editor reads of a setting's schema.
interface SettingSchema {
  description?: string;
  type?: string;
  enum?: readonly unknown[];
  minimum?: number;
  maximum?: number;
  const?: unknown;
  oneOf?: readonly SettingSchema[];
}

// Every setting the editor changes, in its order: all but keyBindings, whose shortcuts are edited in the file. Editors
// read `$schema`, so it's no setting.
export const editableSettings = Object.keys(configSchema.properties).filter(
  (name) => name !== '$schema' && name !== 'keyBindings'
) as Exclude<keyof Settings, 'keyBindings'>[]

type EditableSetting = (typeof editableSettings)[number]

const unreadable = "config.jsonc couldn't be read as JSON with comments; fix it with blind settings open"

// The values a setting is picked from with left and right, or undefined for one whose value is typed. The theme
// setting's are the Themes there are.
function choicesOf (name: EditableSetting, themeNames: readonly string[]): readonly unknown[] | undefined {
  const schema: SettingSchema = configSchema.properties[name]
  if (name === 'theme') return themeNames
  if (schema.enum) return schema.enum
  if (schema.type === 'boolean') return [true, false]
  return undefined
}

// The value `typed` gives the setting, or why it can't take it. A whole number takes the schema's range, and the words
// it allows besides, such as scrollbackLines' unlimited; anything else takes any text but none.
function typedValue (name: EditableSetting, typed: string): { value: unknown } | { refusal: string } {
  const schema: SettingSchema = configSchema.properties[name]
  const range = [schema, ...(schema.oneOf ?? [])].find((part) => part.type === 'integer')
  const text = typed.trim()
  if (!range) return text === '' ? { refusal: `${name} can't be empty; remove it with blind settings open` } : { value: text }
  const words = (schema.oneOf ?? []).flatMap((part) => (typeof part.const === 'string' ? [part.const] : []))
  if (words.includes(text)) return { value: text }
  const number = /^\d+$/.test(text) ? Number(text) : NaN
  if (number >= range.minimum! && number <= range.maximum!) return { value: number }
  const besides = words.map((word) => ` or ${word}`).join('')
  return { refusal: `${name} takes a whole number from ${range.minimum} to ${range.maximum}${besides}` }
}

// The config file's text as it is on disk, or why it can't be edited: undefined when the file couldn't be read, which
// the file reports itself. A file that isn't JSON with comments is left to be fixed by hand rather than written over.
function readEditable (configFile: SettingsEditorDependencies['configFile']): { text: string } | { problem?: string } {
  const read = configFile.read()
  if (!read.readable || read.text === undefined) return {}
  if (readJsonc(read.text) === undefined) return { problem: unreadable }
  return { text: read.text }
}

function isChar (key: Key, char: string) {
  return typeof key === 'object' && key.char === char
}

// Edits the settings interactively, resolving to the exit code. Each change is written onto the config file as it is on
// disk, so what changed there meanwhile stays, and a running Blind applies it at once. A value the file gets wrong
// shows as the default in effect, marked. The settings whose values differ from when the editor opened are highlighted,
// and listed on quitting.
export async function editSettings (deps: SettingsEditorDependencies): Promise<number> {
  const { configFile, themeNames, terminal, stdout, stderr } = deps
  if (!terminal.interactive) {
    stderr('blind settings needs a terminal; blind settings open opens the file instead\n')
    return 1
  }
  // Reports its own failure.
  if (!configFile.createIfMissing()) return 1
  const initial = readEditable(configFile)
  if (!('text' in initial)) {
    if (initial.problem) stderr(`${initial.problem}\n`)
    return 1
  }
  const themes = themeNames()
  let { settings, rejected } = parseConfig(initial.text, themes)!
  let selected = 0
  // What's typed for the selected setting, while its value is being typed.
  let typing: string | undefined
  // Why the last change wasn't made, until the next key.
  let refusal: string | undefined

  function show (text: string) {
    const parsed = parseConfig(text, themes)!
    settings = parsed.settings
    rejected = parsed.rejected
  }

  function write (name: EditableSetting, value: unknown) {
    const current = readEditable(configFile)
    if (!('text' in current)) {
      refusal = current.problem ?? "Couldn't read config.jsonc"
      return
    }
    const text = setJsoncProperty(current.text, name, value)
    if (configFile.write(text)) {
      show(text)
    } else {
      refusal = "Couldn't save config.jsonc"
      show(current.text)
    }
  }

  // Steps the selected setting's value through its choices by `step`, going round at either end.
  function pick (step: number) {
    const name = editableSettings[selected]
    const choices = choicesOf(name, themes)
    if (!choices) return
    const index = choices.indexOf(settings[name])
    write(name, choices[(index + step + choices.length) % choices.length])
  }

  function pressWhileTyping (key: Key, typed: string) {
    if (key === 'escape') typing = undefined
    else if (key === 'backspace') typing = typed.slice(0, -1)
    else if (typeof key === 'object') typing = typed + key.char
    else if (key === 'enter') {
      typing = undefined
      const result = typedValue(editableSettings[selected], typed)
      if ('value' in result) write(editableSettings[selected], result.value)
      else refusal = result.refusal
    }
  }

  // Shows the file as it is on disk first, so a value picked steps from what's there now.
  function press (key: Key) {
    refusal = undefined
    const current = readEditable(configFile)
    if ('text' in current) show(current.text)
    if (typing !== undefined) pressWhileTyping(key, typing)
    else if (key === 'down') selected = Math.min(selected + 1, editableSettings.length - 1)
    else if (key === 'up') selected = Math.max(selected - 1, 0)
    else if (key === 'right' || isChar(key, ' ')) pick(1)
    else if (key === 'left') pick(-1)
    else if (key === 'enter' && !choicesOf(editableSettings[selected], themes)) typing = ''
  }

  function valueOf (name: EditableSetting) {
    const value = settings[name]
    if (name === 'shell' && value === undefined) return 'login shell'
    if (name === 'scrollbackLines' && value === unlimitedScrollbackLines) return 'unlimited'
    return String(value)
  }

  // Each setting's value as the editor opened, to tell what's changed since.
  const opening = new Map(editableSettings.map((name) => [name, valueOf(name)]))

  function changed (name: EditableSetting) {
    return valueOf(name) !== opening.get(name)
  }

  function shownValue (name: EditableSetting) {
    const invalid = rejected.includes(name) ? '  (invalid in config.jsonc)' : ''
    return `${valueOf(name)}${invalid}${changed(name) ? ' *' : ''}`
  }

  // The settings, a changed one in bold and the Theme's yellow, as a font without a bold face shows bold as it shows
  // the rest; then the selected one's description, then why a change wasn't made or the keys to press.
  function draw () {
    const width = Math.max(...editableSettings.map((name) => name.length))
    const rows = editableSettings.map((name, index) => {
      const value = index === selected && typing !== undefined ? `${typing}▏` : shownValue(name)
      const row = `${index === selected ? '›' : ' '} ${name.padEnd(width)}  ${value}`
      return changed(name) ? `\x1b[1;33m${row}\x1b[22;39m` : row
    })
    const description: SettingSchema = configSchema.properties[editableSettings[selected]]
    const keys = typing === undefined
      ? '↑↓ move  ←→ change  enter type a value  q quit'
      : 'enter save  escape leave as it was'
    terminal.draw([...rows, '', description.description ?? '', '', refusal ?? keys])
  }

  // Quitting goes first, so Ctrl+C quits even while a value's being typed.
  function quits (key: Key) {
    return key === 'interrupt' || (typing === undefined && (key === 'escape' || isChar(key, 'q')))
  }

  try {
    draw()
    for await (const key of terminal.keys()) {
      if (quits(key)) break
      press(key)
      draw()
    }
  } finally {
    terminal.close()
  }
  // After the terminal's given back, so the list stays on the shell's screen.
  for (const name of editableSettings.filter(changed)) stdout(`${name}: ${opening.get(name)} → ${valueOf(name)}\n`)
  return 0
}
