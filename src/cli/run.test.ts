import { describe, expect, it } from 'vitest'
import { runCli } from './run'

const repoRoot = '/repos/blind'

// Runs the CLI against fakes: each command it runs is recorded and exits with `exitCode`.
async function cli (argv: string[], exitCode = 0) {
  const runs: { command: string, args: string[], cwd: string }[] = []
  let stderr = ''
  const code = await runCli(argv, {
    repoRoot,
    run: async (command, args, cwd) => {
      runs.push({ command, args, cwd })
      return exitCode
    },
    stderr: (text) => { stderr += text },
  })
  return { code, runs, stderr }
}

describe('blind dev', () => {
  it('runs npm run dev in the repo and exits with its exit code', async () => {
    const { code, runs } = await cli(['dev'], 3)
    expect(runs).toEqual([{ command: 'npm', args: ['run', 'dev'], cwd: repoRoot }])
    expect(code).toBe(3)
  })
})

describe('the usage line', () => {
  it('is printed when no command is given', async () => {
    const { code, runs, stderr } = await cli([])
    expect(stderr).toBe('usage: blind settings [open] | blind dev | blind install\n')
    expect(code).toBe(2)
    expect(runs).toEqual([])
  })

  it('is printed for an unknown command', async () => {
    const { code, runs, stderr } = await cli(['frobnicate'])
    expect(stderr).toBe('usage: blind settings [open] | blind dev | blind install\n')
    expect(code).toBe(2)
    expect(runs).toEqual([])
  })
})
