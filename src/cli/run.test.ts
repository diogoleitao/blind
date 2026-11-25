import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readJsonc } from '../core/jsonc'
import type { Theme, ThemeFile } from '../core/themes'
import { createFakeDependencies, fakeConfigPath, fakeThemesFolder } from './fakes'
import { runCli } from './run'

const repoRoot = '/repos/blind'

interface Options {
  exitCode?: number;
  // Exit codes by command, or by command and arguments, e.g. `git stash pop --index`, in place of `exitCode`.
  exitCodes?: Record<string, number>;
  editor?: string;
  configCreatable?: boolean;
  // The installed Blind's process, while it's running.
  blindPid?: number;
  // The repo's uncommitted changes, as `git status --short` lists them.
  changes?: string[];
}

// Runs the CLI against fakes: what it does is recorded in order, each command it runs exits with `exitCode`, and the
// config file exists afterwards unless `configCreatable` is false.
async function cli (argv: string[], options: Options = {}) {
  const { exitCode = 0, exitCodes = {}, editor, configCreatable = true, blindPid, changes = [] } = options
  const events: unknown[] = []
  let stdout = ''
  let stderr = ''
  const deps = createFakeDependencies({ repoRoot, editor })
  const code = await runCli(argv, {
    ...deps,
    configFile: {
      ...deps.configFile,
      createIfMissing: () => {
        events.push('config file created if missing')
        return configCreatable
      },
    },
    run: async (command, args, cwd) => {
      events.push({ command, args, cwd })
      return exitCodes[[command, ...args].join(' ')] ?? exitCodes[command] ?? exitCode
    },
    uncommittedChanges: async () => changes,
    runningBlindPid: async () => blindPid,
    relaunchAfterExit: (pid) => { events.push({ relaunchAfterExit: pid }) },
    terminate: (pid) => { events.push({ terminate: pid }) },
    stdout: (text) => { stdout += text },
    stderr: (text) => { stderr += text },
  })
  return { code, events, stdout, stderr }
}

describe('blind dev', () => {
  it('runs npm run dev in the repo and exits with its exit code', async () => {
    const { code, events } = await cli(['dev'], { exitCode: 3 })
    expect(events).toEqual([{ command: 'npm', args: ['run', 'dev'], cwd: repoRoot }])
    expect(code).toBe(3)
  })
})

describe('blind settings open', () => {
  it('creates the config file if missing, then opens it in $EDITOR and exits with its exit code', async () => {
    const { code, events } = await cli(['settings', 'open'], { exitCode: 4, editor: 'code --wait' })
    expect(events).toEqual([
      'config file created if missing',
      { command: '/bin/sh', args: ['-c', 'code --wait "$@"', 'sh', fakeConfigPath], cwd: undefined },
    ])
    expect(code).toBe(4)
  })

  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('opens it in its default app when $EDITOR is %s, exiting with open\'s exit code', async (_, editor) => {
    const { code, events } = await cli(['settings', 'open'], { editor, exitCode: 1 })
    expect(events).toEqual([
      'config file created if missing',
      { command: 'open', args: [fakeConfigPath], cwd: undefined },
    ])
    expect(code).toBe(1)
  })

  it('opens nothing and exits 1 when the config file can\'t be created', async () => {
    const { code, events } = await cli(['settings', 'open'], { editor: 'vim', configCreatable: false })
    expect(events).toEqual(['config file created if missing'])
    expect(code).toBe(1)
  })
})

