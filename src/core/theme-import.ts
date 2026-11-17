import { convertedColour, displayP3, genericRgb, mixColours, opaque, rgbColour } from './colours'
import { readJsonc } from './jsonc'
import {
  type ChromeColours,
  type Colour,
  defaultTheme,
  type TerminalColours,
  type Theme,
  themeSchemaFileName,
} from './themes'

// A file in which another terminal keeps its colours, picked for Import: its name, and its text, or undefined when it
// couldn't be read.
export interface ThemeSource {
  fileName: string;
  text: string | undefined;
}

// What the Import checks a new Theme file against: every Theme's name, built in or not; the file each Theme file's
// Theme came from, by the Theme's name; and the name of every file in the themes folder.
export interface ThemeImportTarget {
  themeNames: readonly string[];
  fileNamesByTheme: Readonly<Record<string, string>>;
  fileNames: readonly string[];
}

// Why an Import is refused: the file is in none of the formats, or holds no colours of one, such as a Windows Terminal
// `settings.json`; or it leaves out colours the rest are drawn from, named as the file names them, e.g. `color8`; or
// another Theme has its name, ignoring case, with the Theme file it came from unless it's built in; or the themes
// folder already has a file by the new one's name, ignoring case, as macOS does.
export type ThemeImportRefusal =
  | { reason: 'unreadable' }
  | { reason: 'missingColours'; missing: readonly string[] }
  | { reason: 'nameTaken'; takenBy: string; themeFile?: string }
  | { reason: 'fileTaken'; existingFile: string }

// A Theme file ready to be saved: the Theme, its name, and the file's name and text.
export interface ReadyThemeImport {
  type: 'ready';
  name: string;
  fileName: string;
  text: string;
  theme: Theme;
}

// The Import refused, with the name of the file picked and of the Theme it would have made.
export type RefusedThemeImport = { type: 'refused'; sourceFileName: string; name: string } & ThemeImportRefusal

export type ThemeImport = ReadyThemeImport | RefusedThemeImport

// The 16 ANSI colours, in order: `color0` to `color15`, as other terminals number them.
export const ansiColourNames = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const

// The colours a file must set, since the rest are drawn from them.
const requiredColours: (keyof TerminalColours)[] = ['foreground', 'background', ...ansiColourNames]

// A format the Import reads: whether a text is in it, the colour settings the text holds, each by the format's own name
// and with its value as written, and blind's colour for each of those names.
interface SourceFormat {
  holds(text: string): boolean;
  settings(text: string): Iterable<[name: string, value: string]>;
  colourNames: Readonly<Record<string, keyof TerminalColours>>;
}

