import { describe, expect, it } from 'vitest'
import { createFakeDependencies, fakeConfigPath } from './fakes'
import { runCli } from './run'

const repoRoot = '/repos/blind'

interface Options {
  exitCode?: number;
  // Exit codes by command, in place of `exitCode`.
  exitCodes?: Record<string, number>;
  editor?: string;
  configCreatable?: boolean;
  // The installed Blind's process, while it's running.
  blindPid?: number;
}

// Runs the CLI against fakes: what it does is recorded in order, each command it runs exits with `exitCode`, and the
// config file exists afterwards unless `configCreatable` is false.
async function cli (argv: string[], options: Options = {}) {
  const { exitCode = 0, exitCodes = {}, editor, configCreatable = true, blindPid } = options
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
      return exitCodes[command] ?? exitCode
    },
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
})

describe('the usage line', () => {
  it('is printed for an unknown install option', async () => {
    const { code, events, stderr } = await cli(['install', '--frobnicate'])
    expect(stderr).toBe('usage: blind settings [open] | blind dev | blind install\n')
    expect(code).toBe(2)
    expect(events).toEqual([])
  })

  it('is printed when no command is given', async () => {
    const { code, events, stderr } = await cli([])
    expect(stderr).toBe('usage: blind settings [open] | blind dev | blind install\n')
    expect(code).toBe(2)
    expect(events).toEqual([])
  })

  it('is printed for an unknown command', async () => {
    const { code, events, stderr } = await cli(['frobnicate'])
    expect(stderr).toBe('usage: blind settings [open] | blind dev | blind install\n')
    expect(code).toBe(2)
    expect(events).toEqual([])
  })

  it('is printed for an unknown settings subcommand', async () => {
    const { code, events, stderr } = await cli(['settings', 'frobnicate'])
    expect(stderr).toBe('usage: blind settings [open] | blind dev | blind install\n')
    expect(code).toBe(2)
    expect(events).toEqual([])
  })
})
