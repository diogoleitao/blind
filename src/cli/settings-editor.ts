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

// What the editor reads of a setting's schema, or of a group's.
interface SettingSchema {
  description?: string;
  type?: string | readonly string[];
  enum?: readonly unknown[];
  minimum?: number;
  maximum?: number;
  const?: unknown;
  oneOf?: readonly SettingSchema[];
  properties?: Record<string, SettingSchema>;
}

const topLevelSchemas = configSchema.properties as Record<string, SettingSchema>

// Every setting the editor changes, in its order: all but keyBindings, whose shortcuts are edited in the file. A setting
// in a group goes by its group's name and its own, joined by a dot, such as `pane.scrollBar`. Editors read `$schema`, so
// it's no setting.
export const editableSettings = Object.entries(topLevelSchemas).flatMap(([name, schema]) => {
  if (name === '$schema' || name === 'keyBindings') return []
  return schema.properties ? Object.keys(schema.properties).map((key) => `${name}.${key}`) : [name]
})

// The setting's group and its name within it, or its name alone for one in no group.
function pathOf (name: string): [group: string | undefined, key: string] {
  const [first, key] = name.split('.')
  return key === undefined ? [undefined, first] : [first, key]
}

function schemaOf (name: string): SettingSchema {
  const [group, key] = pathOf(name)
  return group === undefined ? topLevelSchemas[key] : topLevelSchemas[group].properties![key]
}

function settingIn (settings: Settings, name: string): unknown {
  const [group, key] = pathOf(name)
  if (group === undefined) return settings[key as keyof Settings]
  return (settings[group as keyof Settings] as Record<string, unknown>)[key]
}

const unreadable = "config.jsonc couldn't be read as JSON with comments; fix it with blind settings open"

// The values a setting is picked from with left and right, or undefined for one whose value is typed. The theme
// setting's are the Themes there are.
function choicesOf (name: string, themeNames: readonly string[]): readonly unknown[] | undefined {
  const schema = schemaOf(name)
  if (name === 'theme') return themeNames
  if (schema.enum) return schema.enum
  if (schema.type === 'boolean') return [true, false]
  return undefined
}

