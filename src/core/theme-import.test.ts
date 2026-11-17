import { describe, expect, it } from 'vitest'
import { ansiColourNames, importTheme, type ThemeImportTarget, themeImportRefusalMessage } from './theme-import'
import { defaultTheme, loadThemes } from './themes'

// Dracula's terminal colours, as the iTerm2-Color-Schemes collection publishes them.
const dracula = {
  foreground: '#f8f8f2',
  background: '#282a36',
  cursor: '#f8f8f2',
  cursorText: '#282a36',
  selection: '#44475a',
  selectionText: '#ffffff',
  black: '#21222c',
  red: '#ff5555',
  green: '#50fa7b',
  yellow: '#f1fa8c',
  blue: '#bd93f9',
  magenta: '#ff79c6',
  cyan: '#8be9fd',
  white: '#f8f8f2',
  brightBlack: '#6272a4',
  brightRed: '#ff6e6e',
  brightGreen: '#69ff94',
  brightYellow: '#ffffa5',
  brightBlue: '#d6acff',
  brightMagenta: '#ff92df',
  brightCyan: '#a4ffff',
  brightWhite: '#ffffff',
}

type Colours = Partial<Record<keyof typeof dracula, string>>

// Only the built-in Themes, in an empty themes folder.
const builtInsOnly: ThemeImportTarget = {
  themeNames: ['Default', 'Catppuccin', 'Tokyo Night', 'Rosé Pine', 'Gruvbox'],
  fileNamesByTheme: {},
  fileNames: [],
}

// An iTerm2 colour preset: a plist with each colour's components from 0 to 1, as iTerm2 exports it.
function itermcolors (colours: Colours) {
  const names: Record<string, string> = {
    foreground: 'Foreground Color',
    background: 'Background Color',
    cursor: 'Cursor Color',
    cursorText: 'Cursor Text Color',
    selection: 'Selection Color',
    selectionText: 'Selected Text Color',
    ...Object.fromEntries(ansiColourNames.map((name, index) => [name, `Ansi ${index} Color`])),
  }
  const component = (colour: string, start: number) => String(Number.parseInt(colour.slice(start, start + 2), 16) / 255)
  const entries = Object.entries(colours).map(([name, colour]) => `
  <key>${names[name]}</key>
  <dict>
    <key>Alpha Component</key>
    <real>1</real>
    <key>Blue Component</key>
    <real>${component(colour, 5)}</real>
    <key>Color Space</key>
    <string>sRGB</string>
    <key>Green Component</key>
    <real>${component(colour, 3)}</real>
    <key>Red Component</key>
    <real>${component(colour, 1)}</real>
  </dict>`)
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>${entries.join('')}
</dict>
</plist>
`
}

// A Ghostty theme: `key = value` lines, the ANSI colours as the palette's.
function ghosttyTheme (colours: Colours) {
  const names: Record<string, string> = {
    foreground: 'foreground',
    background: 'background',
    cursor: 'cursor-color',
    cursorText: 'cursor-text',
    selection: 'selection-background',
    selectionText: 'selection-foreground',
    ...Object.fromEntries(ansiColourNames.map((name, index) => [name, `palette = ${index}`])),
  }
  return Object.entries(colours)
    .map(([name, colour]) => (names[name].startsWith('palette') ? `${names[name]}=${colour}` : `${names[name]} = ${colour}`))
    .join('\n')
}

// A Kitty theme setting the colours given, `colorN` for the ANSI ones.
function kittyConf (colours: Colours) {
  const names: Record<string, string> = {
    foreground: 'foreground',
    background: 'background',
    cursor: 'cursor',
    cursorText: 'cursor_text_color',
    selection: 'selection_background',
    selectionText: 'selection_foreground',
    ...Object.fromEntries(ansiColourNames.map((name, index) => [name, `color${index}`])),
  }
  return [
    '# vim:ft=kitty',
    '## name: Dracula',
    ...Object.entries(colours).map(([name, colour]) => `${names[name]}  ${colour}`),
  ].join('\n')
}

// An Alacritty theme, its colours in tables under `colors`, quoted either way.
function alacrittyToml (colours: Colours) {
  const tables: Record<string, Record<string, string>> = {
    primary: { foreground: 'foreground', background: 'background' },
    cursor: { cursor: 'cursor', cursorText: 'text' },
    selection: { selection: 'background', selectionText: 'text' },
    normal: Object.fromEntries(ansiColourNames.slice(0, 8).map((name) => [name, name])),
    bright: Object.fromEntries(ansiColourNames.slice(8).map((name, index) => [name, ansiColourNames[index]])),
  }
  const sections = Object.entries(tables).map(([table, keys]) => {
    const lines = Object.entries(keys)
      .filter(([name]) => name in colours)
      .map(([name, key], index) => `${key.padEnd(7)} = ${index % 2 ? `"${colours[name as keyof Colours]}"` : `'${colours[name as keyof Colours]}'`}`)
    return `[colors.${table}]\n${lines.join('\n')}`
  })
  return `# Colors (Dracula)\n\n${sections.join('\n\n')}\n`
}

