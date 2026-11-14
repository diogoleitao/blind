import { isObject, readJsonc } from './jsonc'

// A colour as `#rrggbb`, or `#rrggbbaa` with an alpha.
export type Colour = string

const cursorStyles = ['block', 'bar', 'underline'] as const

export type CursorStyle = (typeof cursorStyles)[number]

// The terminal's colours, the 16 ANSI colours named as xterm.js names them.
export interface TerminalColours {
  foreground: Colour;
  // Shown 25% transparent over the window's blur, as iTerm2 shows it.
  background: Colour;
  cursor: Colour;
  // The character under a block cursor.
  cursorText: Colour;
  selection: Colour;
  selectionText: Colour;
  black: Colour;
  red: Colour;
  green: Colour;
  yellow: Colour;
  blue: Colour;
  magenta: Colour;
  cyan: Colour;
  white: Colour;
  brightBlack: Colour;
  brightRed: Colour;
  brightGreen: Colour;
  brightYellow: Colour;
  brightBlue: Colour;
  brightMagenta: Colour;
  brightCyan: Colour;
  brightWhite: Colour;
}

// The colours of the app's own chrome: the Tab bar, the Command Palette, the Session Banner and the Pane dividers.
export interface ChromeColours {
  // Between Panes, above the Tab bar, between its rows, and around the Tabs that aren't focused.
  divider: Colour;
  tabText: Colour;
  // The outline and text of the Session's label, and the fill of the focused Tab.
  accent: Colour;
  // Text on the accent, as the focused Tab's is.
  accentText: Colour;
  // The Session Banner's fill and text: light, so it stands out over the terminal.
  sessionBannerBackground: Colour;
  sessionBannerText: Colour;
  paletteBackground: Colour;
  paletteBorder: Colour;
  paletteText: Colour;
  // A result's details and kind.
  paletteMutedText: Colour;
  paletteSelection: Colour;
}

export interface Theme {
  name: string;
  font: { family: string; size: number };
  cursor: { style: CursorStyle; blink: boolean };
  terminal: TerminalColours;
  chrome: ChromeColours;
}

// The iTerm2 profile's font, cursor and colours, with the chrome blind had before Themes.
export const defaultTheme: Theme = {
  name: 'Default',
  font: { family: 'Andale Mono', size: 14 },
  cursor: { style: 'block', blink: false },
  terminal: {
    foreground: '#bbbbbb',
    background: '#000000',
    cursor: '#bbbbbb',
    cursorText: '#ffffff',
    selection: '#b5d5ff',
    selectionText: '#000000',
    black: '#000000',
    red: '#bb0000',
    green: '#00bb00',
    yellow: '#bbbb00',
    blue: '#0000bb',
    magenta: '#bb00bb',
    cyan: '#00bbbb',
    white: '#bbbbbb',
    brightBlack: '#555555',
    brightRed: '#ff5555',
    brightGreen: '#55ff55',
    brightYellow: '#ffff55',
    brightBlue: '#5555ff',
    brightMagenta: '#ff55ff',
    brightCyan: '#55ffff',
    brightWhite: '#ffffff',
  },
  chrome: {
    divider: '#ffffff33',
    tabText: '#ffffff8c',
    accent: '#ffffffd9',
    accentText: '#000000',
    sessionBannerBackground: '#ffffffe6',
    sessionBannerText: '#000000',
    paletteBackground: '#1e1e1ef7',
    paletteBorder: '#ffffff26',
    paletteText: '#ffffffd9',
    paletteMutedText: '#ffffff73',
    paletteSelection: '#ffffff1a',
  },
}

