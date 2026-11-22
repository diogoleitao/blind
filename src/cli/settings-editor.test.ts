import { describe, expect, it } from 'vitest'
import { configSchema, starterConfig } from '../core/config'
import { createFakeDependencies, createFakeTerminal } from './fakes'
import { runCli } from './run'
import { editableSettings, type Key } from './settings-editor'

// The keys that move the selection from the first setting to `name`.
function downTo (name: string): Key[] {
  return Array(editableSettings.indexOf(name)).fill('down')
}

// The keys that type `text`.
function typed (text: string): Key[] {
  return [...text].map((char) => ({ char }))
}

const quit: Key = { char: 'q' }

interface Options {
  text?: string;
  themeNames?: string[];
  // Whether the config file can be read, created when it's missing, or written.
  readable?: boolean;
  creatable?: boolean;
  writable?: boolean;
  interactive?: boolean;
  // What the file is changed to on disk once the editor has first read it, as if saved elsewhere meanwhile.
  changedTo?: string;
  // What the file is changed to on disk just before the last key is pressed.
  changedBeforeLastKey?: string;
}

// Runs `blind settings` on a config file holding `text`, pressing `keys`. Answers the exit code, the file's text
// afterwards, what was last drawn, what went to stderr, and whether the terminal was given back.
async function editSettings (keys: Key[], options: Options = {}) {
  const { text = starterConfig, themeNames = ['Default', 'Dracula'], readable = true, creatable = true } = options
  const { writable = true, interactive = true, changedTo, changedBeforeLastKey } = options
  let file = text
  let reads = 0
  let writes = 0
  let stdout = ''
  let stderr = ''
  const terminal = createFakeTerminal(keys, { interactive })
  const deps = createFakeDependencies({
    themeNames: () => themeNames,
    terminal: {
      ...terminal,
      async * keys () {
        for (const [index, key] of keys.entries()) {
          if (index === keys.length - 1 && changedBeforeLastKey !== undefined) file = changedBeforeLastKey
          yield key
        }
      },
    },
    stdout: (written) => { stdout += written },
    stderr: (written) => { stderr += written },
  })
  const code = await runCli(['settings'], {
    ...deps,
    configFile: {
      ...deps.configFile,
      createIfMissing: () => creatable,
      read: () => {
        if (!readable) return { readable: false }
        const read = file
        if (++reads === 1 && changedTo !== undefined) file = changedTo
        return { readable: true, text: read }
      },
      write: (written) => {
        writes++
        if (writable) file = written
        return writable
      },
    },
  })
  return { code, file, writes, screen: terminal.screen(), stdout, stderr, closed: terminal.closed() }
}