// The `key = value` lines of the text, comments and blank lines skipped, with any quotes around the value taken off.
function * settingLines (text: string, separator: RegExp): Generator<[string, string]> {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const match = separator.exec(trimmed)
    if (!match) continue
    const value = trimmed.slice(match.index + match[0].length).trim().replace(/^(["'])(.*)\1$/, '$2')
    yield [trimmed.slice(0, match.index).trim(), value]
  }
}

// An `.itermcolors` plist: a dict of colours, each a dict of its red, green and blue components from 0 to 1, and the
// colour space they're in: sRGB, P3, or, for any other `Color Space` or none, Generic RGB, as iTerm2 reads them. Read
// token by token, since the plist holds nothing deeper, each colour given as `#rrggbb` in sRGB.
const itermcolors: SourceFormat = {
  holds: (text) => /^\s*(<\?xml|<!DOCTYPE plist|<plist)/.test(text),
  * settings (text) {
    const colourDicts = new Map<string, Map<string, string>>()
    let depth = 0
    let key: string | undefined
    let colourDict: Map<string, string> | undefined
    for (const token of text.matchAll(/<key>([^<]*)<\/key>|<(dict)>|<\/(dict)>|<(real|integer|string)>([^<]*)<\/\4>/g)) {
      const [, tokenKey, opening, closing, , value] = token
      if (tokenKey !== undefined) {
        key = tokenKey
        continue
      }
      if (opening) {
        depth += 1
        if (depth === 2 && key !== undefined) {
          colourDict = new Map()
          colourDicts.set(key, colourDict)
        }
      } else if (closing) {
        if (depth === 2) colourDict = undefined
        depth -= 1
      } else if (colourDict && key !== undefined) {
        colourDict.set(key, value)
      }
      key = undefined
    }
    for (const [name, components] of colourDicts) {
      const channels = ['Red Component', 'Green Component', 'Blue Component'].map((channel) =>
        Number.parseFloat(components.get(channel) ?? '')
      )
      if (!channels.every(Number.isFinite)) continue
      const colourSpace = components.get('Color Space')
      if (colourSpace === 'sRGB') {
        const [red, green, blue] = channels.map((value) => Math.min(1, Math.max(0, value)) * 255)
        yield [name, rgbColour(red, green, blue)]
      } else {
        yield [name, convertedColour(channels, colourSpace === 'P3' ? displayP3 : genericRgb)]
      }
    }
  },
  colourNames: {
    'Foreground Color': 'foreground',
    'Background Color': 'background',
    'Cursor Color': 'cursor',
    'Cursor Text Color': 'cursorText',
    'Selection Color': 'selection',
    'Selected Text Color': 'selectionText',
    ...Object.fromEntries(ansiColourNames.map((name, index) => [`Ansi ${index} Color`, name])),
  },
}

// A Ghostty theme: `key = value` lines, the ANSI colours as `palette = 0=#rrggbb`, named `palette = 0` here.
const ghostty: SourceFormat = {
  holds: (text) => /^\s*(palette|foreground|background)\s*=/m.test(text),
  * settings (text) {
    for (const [key, value] of settingLines(text, /=/)) {
      const entry = key === 'palette' ? /^(\d+)\s*=\s*(.*)$/.exec(value) : undefined
      yield entry ? [`palette = ${entry[1]}`, entry[2]] : [key, value]
    }
  },
  colourNames: {
    foreground: 'foreground',
    background: 'background',
    'cursor-color': 'cursor',
    'cursor-text': 'cursorText',
    'selection-background': 'selection',
    'selection-foreground': 'selectionText',
    ...Object.fromEntries(ansiColourNames.map((name, index) => [`palette = ${index}`, name])),
  },
}

// A Kitty theme: `key value` lines.
const kitty: SourceFormat = {
  holds: (text) => /^\s*(color\d+|foreground|background)\s+\S/m.test(text),
  settings: (text) => settingLines(text, /\s/),
  colourNames: {
    foreground: 'foreground',
    background: 'background',
    cursor: 'cursor',
    cursor_text_color: 'cursorText',
    selection_background: 'selection',
    selection_foreground: 'selectionText',
    ...Object.fromEntries(ansiColourNames.map((name, index) => [`color${index}`, name])),
  },
}

// An Alacritty theme, which is TOML: string keys in tables such as `[colors.primary]`, or dotted keys such as
// `primary.background` in `[colors]`, each named by its whole path, e.g. `colors.primary.background`. Nothing else of
// TOML matters to the colours.
const alacritty: SourceFormat = {
  holds: (text) => /^\s*\[\s*colors[.\]]/m.test(text),
  * settings (text) {
    let table = ''
    for (const line of text.split(/\r?\n/)) {
      const header = /^\s*\[\s*([\w.]+)\s*\]/.exec(line)
      if (header) table = header[1]
      const setting = header ? undefined : /^\s*([\w.]+)\s*=\s*(["'])(.*?)\2/.exec(line)
      if (setting) yield [`${table}.${setting[1]}`, setting[3]]
    }
  },
  colourNames: {
    'colors.primary.foreground': 'foreground',
    'colors.primary.background': 'background',
    'colors.cursor.cursor': 'cursor',
    'colors.cursor.text': 'cursorText',
    'colors.selection.background': 'selection',
    'colors.selection.text': 'selectionText',
    ...Object.fromEntries(ansiColourNames.slice(0, 8).map((name) => [`colors.normal.${name}`, name])),
    ...Object.fromEntries(
      ansiColourNames.slice(0, 8).map((name, index) => [`colors.bright.${name}`, ansiColourNames[index + 8]])
    ),
  },
}

// A Windows Terminal colour scheme: a JSON object of colours, which calls magenta purple, with no cursor text or
// selection text.
const windowsTerminal: SourceFormat = {
  holds: (text) => readJsonc(text) !== undefined,
  * settings (text) {
    for (const [key, value] of Object.entries(readJsonc(text)!)) {
      if (typeof value === 'string') yield [key, value]
    }
  },
  colourNames: {
    foreground: 'foreground',
    background: 'background',
    cursorColor: 'cursor',
    selectionBackground: 'selection',
    ...Object.fromEntries(
      ansiColourNames.map((name) => [name.replace('magenta', 'purple').replace('Magenta', 'Purple'), name])
    ),
  },
}

// Told apart by what a text holds rather than its file's extension, which Ghostty's theme files lack. Alacritty's TOML
// comes before Ghostty, whose `key = value` lines it can hold too.
const sourceFormats = [windowsTerminal, itermcolors, alacritty, ghostty, kitty]

// A colour written `#rrggbb`, `rrggbb` or `0xrrggbb`, as `#rrggbb`; undefined for anything else, e.g. a named colour.
function hexColour (value: string): Colour | undefined {
  const digits = /^(?:#|0x)?([0-9a-f]{6})$/i.exec(value.trim())?.[1]
  return digits && `#${digits.toLowerCase()}`
}

// The terminal colours the text sets, by blind's names for them.
function readColours (format: SourceFormat, text: string) {
  const colours: Partial<TerminalColours> = {}
  for (const [name, value] of format.settings(text)) {
    const field = Object.hasOwn(format.colourNames, name) ? format.colourNames[name] : undefined
    const colour = hexColour(value)
    if (field && colour) colours[field] = colour
  }
  return colours
}

// The format's own name for one of blind's colours, e.g. Kitty's `color8` for brightBlack.
function nameIn (format: SourceFormat, field: keyof TerminalColours) {
  return Object.keys(format.colourNames).find((name) => format.colourNames[name] === field) ?? field
}

// The file's name without the extension of a format the Import reads; Ghostty's theme files have none.
function themeName (fileName: string) {
  const extension = ['.itermcolors', '.conf', '.toml', '.json'].find((candidate) =>
    fileName.toLowerCase().endsWith(candidate)
  )
  return extension ? fileName.slice(0, -extension.length) : fileName
}

// The cursor's and the selection's colours, when the file leaves them out, from its foreground and background. In the
// Default Theme's order, which the Theme file keeps.
function terminalColours (colours: TerminalColours): TerminalColours {
  const filled: TerminalColours = {
    ...colours,
    cursor: colours.cursor ?? colours.foreground,
    cursorText: colours.cursorText ?? colours.background,
    selection: colours.selection ?? opaque(mixColours(colours.foreground, colours.background, 0.25)),
    selectionText: colours.selectionText ?? colours.foreground,
  }
  const fields = Object.keys(defaultTheme.terminal) as (keyof TerminalColours)[]
  return Object.fromEntries(fields.map((field) => [field, filled[field]])) as unknown as TerminalColours
}

// The chrome from the terminal colours: the accent in its blue, the dividers in its bright black, the Command Palette
// and the Session Banner in its foreground and background, and Activity in its yellow.
function chromeColours (terminal: TerminalColours): ChromeColours {
  const { foreground, background } = terminal
  return {
    divider: terminal.brightBlack,
    tabText: opaque(mixColours(foreground, background, 0.6)),
    accent: terminal.blue,
    accentText: background,
    sessionBannerBackground: foreground,
    sessionBannerText: background,
    paletteBackground: `${background}f7`,
    paletteBorder: terminal.brightBlack,
    paletteText: foreground,
    paletteMutedText: opaque(mixColours(foreground, background, 0.5)),
    paletteSelection: terminal.selection,
    activity: terminal.yellow,
  }
}

const listFormat = new Intl.ListFormat('en-GB', { type: 'conjunction' })

// What to tell the user of a refused Import: which file, and why, with what to do about a name another Theme or file
// has.
export function themeImportRefusalMessage (refused: RefusedThemeImport) {
  const renameIt = `Rename ${refused.sourceFileName} and import it again.`
  const details: {
    [Reason in ThemeImportRefusal['reason']]: (refusal: Extract<ThemeImportRefusal, { reason: Reason }>) => string
  } = {
    unreadable: () => "It isn't an iTerm2, Ghostty, Kitty, Alacritty or Windows Terminal theme.",
    missingColours: ({ missing }) => `It leaves out ${listFormat.format(missing)}.`,
    nameTaken: ({ takenBy, themeFile }) =>
      themeFile === undefined
        ? `${takenBy} is a built-in Theme. ${renameIt}`
        : `The Theme file ${themeFile} already has the name ${takenBy}. ${renameIt}`,
    fileTaken: ({ existingFile }) => `The themes folder already has ${existingFile}. ${renameIt}`,
  }
  const detail = (details[refused.reason] as (refusal: ThemeImportRefusal) => string)(refused)
  return { title: `Couldn't import ${refused.sourceFileName}`, detail }
}

// The Theme file the source makes, named after it.
export function importTheme (source: ThemeSource, target: ThemeImportTarget): ThemeImport {
  const name = themeName(source.fileName)
  const refuse = (refusal: ThemeImportRefusal): ThemeImport => ({
    type: 'refused',
    sourceFileName: source.fileName,
    name,
    ...refusal,
  })
  const { text } = source
  const format = text === undefined ? undefined : sourceFormats.find((candidate) => candidate.holds(text))
  const colours = format && readColours(format, text!)
  if (!format || !colours || Object.keys(colours).length === 0) return refuse({ reason: 'unreadable' })
  const missing = requiredColours.filter((field) => colours[field] === undefined)
  if (missing.length > 0) {
    return refuse({ reason: 'missingColours', missing: missing.map((field) => nameIn(format, field)) })
  }
  const takenBy = target.themeNames.find((other) => other.toLowerCase() === name.toLowerCase())
  if (takenBy !== undefined) {
    const themeFile = target.fileNamesByTheme[takenBy]
    return refuse({ reason: 'nameTaken', takenBy, ...(themeFile === undefined ? {} : { themeFile }) })
  }
  const fileName = `${name}.jsonc`
  const existingFile = target.fileNames.find((other) => other.toLowerCase() === fileName.toLowerCase())
  if (existingFile !== undefined) return refuse({ reason: 'fileTaken', existingFile })
  const terminal = terminalColours(colours as TerminalColours)
  const theme: Theme = { ...defaultTheme, name, terminal, chrome: chromeColours(terminal) }
  const file = { $schema: `./${themeSchemaFileName}`, name, terminal, chrome: theme.chrome }
  return { type: 'ready', name, fileName, text: `${JSON.stringify(file, null, 2)}\n`, theme }
}