// The value `typed` gives the setting, or why it can't take it. A whole number takes the schema's range, and the words
// it allows besides, such as pane.scrollbackLines' unlimited; anything else takes any text but none.
function typedValue (name: string, typed: string): { value: unknown } | { refusal: string } {
  const schema = schemaOf(name)
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

// Edits the settings interactively, resolving to the exit code. The changes are kept until q or escape saves them on
// quitting, written onto the config file as it is on disk then, so what changed there meanwhile stays, and a running
// Blind applies them all at once; Ctrl+C quits without saving them. A value the file gets wrong shows as the default in
// effect, marked. The settings whose values differ from when the editor opened are highlighted, and listed on quitting.
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
  // Each setting's value as the editor opened, to tell what's changed since.
  const openingValues = new Map(editableSettings.map((name) => [name, settingIn(settings, name)]))
  // The file's text as last read, which the changes not yet saved are shown on.
  let onDisk = initial.text
  // The changes not yet saved: each setting's value in the editor, unless it's the value both when the editor opened
  // and on disk.
  const pending = new Map<string, unknown>()
  let selected = 0
  // What's typed for the selected setting, while its value is being typed.
  let typing: string | undefined
  // Why the last change wasn't made, until the next key.
  let refusal: string | undefined

  // The settings with changes not yet saved, in the editor's order.
  function pendingNames () {
    return editableSettings.filter((name) => pending.has(name))
  }

  // `text` with the changes not yet saved written onto it.
  function withPending (text: string) {
    return pendingNames().reduce((written, name) => {
      const [group, key] = pathOf(name)
      return setJsoncProperty(written, group === undefined ? key : [group, key], pending.get(name))
    }, text)
  }

  function show () {
    const parsed = parseConfig(withPending(onDisk), themes)!
    settings = parsed.settings
    rejected = parsed.rejected
  }

  // A setting changed back to its value when the editor opened has no change left to save, unless the file changed it
  // meanwhile.
  function change (name: string, value: unknown) {
    const unchanged = value === openingValues.get(name) && value === settingIn(parseConfig(onDisk, themes)!.settings, name)
    if (unchanged) pending.delete(name)
    else pending.set(name, value)
    show()
  }

  // Writes the changes not yet saved onto the file as it is on disk now, so what changed there meanwhile stays.
  // Answers why they couldn't be, if they couldn't.
  function save (): string | undefined {
    if (pending.size === 0) return
    const current = readEditable(configFile)
    if (!('text' in current)) return current.problem ?? "Couldn't read config.jsonc"
    const text = withPending(current.text)
    if (!configFile.write(text)) return "Couldn't save config.jsonc"
    onDisk = text
    pending.clear()
    show()
  }

  // Steps the selected setting's value through its choices by `step`, going round at either end.
  function pick (step: number) {
    const name = editableSettings[selected]
    const choices = choicesOf(name, themes)
    if (!choices) return
    const index = choices.indexOf(settingIn(settings, name))
    change(name, choices[(index + step + choices.length) % choices.length])
  }

  function pressWhileTyping (key: Key, typed: string) {
    if (key === 'escape') typing = undefined
    else if (key === 'backspace') typing = typed.slice(0, -1)
    else if (typeof key === 'object') typing = typed + key.char
    else if (key === 'enter') {
      typing = undefined
      const result = typedValue(editableSettings[selected], typed)
      if ('value' in result) change(editableSettings[selected], result.value)
      else refusal = result.refusal
    }
  }

  // Shows the file as it is on disk first, with the changes not yet saved on it, so a value picked steps from what's
  // there now.
  function press (key: Key) {
    refusal = undefined
    const current = readEditable(configFile)
    if ('text' in current) onDisk = current.text
    show()
    if (typing !== undefined) pressWhileTyping(key, typing)
    else if (key === 'down') selected = Math.min(selected + 1, editableSettings.length - 1)
    else if (key === 'up') selected = Math.max(selected - 1, 0)
    else if (key === 'right' || isChar(key, ' ')) pick(1)
    else if (key === 'left') pick(-1)
    else if (key === 'enter' && !choicesOf(editableSettings[selected], themes)) typing = ''
  }

  function valueOf (name: string) {
    const value = settingIn(settings, name)
    if (name === 'shell' && value === undefined) return 'login shell'
    if (name === 'pane.scrollbackLines' && value === unlimitedScrollbackLines) return 'unlimited'
    return String(value)
  }

  // Each setting's value as the editor opened, as shown, for listing what's changed since.
  const opening = new Map(editableSettings.map((name) => [name, valueOf(name)]))

  function changed (name: string) {
    return settingIn(settings, name) !== openingValues.get(name)
  }

  // A setting is invalid when the file gets it wrong, or gets its whole group wrong.
  function shownValue (name: string) {
    const [group] = pathOf(name)
    const invalid = rejected.includes(name) || (group !== undefined && rejected.includes(group))
    return `${valueOf(name)}${invalid ? '  (invalid in config.jsonc)' : ''}${changed(name) ? ' *' : ''}`
  }

  // A setting in a group by its name within it, indented under the group's heading.
  function label (name: string) {
    const [group, key] = pathOf(name)
    return group === undefined ? key : `  ${key}`
  }

  // The settings, each group's under a heading of its name, which the selection passes over; a changed one in bold and
  // the Theme's yellow, as a font without a bold face shows bold as it shows the rest. Then the selected one's
  // description, then why a change wasn't made or the keys to press.
  function draw () {
    const width = Math.max(...editableSettings.map((name) => label(name).length))
    const rows = editableSettings.flatMap((name, index) => {
      const [group] = pathOf(name)
      const heading = group !== undefined && group !== pathOf(editableSettings[index - 1] ?? '')[0] ? [`  ${group}`] : []
      const value = index === selected && typing !== undefined ? `${typing}▏` : shownValue(name)
      const row = `${index === selected ? '›' : ' '} ${label(name).padEnd(width)}  ${value}`
      return [...heading, changed(name) ? `\x1b[1;33m${row}\x1b[22;39m` : row]
    })
    const keys = typing === undefined
      ? '↑↓ move  ←→ change  enter type a value  q save and quit  ctrl+c quit without saving'
      : 'enter save  escape leave as it was'
    terminal.draw([...rows, '', schemaOf(editableSettings[selected]).description ?? '', '', refusal ?? keys])
  }

  function saves (key: Key) {
    return typing === undefined && (key === 'escape' || isChar(key, 'q'))
  }

  function list (names: string[]) {
    return names.map((name) => `${name}: ${opening.get(name)} → ${valueOf(name)}\n`).join('')
  }

  let saving = false
  try {
    draw()
    // Quitting goes first, so Ctrl+C quits even while a value's being typed. Keys running out quit without saving too.
    for await (const key of terminal.keys()) {
      if (key === 'interrupt') break
      if (saves(key)) {
        saving = true
        break
      }
      press(key)
      draw()
    }
  } finally {
    terminal.close()
  }
  // After the terminal's given back, so the list stays on the shell's screen.
  const unsaved = pendingNames()
  if (!saving) {
    if (unsaved.length > 0) stdout(`Discarded:\n${list(unsaved)}`)
    return 0
  }
  const problem = save()
  if (problem) {
    stderr(`${problem}\nUnsaved:\n${list(unsaved)}`)
    return 1
  }
  stdout(list(editableSettings.filter(changed)))
  return 0
}