describe('blind settings', () => {
  it('lists every setting but keyBindings with its current value, and exits 0 on q', async () => {
    const { code, screen, closed } = await editSettings([quit], { text: '{ "session": { "cycleOrder": "recent" } }' })
    for (const name of editableSettings) expect(screen).toContain(name.split('.').at(-1))
    expect(screen).not.toContain('keyBindings')
    expect(screen).toMatch(/cycleOrder +recent/)
    expect(screen).toMatch(/sessionBanner +true/)
    expect(code).toBe(0)
    expect(closed).toBe(true)
  })

  it("lists each group's settings indented under a heading of its name, and the others without one", async () => {
    const { screen } = await editSettings(downTo('tab.startDirectory'))
    const lines = screen.split('\n')
    const pane = lines.indexOf('  pane')
    expect(lines.slice(pane + 1, pane + 5).map((line) => line.trim().split(/ +/)[0])).toEqual([
      'scrollbackLines', 'startDirectory', 'padding', 'scrollBar',
    ])
    expect(lines[pane + 1]).toMatch(/^ {4}scrollbackLines/)
    expect(lines[pane + 5]).toBe('  shell')
    expect(lines[pane + 6]).toMatch(/^ {4}program +login shell/)
    expect(lines[pane + 7]).toMatch(/^ {4}onQuit +keepRunning/)
    expect(lines).toContainEqual(expect.stringMatching(/^› {3}startDirectory +root/))
  })

  it("shows the selected setting's description", async () => {
    const { screen } = await editSettings(downTo('session.cycleOrder'))
    expect(screen).toContain(configSchema.properties.session.properties.cycleOrder.description)
  })

  it.each([
    ['escape', ['escape']],
    ['Ctrl+C, even while typing', [...downTo('shell.program'), 'enter', ...typed('/bin/ba'), 'interrupt']],
  ] as [string, Key[]][])('exits 0 on %s, giving the terminal back', async (_, keys) => {
    // Were the editor still running, the keys after these would write a shell.
    const { code, file, closed } = await editSettings([
      ...keys,
      ...downTo('shell.program'),
      'enter',
      ...typed('/bin/zsh'),
      'enter',
    ])
    expect(code).toBe(0)
    expect(file).toBe(starterConfig)
    expect(closed).toBe(true)
  })

  it('shows the default for a value the file gets wrong, marked, and replaces it when a value is picked', async () => {
    const text = '{ "session": { "cycleOrder": "sideways" } }'
    const { screen } = await editSettings([], { text })
    expect(screen).toMatch(/cycleOrder +alphabetical +\(invalid in config\.jsonc\)/)
    const { file, screen: after } = await editSettings([...downTo('session.cycleOrder'), 'right', quit], { text })
    expect(file).toBe('{ "session": { "cycleOrder": "recent" } }')
    expect(after).not.toContain('invalid in config.jsonc')
  })

  it('marks every setting of a group the file gets wrong as a whole', async () => {
    const { screen } = await editSettings([], { text: '{ "pane": "x" }' })
    expect(screen).toMatch(/padding +padded +\(invalid in config\.jsonc\)/)
    expect(screen).toMatch(/scrollBar +none +\(invalid in config\.jsonc\)/)
    expect(screen).not.toMatch(/cycleOrder +alphabetical +\(invalid/)
  })

  describe('the settings changed since the editor opened', () => {
    it('are marked, in bold yellow, and only they', async () => {
      const { screen } = await editSettings([...downTo('session.cycleOrder'), 'right', 'down'])
      const row = screen.split('\n').find((line) => line.includes('cycleOrder'))
      expect(row).toMatch(/cycleOrder +recent \*/)
      expect(row?.startsWith('\x1b[1;33m')).toBe(true)
      expect(row?.endsWith('\x1b[22;39m')).toBe(true)
      expect(screen.match(/\*/g)).toHaveLength(1)
    })

    it('are no longer marked once changed back', async () => {
      const { screen } = await editSettings([...downTo('session.cycleOrder'), 'right', 'left'])
      expect(screen).not.toContain('*')
    })

    it("are listed on quitting by their groups' names and their own, old value to new, in the editor's order", async () => {
      const keys: Key[] = [
        ...downTo('background.transparency'), 'enter', ...typed('40'), 'enter',
        ...Array(downTo('background.transparency').length - downTo('session.cycleOrder').length).fill('up'), 'right',
        quit,
      ]
      const { stdout } = await editSettings(keys)
      expect(stdout).toBe('session.cycleOrder: alphabetical → recent\nbackground.transparency: 25 → 40\n')
    })

    it('are discarded on Ctrl+C, listed as such', async () => {
      const { code, file, stdout } = await editSettings([...downTo('sessionBanner'), 'right', 'interrupt'])
      expect(file).toBe(starterConfig)
      expect(stdout).toBe('Discarded:\nsessionBanner: true → false\n')
      expect(code).toBe(0)
    })

    it('leave nothing to list on Ctrl+C when there are none', async () => {
      const { stdout } = await editSettings([...downTo('sessionBanner'), 'right', 'left', 'interrupt'])
      expect(stdout).toBe('')
    })

    it('leave nothing to list when there are none', async () => {
      const { stdout } = await editSettings([...downTo('session.cycleOrder'), 'right', 'left', quit])
      expect(stdout).toBe('')
    })
  })

  describe('saving', () => {
    it.each([
      ['q', quit],
      ['escape', 'escape'],
    ] as [string, Key][])('writes nothing while the editor is open, and the changes on %s', async (_, key) => {
      const keys: Key[] = [...downTo('session.cycleOrder'), 'right']
      const open = await editSettings(keys)
      expect(open.file).toBe(starterConfig)
      expect(open.writes).toBe(0)
      const { code, file } = await editSettings([...keys, key])
      expect(file).toContain('"cycleOrder": "recent"')
      expect(code).toBe(0)
    })

    it('writes onto the file as it is on disk on quitting, the editor winning a setting changed in both', async () => {
      const changedBeforeLastKey = '{\n  "theme": "Dracula",\n  "session": { "cycleOrder": "created" }\n}\n'
      const { file } = await editSettings([...downTo('session.cycleOrder'), 'right', quit], { changedBeforeLastKey })
      expect(file).toBe('{\n  "theme": "Dracula",\n  "session": { "cycleOrder": "recent" }\n}\n')
    })

    it('leaves a setting changed back alone, even when it changed on disk meanwhile', async () => {
      const changedBeforeLastKey = '{ "session": { "cycleOrder": "created" } }'
      const keys: Key[] = [...downTo('session.cycleOrder'), 'right', 'left', quit]
      const { file, writes } = await editSettings(keys, { changedBeforeLastKey })
      expect(file).toBe(changedBeforeLastKey)
      expect(writes).toBe(0)
    })

    it('writes a setting picked back to its value when the editor opened, once it changed on disk meanwhile', async () => {
      const changedTo = '{ "session": { "cycleOrder": "created" } }'
      const { file, screen } = await editSettings([...downTo('session.cycleOrder'), 'right', quit], { changedTo })
      expect(screen).toMatch(/cycleOrder +alphabetical/)
      expect(file).toBe('{ "session": { "cycleOrder": "alphabetical" } }')
    })

    it('tells a shell typed as login shell from the login shell', async () => {
      const { file } = await editSettings([...downTo('shell.program'), 'enter', ...typed('login shell'), 'enter', quit])
      expect(file).toContain('"program": "login shell"')
    })

    it('says which keys save and which quit without saving', async () => {
      expect((await editSettings([])).screen).toMatch(/q save and quit {2}ctrl\+c quit without saving$/)
    })

    it("doesn't write the file when nothing changed", async () => {
      expect((await editSettings([quit])).writes).toBe(0)
    })
  })

  it('marks an invalid shell, shown as the login shell', async () => {
    const { screen } = await editSettings([], { text: '{ "shell": { "program": "" } }' })
    expect(screen).toMatch(/program +login shell +\(invalid in config\.jsonc\)/)
  })

  it('writes onto the file as it is on disk, keeping what changed there since the editor opened', async () => {
    const changedTo = '{\n  "theme": "Dracula"\n}\n'
    const { file, screen } = await editSettings([...downTo('session.cycleOrder'), 'right', quit], { changedTo })
    expect(file).toBe('{\n  "theme": "Dracula",\n  "session": {\n    "cycleOrder": "recent"\n  }\n}\n')
    expect(screen).toMatch(/theme +Dracula/)
  })

  it('writes nothing on quitting once the file on disk can\'t be read as JSON with comments, listing what wasn\'t saved', async () => {
    const keys: Key[] = [...downTo('session.cycleOrder'), 'right', quit]
    const { code, file, stdout, stderr } = await editSettings(keys, { changedBeforeLastKey: '{ "theme": ' })
    expect(file).toBe('{ "theme": ')
    expect(stderr).toBe(
      "config.jsonc couldn't be read as JSON with comments; fix it with blind settings open\n" +
      'Unsaved:\nsession.cycleOrder: alphabetical → recent\n'
    )
    expect(stdout).toBe('')
    expect(code).toBe(1)
  })

  it('says so on quitting when the changes can\'t be saved, listing them', async () => {
    const keys: Key[] = [...downTo('session.cycleOrder'), 'right', quit]
    const { code, stdout, stderr } = await editSettings(keys, { writable: false })
    expect(stderr).toBe("Couldn't save config.jsonc\nUnsaved:\nsession.cycleOrder: alphabetical → recent\n")
    expect(stdout).toBe('')
    expect(code).toBe(1)
  })

  it('refuses to start on a file that isn\'t JSON with comments, leaving it alone', async () => {
    const text = '{ "session": { "cycleOrder": '
    const { code, file, screen, stderr } = await editSettings([...downTo('session.cycleOrder'), 'right'], { text })
    expect(stderr).toBe("config.jsonc couldn't be read as JSON with comments; fix it with blind settings open\n")
    expect(code).toBe(1)
    expect(file).toBe(text)
    expect(screen).toBe('')
  })

  it('exits 1 without drawing when the config file can\'t be created or read', async () => {
    for (const options of [{ creatable: false }, { readable: false }]) {
      const { code, screen } = await editSettings([quit], options)
      expect(code).toBe(1)
      expect(screen).toBe('')
    }
  })

  it('exits 1 without drawing when it isn\'t run in a terminal', async () => {
    const { code, screen, stderr } = await editSettings([quit], { interactive: false })
    expect(stderr).toBe('blind settings needs a terminal; blind settings open opens the file instead\n')
    expect(code).toBe(1)
    expect(screen).toBe('')
  })

  describe('a setting with a fixed set of values', () => {
    it('takes the next value on right, writing only that key and keeping comments', async () => {
      const text = '{\n  // Mine.\n  "session": { "cycleOrder": "alphabetical" }, // By name.\n  "theme": "Dracula"\n}\n'
      const { file, screen } = await editSettings([...downTo('session.cycleOrder'), 'right', quit], { text })
      expect(file).toBe('{\n  // Mine.\n  "session": { "cycleOrder": "recent" }, // By name.\n  "theme": "Dracula"\n}\n')
      expect(screen).toMatch(/cycleOrder +recent/)
    })

    it('takes the previous value on left, going round from the first to the last', async () => {
      const { file } = await editSettings([...downTo('session.cycleOrder'), 'left', quit])
      expect(file).toContain('"cycleOrder": "created"')
    })

    it('adds a setting the file leaves out, with its group when the file leaves that out too', async () => {
      const { file } = await editSettings([...downTo('pane.scrollBar'), 'right', quit])
      expect(file).toBe(starterConfig.replace('.json"\n', '.json",\n  "pane": {\n    "scrollBar": "visible"\n  }\n'))
    })

    it("adds a setting to its group's other settings, keeping their comments", async () => {
      const text = '{\n  "pane": {\n    "padding": "none" // Mine.\n  }\n}\n'
      const { file } = await editSettings([...downTo('pane.scrollBar'), 'right', quit], { text })
      expect(file).toBe('{\n  "pane": {\n    "padding": "none", // Mine.\n    "scrollBar": "visible"\n  }\n}\n')
    })

    it('replaces a group that is no object', async () => {
      const { file } = await editSettings([...downTo('pane.scrollBar'), 'right', quit], { text: '{\n  "pane": "x"\n}\n' })
      expect(file).toBe('{\n  "pane": {\n    "scrollBar": "visible"\n  }\n}\n')
    })

    it('toggles the boolean setting on space as well as left and right', async () => {
      for (const key of [{ char: ' ' }, 'right', 'left'] as Key[]) {
        expect((await editSettings([...downTo('sessionBanner'), key, quit])).file).toContain('"sessionBanner": false')
      }
    })

    it('picks whose title Rename Tab suggests, from claude to all', async () => {
      const { file, screen } = await editSettings([...downTo('tab.renameSuggestion'), 'right', quit])
      expect(file).toContain('"renameSuggestion": "all"')
      expect(screen).toMatch(/renameSuggestion +all/)
    })

    it('picks the theme from the Themes there are', async () => {
      const { file } = await editSettings([...downTo('theme'), 'right', quit], { themeNames: ['Default', 'Mine', 'Dracula'] })
      expect(file).toContain('"theme": "Mine"')
    })
  })

  describe('a setting whose value is typed', () => {
    it('takes a whole number typed after enter, keeping comments and other keys', async () => {
      const text = '{\n  // Mine.\n  "background": {\n    "transparency": 10 // Nearly opaque.\n  },\n  "theme": "Dracula"\n}\n'
      const keys: Key[] = [...downTo('background.transparency'), 'enter', ...typed('40'), 'enter', quit]
      const { file, screen } = await editSettings(keys, { text })
      expect(file).toBe('{\n  // Mine.\n  "background": {\n    "transparency": 40 // Nearly opaque.\n  },\n  "theme": "Dracula"\n}\n')
      expect(screen).toMatch(/transparency +40/)
    })

    it('shows what is being typed, with backspace taking the last character away', async () => {
      const { screen } = await editSettings([...downTo('background.transparency'), 'enter', ...typed('415'), 'backspace'])
      expect(screen).toMatch(/transparency +41▏/)
    })

    it('refuses a number out of range, writing nothing and saying what it takes', async () => {
      const { file, screen } = await editSettings([...downTo('background.blurRadius'), 'enter', ...typed('0'), 'enter', quit])
      expect(file).toBe(starterConfig)
      expect(screen).toContain('background.blurRadius takes a whole number from 1 to 64')
    })

    it('takes unlimited for pane.scrollbackLines, and shows unlimited back', async () => {
      const keys: Key[] = [...downTo('pane.scrollbackLines'), 'enter', ...typed('unlimited'), 'enter', quit]
      const { file, screen } = await editSettings(keys)
      expect(file).toContain('"scrollbackLines": "unlimited"')
      expect(screen).toMatch(/scrollbackLines +unlimited/)
    })

    it('takes the shell typed, and shows the login shell while it is unset', async () => {
      const { screen: before } = await editSettings([])
      expect(before).toMatch(/program +login shell/)
      const { file } = await editSettings([...downTo('shell.program'), 'enter', ...typed('/bin/bash'), 'enter', quit])
      expect(file).toContain('"shell": {\n    "program": "/bin/bash"\n  }')
    })

    it('refuses an empty shell, pointing at blind settings open to remove it', async () => {
      const { file, screen } = await editSettings([...downTo('shell.program'), 'enter', 'enter', quit])
      expect(file).toBe(starterConfig)
      expect(screen).toContain("shell.program can't be empty; remove it with blind settings open")
    })

    it('leaves the value as it was on escape while typing, without quitting', async () => {
      const typing = [...downTo('background.transparency'), 'enter', ...typed('40')] as Key[]
      const { screen } = await editSettings([...typing, 'escape'])
      expect(screen).toMatch(/transparency +25/)
      const { file } = await editSettings([...typing, 'escape', 'enter', ...typed('30'), 'enter', quit])
      expect(file).toContain('"transparency": 30')
    })
  })
})
