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

type Components = readonly [red: number, green: number, blue: number]

// An iTerm2 colour preset's plist: each colour, by iTerm2's name for it, with its components from 0 to 1, in the colour
// space named by its `Color Space` key, or without the key when `colourSpace` is undefined.
function itermcolorsPlist (colours: Record<string, Components>, colourSpace: string | undefined) {
  const colourSpaceKey = colourSpace === undefined
    ? ''
    : `
    <key>Color Space</key>
    <string>${colourSpace}</string>`
  const entries = Object.entries(colours).map(([name, [red, green, blue]]) => `
  <key>${name}</key>
  <dict>
    <key>Alpha Component</key>
    <real>1</real>
    <key>Blue Component</key>
    <real>${blue}</real>${colourSpaceKey}
    <key>Green Component</key>
    <real>${green}</real>
    <key>Red Component</key>
    <real>${red}</real>
  </dict>`)
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>${entries.join('')}
</dict>
</plist>
`
}

// iTerm2's name for each of blind's colours.
const itermcolorsNames: Record<string, string> = {
  foreground: 'Foreground Color',
  background: 'Background Color',
  cursor: 'Cursor Color',
  cursorText: 'Cursor Text Color',
  selection: 'Selection Color',
  selectionText: 'Selected Text Color',
  ...Object.fromEntries(ansiColourNames.map((name, index) => [name, `Ansi ${index} Color`])),
}

// An iTerm2 colour preset with the colours in sRGB, as iTerm2 exports it.
function itermcolors (colours: Colours) {
  const component = (colour: string, start: number) => Number.parseInt(colour.slice(start, start + 2), 16) / 255
  return itermcolorsPlist(
    Object.fromEntries(Object.entries(colours).map(([name, colour]) => [
      itermcolorsNames[name],
      [component(colour, 1), component(colour, 3), component(colour, 5)],
    ])),
    'sRGB'
  )
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

// The components of altercation/solarized's `iterm2-colors-solarized/Solarized Dark.itermcolors`, which has no
// `Color Space` key.
const solarizedDark: Record<string, Components> = {
  'Foreground Color': [0.44058024883270264, 0.50962930917739868, 0.51685798168182373],
  'Background Color': [0, 0.11783610284328461, 0.15170273184776306],
  'Ansi 0 Color': [0, 0.15575926005840302, 0.19370138645172119],
  'Ansi 1 Color': [0.81926977634429932, 0.10840655118227005, 0.14145714044570923],
  'Ansi 2 Color': [0.44977453351020813, 0.54115492105484009, 0.020208755508065224],
  'Ansi 3 Color': [0.6474647521972656, 0.46751424670219421, 0.023484811186790466],
  'Ansi 4 Color': [0.12754884362220764, 0.46265947818756104, 0.78231418132781982],
  'Ansi 5 Color': [0.77738940715789795, 0.10802463442087173, 0.43516635894775391],
  'Ansi 6 Color': [0.14679534733295441, 0.57082360982894897, 0.52502274513244629],
  'Ansi 7 Color': [0.91611063480377197, 0.89001238346099854, 0.79781103134155273],
  'Ansi 8 Color': [0, 0.11783610284328461, 0.15170273184776306],
  'Ansi 9 Color': [0.74176257848739624, 0.21325300633907318, 0.073530435562133789],
  'Ansi 10 Color': [0.27671992778778076, 0.35665956139564514, 0.38298487663269043],
  'Ansi 11 Color': [0.32436618208885193, 0.40717673301696777, 0.43850564956665039],
  'Ansi 12 Color': [0.44058024883270264, 0.50962930917739868, 0.51685798168182373],
  'Ansi 13 Color': [0.34798634052276611, 0.33896297216415405, 0.72908437252044678],
  'Ansi 14 Color': [0.50599193572998047, 0.56485837697982788, 0.56363654136657715],
  'Ansi 15 Color': [0.98943418264389038, 0.95794391632080078, 0.86405980587005615],
}

describe("an iTerm2 colour preset's colour spaces", () => {
  it("read a colour without a Color Space as iTerm2 does, as Generic RGB, giving Solarized's published colours", () => {
    const imported = importTheme(
      { fileName: 'Solarized Dark.itermcolors', text: itermcolorsPlist(solarizedDark, undefined) },
      builtInsOnly
    )

    // Solarized's README gives each colour's hex. The background, black and brightMagenta come out as macOS converts
    // them instead, so as iTerm2 shows them, since the file itself drifts from the README there.
    expect(imported.type === 'ready' && imported.theme.terminal).toMatchObject({
      foreground: '#839496',
      background: '#002833',
      black: '#003541',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#002833',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c6ec6',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3',
    })
  })

  it("read Solarized Light, whose foreground and background are Solarized Dark's colours 11 and 15, likewise", () => {
    const solarizedLight = {
      ...solarizedDark,
      'Foreground Color': solarizedDark['Ansi 11 Color'],
      'Background Color': solarizedDark['Ansi 15 Color'],
    }

    const imported = importTheme(
      { fileName: 'Solarized Light.itermcolors', text: itermcolorsPlist(solarizedLight, undefined) },
      builtInsOnly
    )

    expect(imported.type === 'ready' && imported.theme.terminal).toMatchObject({
      foreground: '#657b83',
      background: '#fdf6e3',
    })
  })

  it('read a Calibrated colour as one without a Color Space', () => {
    const calibrated = importTheme(
      { fileName: 'Solarized Dark.itermcolors', text: itermcolorsPlist(solarizedDark, 'Calibrated') },
      builtInsOnly
    )
    const withoutColourSpace = importTheme(
      { fileName: 'Solarized Dark.itermcolors', text: itermcolorsPlist(solarizedDark, undefined) },
      builtInsOnly
    )

    expect(calibrated.type === 'ready' && calibrated.theme.terminal.blue).toBe('#268bd2')
    expect(calibrated).toEqual(withoutColourSpace)
  })

  // A preset whose foreground is `foreground` and whose every other colour it must set is black.
  function withForeground (foreground: Components, colourSpace: string | undefined) {
    const black: Components = [0, 0, 0]
    return itermcolorsPlist({
      ...Object.fromEntries(Object.keys(solarizedDark).map((name) => [name, black])),
      'Foreground Color': foreground,
    }, colourSpace)
  }

  it.each(['sRGB', 'Calibrated', 'P3', undefined])('keep black and white as they are in %s', (colourSpace) => {
    const imported = importTheme(
      { fileName: 'Mono.itermcolors', text: withForeground([1, 1, 1], colourSpace) },
      builtInsOnly
    )

    expect(imported.type === 'ready' && imported.theme.terminal).toMatchObject({
      foreground: '#ffffff',
      background: '#000000',
    })
  })

  it.each(['Calibrated', 'P3', undefined])('clamp a component below 0 in %s to 0', (colourSpace) => {
    const imported = importTheme(
      { fileName: 'Mono.itermcolors', text: withForeground([-0.001, 0, 0], colourSpace) },
      builtInsOnly
    )

    expect(imported.type === 'ready' && imported.theme.terminal.foreground).toBe('#000000')
  })

  it.each([
    ["a grey, since P3 shares sRGB's white and tone curve", [128 / 255, 128 / 255, 128 / 255], '#808080'],
    ['a red outside sRGB, clipped to its nearest', [1, 0, 0], '#ff0000'],
  ] as const)('read a P3 colour, %s', (_, foreground, expected) => {
    const imported = importTheme({ fileName: 'Wide.itermcolors', text: withForeground(foreground, 'P3') }, builtInsOnly)

    expect(imported.type === 'ready' && imported.theme.terminal.foreground).toBe(expected)
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