// A Windows Terminal colour scheme, which calls magenta purple and writes its colours in capitals.
function windowsTerminalScheme (colours: Colours) {
  const names: Record<string, string> = {
    cursor: 'cursorColor',
    selection: 'selectionBackground',
    magenta: 'purple',
    brightMagenta: 'brightPurple',
  }
  return JSON.stringify(
    {
      name: 'Dracula',
      ...Object.fromEntries(Object.entries(colours).map(([name, colour]) => [names[name] ?? name, colour.toUpperCase()])),
    },
    null,
    4
  )
}

// Windows Terminal schemes have neither cursor text nor selection text, which take the background and foreground.
const { cursorText: _1, selectionText: _2, ...draculaScheme } = dracula

describe('each format', () => {
  it.each([
    ['an iTerm2 colour preset', 'Dracula.itermcolors', itermcolors(dracula), dracula],
    ['a Ghostty theme', 'Dracula', ghosttyTheme(dracula), dracula],
    ['a Kitty theme', 'Dracula.conf', kittyConf(dracula), dracula],
    ['an Alacritty theme', 'Dracula.toml', alacrittyToml(dracula), dracula],
    ['a Windows Terminal colour scheme', 'Dracula.json', windowsTerminalScheme(draculaScheme), { ...dracula, selectionText: '#f8f8f2' }],
  ])('makes a Theme file of %s that loads as the Theme, with nothing rejected', (_format, fileName, text, terminal) => {
    const imported = importTheme({ fileName, text }, builtInsOnly)
    if (imported.type !== 'ready') throw new Error(`Not imported: ${imported.reason}`)

    const loaded = loadThemes([{ fileName: imported.fileName, text: imported.text }])

    expect(imported).toMatchObject({ name: 'Dracula', fileName: 'Dracula.jsonc' })
    expect(imported.theme.terminal).toEqual(terminal)
    expect(loaded.rejected).toEqual([])
    expect(loaded.themes.at(-1)).toEqual(imported.theme)
  })
})

describe('the Theme file', () => {
  it("names the Theme schema and the Theme, and holds its colours, leaving the Default Theme's font and cursor", () => {
    const imported = importTheme({ fileName: 'Dracula.itermcolors', text: itermcolors(dracula) }, builtInsOnly)
    if (imported.type !== 'ready') throw new Error(`Not imported: ${imported.reason}`)

    expect(JSON.parse(imported.text)).toMatchObject({ $schema: './theme.schema.json', name: 'Dracula' })
    expect(Object.keys(JSON.parse(imported.text))).toEqual(['$schema', 'name', 'terminal', 'chrome'])
    expect(imported.theme.font).toEqual(defaultTheme.font)
    expect(imported.theme.cursor).toEqual(defaultTheme.cursor)
  })

  it('is named after the file without the extension of a format the Import reads, the whole name for none', () => {
    const named = (fileName: string) => importTheme({ fileName, text: kittyConf(dracula) }, builtInsOnly)

    expect(named('Dracula Pro.conf')).toMatchObject({ name: 'Dracula Pro', fileName: 'Dracula Pro.jsonc' })
    expect(named('Dracula Pro')).toMatchObject({ name: 'Dracula Pro', fileName: 'Dracula Pro.jsonc' })
  })
})

