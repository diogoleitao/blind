import { describe, expect, it } from 'vitest'
import { runCli } from './run'

const repoRoot = '/repos/blind'
const configPath = '/home/.config/blind/config.jsonc'

// Runs the CLI against fakes: what it does is recorded in order, each command it runs exits with `exitCode`, and the
// config file exists afterwards unless `configCreatable` is false.
async function cli (
  argv: string[],
  { exitCode = 0, editor, configCreatable = true }: { exitCode?: number, editor?: string, configCreatable?: boolean } = {}
) {
  const events: unknown[] = []
  let stderr = ''
  const code = await runCli(argv, {
    repoRoot,
    editor,
    configFile: {
      path: configPath,
      createIfMissing: () => {
        events.push('config file created if missing')
        return configCreatable
      },
    },
    run: async (command, args, cwd) => {
      events.push({ command, args, cwd })
      return exitCode
    },
    stderr: (text) => { stderr += text },
  })
  return { code, events, stderr }
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
      { command: '/bin/sh', args: ['-c', 'code --wait "$@"', 'sh', configPath], cwd: undefined },
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
      { command: 'open', args: [configPath], cwd: undefined },
    ])
    expect(code).toBe(1)
  })

  it('opens nothing and exits 1 when the config file can\'t be created', async () => {
    const { code, events } = await cli(['settings', 'open'], { editor: 'vim', configCreatable: false })
    expect(events).toEqual(['config file created if missing'])
    expect(code).toBe(1)
  })
})

describe('the usage line', () => {
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