// The dark variant of each, in the Default Theme's font and cursor.
const alternativeThemes: Theme[] = [
  {
    name: 'Catppuccin',
    font: defaultTheme.font,
    cursor: defaultTheme.cursor,
    terminal: {
      foreground: '#cdd6f4',
      background: '#1e1e2e',
      cursor: '#f5e0dc',
      cursorText: '#1e1e2e',
      selection: '#585b70',
      selectionText: '#cdd6f4',
      black: '#45475a',
      red: '#f38ba8',
      green: '#a6e3a1',
      yellow: '#f9e2af',
      blue: '#89b4fa',
      magenta: '#f5c2e7',
      cyan: '#94e2d5',
      white: '#bac2de',
      brightBlack: '#585b70',
      brightRed: '#f38ba8',
      brightGreen: '#a6e3a1',
      brightYellow: '#f9e2af',
      brightBlue: '#89b4fa',
      brightMagenta: '#f5c2e7',
      brightCyan: '#94e2d5',
      brightWhite: '#a6adc8',
    },
    chrome: {
      divider: '#45475a',
      tabText: '#7f849c',
      accent: '#89b4fa',
      accentText: '#1e1e2e',
      sessionBannerBackground: '#cdd6f4',
      sessionBannerText: '#1e1e2e',
      paletteBackground: '#181825f7',
      paletteBorder: '#45475a',
      paletteText: '#cdd6f4',
      paletteMutedText: '#7f849c',
      paletteSelection: '#313244',
    },
  },
  {
    name: 'Tokyo Night',
    font: defaultTheme.font,
    cursor: defaultTheme.cursor,
    terminal: {
      foreground: '#c0caf5',
      background: '#1a1b26',
      cursor: '#c0caf5',
      cursorText: '#1a1b26',
      selection: '#33467c',
      selectionText: '#c0caf5',
      black: '#15161e',
      red: '#f7768e',
      green: '#9ece6a',
      yellow: '#e0af68',
      blue: '#7aa2f7',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      white: '#a9b1d6',
      brightBlack: '#414868',
      brightRed: '#f7768e',
      brightGreen: '#9ece6a',
      brightYellow: '#e0af68',
      brightBlue: '#7aa2f7',
      brightMagenta: '#bb9af7',
      brightCyan: '#7dcfff',
      brightWhite: '#c0caf5',
    },
    chrome: {
      divider: '#3b4261',
      tabText: '#565f89',
      accent: '#7aa2f7',
      accentText: '#1a1b26',
      sessionBannerBackground: '#c0caf5',
      sessionBannerText: '#1a1b26',
      paletteBackground: '#16161ef7',
      paletteBorder: '#3b4261',
      paletteText: '#c0caf5',
      paletteMutedText: '#565f89',
      paletteSelection: '#283457',
    },
  },
  {
    name: 'Rosé Pine',
    font: defaultTheme.font,
    cursor: defaultTheme.cursor,
    terminal: {
      foreground: '#e0def4',
      background: '#191724',
      cursor: '#524f67',
      cursorText: '#e0def4',
      selection: '#403d52',
      selectionText: '#e0def4',
      black: '#26233a',
      red: '#eb6f92',
      green: '#31748f',
      yellow: '#f6c177',
      blue: '#9ccfd8',
      magenta: '#c4a7e7',
      cyan: '#ebbcba',
      white: '#e0def4',
      brightBlack: '#6e6a86',
      brightRed: '#eb6f92',
      brightGreen: '#31748f',
      brightYellow: '#f6c177',
      brightBlue: '#9ccfd8',
      brightMagenta: '#c4a7e7',
      brightCyan: '#ebbcba',
      brightWhite: '#e0def4',
    },
    chrome: {
      divider: '#403d52',
      tabText: '#6e6a86',
      accent: '#c4a7e7',
      accentText: '#191724',
      sessionBannerBackground: '#e0def4',
      sessionBannerText: '#191724',
      paletteBackground: '#1f1d2ef7',
      paletteBorder: '#403d52',
      paletteText: '#e0def4',
      paletteMutedText: '#908caa',
      paletteSelection: '#26233a',
    },
  },
  {
    name: 'Gruvbox',
    font: defaultTheme.font,
    cursor: defaultTheme.cursor,
    terminal: {
      foreground: '#ebdbb2',
      background: '#282828',
      cursor: '#ebdbb2',
      cursorText: '#282828',
      selection: '#504945',
      selectionText: '#ebdbb2',
      black: '#282828',
      red: '#cc241d',
      green: '#98971a',
      yellow: '#d79921',
      blue: '#458588',
      magenta: '#b16286',
      cyan: '#689d6a',
      white: '#a89984',
      brightBlack: '#928374',
      brightRed: '#fb4934',
      brightGreen: '#b8bb26',
      brightYellow: '#fabd2f',
      brightBlue: '#83a598',
      brightMagenta: '#d3869b',
      brightCyan: '#8ec07c',
      brightWhite: '#ebdbb2',
    },
    chrome: {
      divider: '#504945',
      tabText: '#a89984',
      accent: '#d79921',
      accentText: '#282828',
      sessionBannerBackground: '#ebdbb2',
      sessionBannerText: '#282828',
      paletteBackground: '#1d2021f7',
      paletteBorder: '#504945',
      paletteText: '#ebdbb2',
      paletteMutedText: '#928374',
      paletteSelection: '#3c3836',
    },
  },
]

// The Default Theme first, then the alternatives.
export const builtInThemes: Theme[] = [defaultTheme, ...alternativeThemes]

// A Theme file in the themes folder: its name there and its text.
export interface ThemeFile {
  fileName: string;
  text: string;
}

// The parts of a Theme, each a group of fields.
type ThemeGroup = Exclude<keyof Theme, 'name'>

// Whether a value is valid for a field.
type FieldCheck = (value: unknown) => boolean

// A `Colour`, for the schema and the check alike.
const colourPattern = '^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$'

const isColour: FieldCheck = (value) => typeof value === 'string' && new RegExp(colourPattern).test(value)

const isText: FieldCheck = (value) => typeof value === 'string' && value.trim() !== ''

// A colour check for each of a colour group's fields.
function colourChecks<Colours extends TerminalColours | ChromeColours> (defaults: Colours) {
  const checks = Object.fromEntries(Object.keys(defaults).map((field) => [field, isColour]))
  return checks as Record<keyof Colours, FieldCheck>
}