describe('blind install', () => {
  const installApp = { command: 'npm', args: ['run', 'install-app'], cwd: repoRoot }

  it('exits with install-app\'s exit code when it fails, restarting nothing', async () => {
    const { code, events } = await cli(['install'], { exitCode: 7, blindPid: 42 })
    expect(events).toEqual([installApp])
    expect(code).toBe(7)
  })

  it('installs without launching Blind when it isn\'t running', async () => {
    const { code, events, stdout } = await cli(['install'])
    expect(events).toEqual([installApp])
    expect(stdout).toBe('Installed.\n')
    expect(code).toBe(0)
  })

  it('asks the installed Blind, running, to restart, which it confirms like quitting', async () => {
    const { code, events, stdout } = await cli(['install'], { blindPid: 42 })
    expect(events).toEqual([
      installApp,
      { command: 'open', args: ['-a', '/Applications/Blind.app', 'blind://restart'], cwd: undefined },
    ])
    expect(stdout).toBe('Installed. Blind restarts once you confirm quitting.\n')
    expect(code).toBe(0)
  })

  it('says so when Blind can\'t be asked to restart, exiting with open\'s exit code', async () => {
    const deps = { blindPid: 42 }
    const { code, stderr } = await cli(['install'], { ...deps, exitCodes: { open: 1 } })
    expect(stderr).toBe("Installed, but Blind couldn't be asked to restart; quit it and open it again to use the new copy.\n")
    expect(code).toBe(1)
  })

  it('with --force, has Blind launched again once it exits, then stops it without asking', async () => {
    const { code, events, stdout } = await cli(['install', '--force'], { blindPid: 42 })
    expect(events).toEqual([installApp, { relaunchAfterExit: 42 }, { terminate: 42 }])
    expect(stdout).toBe('Installed. Blind is restarting.\n')
    expect(code).toBe(0)
  })

  describe('with uncommitted changes', () => {
    const changes = [' M GLOSSARY.md', 'M  src/core/core.ts', '?? src/core/build.ts']
    const stashPush = {
      command: 'git',
      args: ['stash', 'push', '--include-untracked', '-m', 'blind install: uncommitted changes'],
      cwd: repoRoot,
    }
    const stashPop = { command: 'git', args: ['stash', 'pop', '--index'], cwd: repoRoot }

    it('warns, listing them, then stashes them for the build and puts them back before restarting Blind', async () => {
      const { code, events, stderr } = await cli(['install'], { changes, blindPid: 42 })
      expect(stderr).toBe([
        'Building the last commit only. These uncommitted changes are stashed during the build, then put back:',
        '   M GLOSSARY.md',
        '  M  src/core/core.ts',
        '  ?? src/core/build.ts',
        'A running `blind dev` reloads onto the last commit meanwhile.',
        '',
      ].join('\n'))
      expect(events).toEqual([
        stashPush,
        installApp,
        stashPop,
        { command: 'open', args: ['-a', '/Applications/Blind.app', 'blind://restart'], cwd: undefined },
      ])
      expect(code).toBe(0)
    })

    it('puts them back when the build fails or is interrupted, exiting with its exit code, restarting nothing', async () => {
      const { code, events } = await cli(['install', '--force'], { changes, blindPid: 42, exitCodes: { npm: 130 } })
      expect(events).toEqual([stashPush, installApp, stashPop])
      expect(code).toBe(130)
    })

    it('says how to get them back when putting them back fails, exiting 1 before restarting Blind', async () => {
      const { code, events, stdout, stderr } = await cli(['install', '--force'], {
        changes,
        blindPid: 42,
        exitCodes: { 'git stash pop --index': 1 },
      })
      expect(events).toEqual([stashPush, installApp, stashPop])
      expect(stderr).toMatch(/\n$/)
      expect(stderr.split('\n').at(-2)).toBe(
        'Couldn\'t put the uncommitted changes back, so Blind wasn\'t restarted. They\'re still stashed as "blind install: uncommitted changes": find them with `git stash list`, then put them back with `git stash pop --index`.'
      )
      expect(stdout).toBe('')
      expect(code).toBe(1)
    })

    it("builds nothing when they can't be stashed, exiting with git's exit code", async () => {
      const { code, events } = await cli(['install'], { changes, blindPid: 42, exitCodes: { git: 128 } })
      expect(events).toEqual([stashPush])
      expect(code).toBe(128)
    })
  })

  it('with no uncommitted changes, warns of nothing and stashes nothing', async () => {
    const { events, stderr } = await cli(['install'])
    expect(events).toEqual([installApp])
    expect(stderr).toBe('')
  })
})

describe('blind link', () => {
  const link = { command: 'npm', args: ['link'], cwd: repoRoot }

  it('runs npm link in the repo, saying so once it has', async () => {
    const { code, events, stdout } = await cli(['link'])
    expect(events).toEqual([link])
    expect(stdout).toBe('Linked.\n')
    expect(code).toBe(0)
  })

  it('exits with npm link\'s exit code when it fails, adding nothing to npm\'s own output', async () => {
    const { code, events, stdout, stderr } = await cli(['link'], { exitCode: 5 })
    expect(events).toEqual([link])
    expect(stdout).toBe('')
    expect(stderr).toBe('')
    expect(code).toBe(5)
  })
})

describe('the usage line', () => {
  it.each([
    ['when no command is given', []],
    ['for an unknown command', ['frobnicate']],
    ['for an unknown settings subcommand', ['settings', 'frobnicate']],
    ['for an unknown install option', ['install', '--frobnicate']],
    ['for an argument after link', ['link', 'extra']],
    ['for themes alone', ['themes']],
    ['for an unknown themes subcommand', ['themes', 'frobnicate']],
    ['for themes import without a file', ['themes', 'import']],
    ['for themes import with two files', ['themes', 'import', 'Dracula.conf', 'Nord.conf']],
  ])('is printed %s, running nothing', async (_, argv) => {
    const { code, events, stderr } = await cli(argv)
    expect(stderr).toBe(
      'usage: blind settings [open] | blind themes import <file> | blind dev | blind install | blind link\n'
    )
    expect(code).toBe(2)
    expect(events).toEqual([])
  })
})