describe("an imported Theme's colours", () => {
  it('take the chrome from the terminal colours', () => {
    const imported = importTheme({ fileName: 'Dracula.itermcolors', text: itermcolors(dracula) }, builtInsOnly)

    expect(imported.type === 'ready' && imported.theme.chrome).toEqual({
      divider: '#6272a4',
      tabText: '#a5a6a7',
      accent: '#bd93f9',
      accentText: '#282a36',
      sessionBannerBackground: '#f8f8f2',
      sessionBannerText: '#282a36',
      paletteBackground: '#282a36f7',
      paletteBorder: '#6272a4',
      paletteText: '#f8f8f2',
      paletteMutedText: '#909194',
      paletteSelection: '#44475a',
      activity: '#f1fa8c',
    })
  })

  it("take the cursor's and the selection's from the foreground and background when the file leaves them out", () => {
    const { cursor: _3, cursorText: _4, selection: _5, selectionText: _6, ...withoutThem } = dracula

    const imported = importTheme({ fileName: 'Dracula.itermcolors', text: itermcolors(withoutThem) }, builtInsOnly)

    expect(imported.type === 'ready' && imported.theme.terminal).toMatchObject({
      cursor: '#f8f8f2',
      cursorText: '#282a36',
      selection: '#5c5e65',
      selectionText: '#f8f8f2',
    })
  })

  it("take a cursor colour Alacritty draws from the cell's own colours from the foreground and background", () => {
    const toml = alacrittyToml(dracula)
      .replace("text    = '#282a36'", "text = 'CellBackground'")
      .replace('cursor  = \'#f8f8f2\'', "cursor = 'CellForeground'")

    const imported = importTheme({ fileName: 'Dracula.toml', text: toml }, builtInsOnly)

    expect(toml).toContain('CellForeground')
    expect(imported.type === 'ready' && imported.theme.terminal).toMatchObject({
      cursor: '#f8f8f2',
      cursorText: '#282a36',
    })
  })
})

describe('refusing a file blind cannot read', () => {
  it('refuses one in none of the formats', () => {
    expect(importTheme({ fileName: 'notes.txt', text: 'Buy milk.\nCall the bank.' }, builtInsOnly)).toEqual({
      type: 'refused',
      reason: 'unreadable',
      sourceFileName: 'notes.txt',
      name: 'notes.txt',
    })
  })

  it("refuses a Windows Terminal settings.json, which holds several schemes, as one it can't read", () => {
    const settings = JSON.stringify({ profiles: {}, schemes: [JSON.parse(windowsTerminalScheme(dracula))] })

    expect(importTheme({ fileName: 'settings.json', text: settings }, builtInsOnly)).toMatchObject({
      type: 'refused',
      reason: 'unreadable',
    })
  })

  it("refuses one whose text couldn't be read at all", () => {
    expect(importTheme({ fileName: 'Dracula.itermcolors', text: undefined }, builtInsOnly)).toMatchObject({
      type: 'refused',
      reason: 'unreadable',
      sourceFileName: 'Dracula.itermcolors',
    })
  })
})

describe('refusing a file that leaves colours out', () => {
  const { brightBlack: _3, brightRed: _4, brightGreen: _5, brightYellow: _6, ...rest } = dracula
  const { brightBlue: _7, brightMagenta: _8, brightCyan: _9, brightWhite: _10, ...withoutBright } = rest

  it('refuses one without its bright colours, naming them as the file does', () => {
    expect(importTheme({ fileName: 'dracula.conf', text: kittyConf(withoutBright) }, builtInsOnly)).toEqual({
      type: 'refused',
      reason: 'missingColours',
      sourceFileName: 'dracula.conf',
      name: 'dracula',
      missing: ['color8', 'color9', 'color10', 'color11', 'color12', 'color13', 'color14', 'color15'],
    })
  })

  it('refuses one without its foreground or background', () => {
    const { foreground: _1, background: _2, ...withoutThem } = dracula

    expect(importTheme({ fileName: 'dracula.conf', text: kittyConf(withoutThem) }, builtInsOnly)).toMatchObject({
      reason: 'missingColours',
      missing: ['foreground', 'background'],
    })
  })

  it.each([
    ['Dracula.itermcolors', itermcolors(withoutBright), 'Ansi 8 Color'],
    ['Dracula', ghosttyTheme(withoutBright), 'palette = 8'],
    ['Dracula.toml', alacrittyToml(withoutBright), 'colors.bright.black'],
    ['Dracula.json', windowsTerminalScheme(withoutBright), 'brightBlack'],
  ])('names a colour %s leaves out as that format does', (fileName, text, firstMissing) => {
    const imported = importTheme({ fileName, text }, builtInsOnly)

    expect(imported.type === 'refused' && imported.reason === 'missingColours' && imported.missing[0]).toBe(firstMissing)
  })
})

