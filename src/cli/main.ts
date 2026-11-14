#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { constants } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCli } from './run.js'

// out/cli/main.js -> the repo root. Node resolves `npm link`'s symlinks before running this, so it's the repo itself.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

process.exitCode = await runCli(process.argv.slice(2), {
  repoRoot,
  run,
  stderr: (text) => { process.stderr.write(text) },
})

// Ctrl+C reaches the command as well, as it shares the terminal; ignoring it here lets this exit with the command's
// own exit code once the command has stopped. A command killed by a signal exits as a shell reports it, 128 plus the
// signal's number, and one that can't be started as a shell reports a missing command, 127.
function run (command: string, args: string[], cwd: string) {
  return new Promise<number>((resolve) => {
    const ignore = () => {}
    process.on('SIGINT', ignore)
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.on('error', (error) => {
      process.off('SIGINT', ignore)
      process.stderr.write(`blind: couldn't run ${command}: ${error.message}\n`)
      resolve(127)
    })
    child.on('exit', (code, signal) => {
      process.off('SIGINT', ignore)
      resolve(code ?? 128 + constants.signals[signal!])
    })
  })
}