describe('blind themes import', () => {
  // A Kitty theme with Dracula's foreground, background and ANSI colours.
  const draculaKitty = [
    'foreground #f8f8f2',
    'background #282a36',
    ...['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2', '#6272a4', '#ff6e6e',
      '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff'].map((colour, index) => `color${index} ${colour}`),
  ].join('\n')

  // Runs the CLI with `sources` as the files there are to Import, by path, and `themeFiles` in the themes folder, which
  // takes every write unless `writable` is false. Writes are recorded in order.
  async function importing (argv: string[], { sources = {}, themeFiles = [], writable = true }: {
    sources?: Record<string, string>;
    themeFiles?: ThemeFile[];
    writable?: boolean;
  } = {}) {
    const written: unknown[] = []
    let stdout = ''
    let stderr = ''
    const code = await runCli(argv, createFakeDependencies({
      themeFiles: {
        directory: fakeThemesFolder,
        read: () => themeFiles,
        write: (fileName, text) => {
          if (writable) written.push({ fileName, text })
          return writable
        },
        writeSchema: () => { written.push('schema') },
      },
      readThemeSource: (path) => ({ fileName: basename(path), text: sources[path] }),
      stdout: (text) => { stdout += text },
      stderr: (text) => { stderr += text },
    }))
    return { code, written, stdout, stderr }
  }

  it('writes the Theme file, named after the file, to the themes folder and says where', async () => {
    const { code, written, stdout } = await importing(['themes', 'import', 'kitty/Dracula.conf'], {
      sources: { 'kitty/Dracula.conf': draculaKitty },
    })
    expect(written[0]).toMatchObject({ fileName: 'Dracula.jsonc' })
    const theme = readJsonc((written[0] as ThemeFile).text) as unknown as Theme
    expect(theme.name).toBe('Dracula')
    expect(theme.terminal).toMatchObject({ background: '#282a36', foreground: '#f8f8f2', blue: '#bd93f9' })
    expect(stdout).toBe(`Imported Dracula to ${fakeThemesFolder}/Dracula.jsonc.\n`)
    expect(code).toBe(0)
  })

  it('writes the Theme schema next to it, for a Theme file written before Blind has launched', async () => {
    const { written } = await importing(['themes', 'import', 'Dracula.conf'], {
      sources: { 'Dracula.conf': draculaKitty },
    })
    expect(written).toEqual([expect.objectContaining({ fileName: 'Dracula.jsonc' }), 'schema'])
  })

  it.each([
    [
      'a file that can\'t be read',
      'Dracula.conf',
      {},
      "Couldn't import Dracula.conf. It isn't an iTerm2, Ghostty, Kitty, Alacritty or Windows Terminal theme.\n",
    ],
    [
      'a file that isn\'t a theme',
      'Dracula.conf',
      { sources: { 'Dracula.conf': 'font_family JetBrains Mono\nfont_size 14\n' } },
      "Couldn't import Dracula.conf. It isn't an iTerm2, Ghostty, Kitty, Alacritty or Windows Terminal theme.\n",
    ],
    [
      'a theme leaving out a colour',
      'Dracula.conf',
      { sources: { 'Dracula.conf': draculaKitty.replace(/^color8 .*$/m, '') } },
      "Couldn't import Dracula.conf. It leaves out color8.\n",
    ],
    [
      'a built-in Theme\'s name, ignoring case',
      'gruvbox.conf',
      { sources: { 'gruvbox.conf': draculaKitty } },
      "Couldn't import gruvbox.conf. Gruvbox is a built-in Theme. Rename gruvbox.conf and import it again.\n",
    ],
    [
      'a name a Theme file\'s Theme has, ignoring case',
      'Dracula.conf',
      { sources: { 'Dracula.conf': draculaKitty }, themeFiles: [{ fileName: 'Vampire.jsonc', text: '{ "name": "dracula" }' }] },
      "Couldn't import Dracula.conf. The Theme file Vampire.jsonc already has the name dracula. Rename Dracula.conf and import it again.\n",
    ],
    [
      'a file name the themes folder has, ignoring case',
      'Dracula.conf',
      { sources: { 'Dracula.conf': draculaKitty }, themeFiles: [{ fileName: 'dracula.jsonc', text: '{ "name": "Vampire" }' }] },
      "Couldn't import Dracula.conf. The themes folder already has dracula.jsonc. Rename Dracula.conf and import it again.\n",
    ],
  ])('refuses %s, saying why, exiting 1 and writing nothing', async (_, file, options, message) => {
    const { code, written, stdout, stderr } = await importing(['themes', 'import', file], options)
    expect(stderr).toBe(message)
    expect(stdout).toBe('')
    expect(written).toEqual([])
    expect(code).toBe(1)
  })

  it('exits 1 when the Theme file can\'t be written, which the Theme files report, writing no schema', async () => {
    const { code, written, stdout, stderr } = await importing(['themes', 'import', 'Dracula.conf'], {
      sources: { 'Dracula.conf': draculaKitty },
      writable: false,
    })
    expect(stderr).toBe('')
    expect(stdout).toBe('')
    expect(written).toEqual([])
    expect(code).toBe(1)
  })
})