describe('refusing a name another Theme has', () => {
  // The built-in Themes, and Nord from nord.jsonc and Dracula Pro from dracula.jsonc in the themes folder, with a
  // broken.jsonc that loaded no Theme.
  const withThemeFiles: ThemeImportTarget = {
    themeNames: [...builtInsOnly.themeNames, 'Dracula Pro', 'Nord'],
    fileNamesByTheme: { 'Dracula Pro': 'dracula.jsonc', Nord: 'nord.jsonc' },
    fileNames: ['broken.jsonc', 'dracula.jsonc', 'nord.jsonc'],
  }

  it("refuses a built-in Theme's name, ignoring case", () => {
    expect(importTheme({ fileName: 'gruvbox.itermcolors', text: itermcolors(dracula) }, builtInsOnly)).toEqual({
      type: 'refused',
      reason: 'nameTaken',
      sourceFileName: 'gruvbox.itermcolors',
      name: 'gruvbox',
      takenBy: 'Gruvbox',
    })
  })

  it("refuses a Theme file's Theme's name, ignoring case, naming the Theme file", () => {
    expect(importTheme({ fileName: 'NORD.conf', text: kittyConf(dracula) }, withThemeFiles)).toEqual({
      type: 'refused',
      reason: 'nameTaken',
      sourceFileName: 'NORD.conf',
      name: 'NORD',
      takenBy: 'Nord',
      themeFile: 'nord.jsonc',
    })
  })

  it('refuses a free name whose Theme file name the themes folder already has, ignoring case, naming that file', () => {
    expect(importTheme({ fileName: 'Dracula.itermcolors', text: itermcolors(dracula) }, withThemeFiles)).toEqual({
      type: 'refused',
      reason: 'fileTaken',
      sourceFileName: 'Dracula.itermcolors',
      name: 'Dracula',
      existingFile: 'dracula.jsonc',
    })
  })

  it("refuses a file name taken by a file that loaded no Theme, which the Import mustn't overwrite either", () => {
    expect(importTheme({ fileName: 'broken.conf', text: kittyConf(dracula) }, withThemeFiles)).toMatchObject({
      reason: 'fileTaken',
      existingFile: 'broken.jsonc',
    })
  })
})

describe("a refusal's message", () => {
  const refused = { type: 'refused', sourceFileName: 'NORD.conf', name: 'NORD' } as const

  it.each([
    [{ reason: 'unreadable' }, "It isn't an iTerm2, Ghostty, Kitty, Alacritty or Windows Terminal theme."],
    [{ reason: 'missingColours', missing: ['foreground'] }, 'It leaves out foreground.'],
    [
      { reason: 'missingColours', missing: ['color8', 'color9', 'color15'] },
      'It leaves out color8, color9 and color15.',
    ],
    [{ reason: 'nameTaken', takenBy: 'Nord' }, 'Nord is a built-in Theme. Rename NORD.conf and import it again.'],
    [
      { reason: 'nameTaken', takenBy: 'Nord', themeFile: 'nord.jsonc' },
      'The Theme file nord.jsonc already has the name Nord. Rename NORD.conf and import it again.',
    ],
    [
      { reason: 'fileTaken', existingFile: 'nord.jsonc' },
      'The themes folder already has nord.jsonc. Rename NORD.conf and import it again.',
    ],
  ] as const)('says why: %j', (refusal, detail) => {
    expect(themeImportRefusalMessage({ ...refused, ...refusal })).toEqual({
      title: "Couldn't import NORD.conf",
      detail,
    })
  })
})