const minimumFontSize = 6
const maximumFontSize = 72

const fieldChecks: { [Group in ThemeGroup]: Record<keyof Theme[Group], FieldCheck> } = {
  font: {
    family: isText,
    size: (value) => typeof value === 'number' && minimumFontSize <= value && value <= maximumFontSize,
  },
  cursor: {
    style: (value) => cursorStyles.includes(value as CursorStyle),
    blink: (value) => typeof value === 'boolean',
  },
  terminal: colourChecks(defaultTheme.terminal),
  chrome: colourChecks(defaultTheme.chrome),
}

// The file the Theme schema is written to, in the themes folder.
export const themeSchemaFileName = 'theme.schema.json'

// The schema of a colour group's fields, each defaulting to the Default Theme's.
function colourGroupSchema (description: string, defaults: TerminalColours | ChromeColours) {
  return {
    description,
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(
      Object.entries(defaults).map(([field, colour]) => [
        field,
        { type: 'string', pattern: colourPattern, default: colour },
      ])
    ),
  }
}

// The JSON schema of a Theme file, which the file names in `$schema` so editors validate and autocomplete it.
export const themeSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Blind Theme',
  description: "Anything left out takes the Default Theme's value. Colours are #rrggbb, or #rrggbbaa with an alpha.",
  type: 'object',
  required: ['name'],
  properties: {
    $schema: { type: 'string' },
    name: {
      description:
        "The name the Command Palette lists and the config file's theme setting takes. No other Theme's, ignoring case.",
      type: 'string',
      minLength: 1,
    },
    font: {
      type: 'object',
      additionalProperties: false,
      properties: {
        family: {
          description: "An installed font's family.",
          type: 'string',
          minLength: 1,
          default: defaultTheme.font.family,
        },
        size: { type: 'number', minimum: minimumFontSize, maximum: maximumFontSize, default: defaultTheme.font.size },
      },
    },
    cursor: {
      type: 'object',
      additionalProperties: false,
      properties: {
        style: { enum: cursorStyles, default: defaultTheme.cursor.style },
        blink: { type: 'boolean', default: defaultTheme.cursor.blink },
      },
    },
    terminal: colourGroupSchema(
      "The terminal's colours. The background shows 25% transparent over the window's blur.",
      defaultTheme.terminal
    ),
    chrome: colourGroupSchema(
      'The colours of the Tab bar, the Command Palette, the Session Banner and the Pane dividers.',
      defaultTheme.chrome
    ),
  },
  additionalProperties: false,
} as const

// The Themes loaded, and what of the Theme files was rejected: a file's name alone when the whole file was skipped,
// else the file's name and the field, e.g. `dracula.jsonc: font.size`.
export interface LoadedThemes {
  themes: Theme[];
  rejected: string[];
}

// The group's fields from the file, the Default Theme's for each one it leaves out or gives an invalid value.
function readGroup<Group extends ThemeGroup> (group: Group, value: unknown, reject: (entry: string) => void) {
  const fields = { ...defaultTheme[group] } as Record<string, unknown>
  if (!isObject(value)) {
    reject(group)
    return fields as Theme[Group]
  }
  const checks: Record<string, FieldCheck> = fieldChecks[group]
  for (const [field, fieldValue] of Object.entries(value)) {
    if (Object.hasOwn(checks, field) && checks[field](fieldValue)) fields[field] = fieldValue
    else reject(`${group}.${field}`)
  }
  return fields as Theme[Group]
}

// The built-in Themes, then the Theme files' Themes by name, each taking the Default Theme's value for what it leaves
// out or gives an invalid value. A file is skipped when it isn't a JSON object, comments allowed, or its name is
// missing or another Theme's, ignoring case; files are read in order of their names, so the first to take a name keeps
// it.
export function loadThemes (files: ThemeFile[]): LoadedThemes {
  const rejected: string[] = []
  const themes = [...builtInThemes]
  const taken = new Set(themes.map((theme) => theme.name.toLowerCase()))
  for (const { fileName, text } of files.toSorted((a, b) => a.fileName.localeCompare(b.fileName))) {
    const content = readJsonc(text)
    if (!content || !isText(content.name) || taken.has((content.name as string).toLowerCase())) {
      rejected.push(fileName)
      continue
    }
    const reject = (entry: string) => rejected.push(`${fileName}: ${entry}`)
    const theme: Theme = { ...defaultTheme, name: content.name as string }
    for (const [field, value] of Object.entries(content)) {
      if (field === '$schema' || field === 'name') continue
      if (!Object.hasOwn(fieldChecks, field)) reject(field)
      else Object.assign(theme, { [field]: readGroup(field as ThemeGroup, value, reject) })
    }
    taken.add(theme.name.toLowerCase())
    themes.push(theme)
  }
  const custom = themes.slice(builtInThemes.length).toSorted((a, b) => a.name.localeCompare(b.name))
  return { themes: [...builtInThemes, ...custom], rejected }
}
