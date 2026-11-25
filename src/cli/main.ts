#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process'
import { constants, homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { loadThemes } from '../core/themes'
import { createConfigFile } from '../main/config-file'
import { createThemeFiles, readThemeSource } from '../main/theme-files'
import { installedApp, runCli } from './run'
import { createTerminal } from './terminal'

// out/cli/main.js -> the repo root. Node resolves `npm link`'s symlinks before running this, so it's the repo itself.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Always the installed app's, never the dev app's.
const configDirectory = join(homedir(), '.config', 'blind')
// A failure shows its error's message, e.g. `EACCES: permission denied, open '...'`, rather than its stack.
const themeFiles = createThemeFiles(join(configDirectory, 'themes'), (message, error) => {
  process.stderr.write(`${message} ${error instanceof Error ? error.message : String(error)}\n`)
})

process.exitCode = await runCli(process.argv.slice(2), {
  repoRoot,
  editor: process.env.EDITOR,
  configFile: createConfigFile(configDirectory),
  themeNames: () => loadThemes(themeFiles.read()).themes.map((theme) => theme.name),
  themeFiles,
  readThemeSource,
  terminal: createTerminal(),
  run,
  uncommittedChanges,
  runningBlindPid,
  relaunchAfterExit,
  terminate,
  stdout: (text) => { process.stdout.write(text) },
  stderr: (text) => { process.stderr.write(text) },
})

// While the command runs, nothing that stops it stops this first, so this exits with the command's own exit code once
// it has stopped, and `blind install` puts stashed changes back however its build ends. Ctrl+C, and the hangup of a
// terminal closing, reach the command as well, as it shares the terminal, so this ignores them; a hangup or a
// termination sent to this alone is passed on to the command. A command killed by a signal exits as a shell reports it,
// 128 plus the signal's number, and one that can't be started as a shell reports a missing command, 127.
function run (command: string, args: string[], cwd?: string) {
  return new Promise<number>((resolve) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    const ignore = () => {}
    const passOn = (signal: NodeJS.Signals) => { child.kill(signal) }
    process.on('SIGINT', ignore)
    process.on('SIGHUP', passOn)
    process.on('SIGTERM', passOn)
    const stopped = (exitCode: number) => {
      process.off('SIGINT', ignore)
      process.off('SIGHUP', passOn)
      process.off('SIGTERM', passOn)
      resolve(exitCode)
    }
    child.on('error', (error) => {
      process.stderr.write(`blind: couldn't run ${command}: ${error.message}\n`)
      stopped(127)
    })
    child.on('exit', (code, signal) => stopped(code ?? 128 + constants.signals[signal!]))
  })
}

// The porcelain format is `--short`'s, kept stable for scripts. Every untracked file is listed, not just its folder.
async function uncommittedChanges () {
  const { stdout } = await promisify(execFile)('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: repoRoot })
  return stdout.split('\n').filter((line) => line !== '')
}

// Matched by the executable it runs, so neither its helper processes nor the app running from the repo count.
async function runningBlindPid () {
  const executable = `${installedApp}/Contents/MacOS/Blind`
  const { stdout } = await promisify(execFile)('ps', ['-Ao', 'pid=,command='])
  const found = stdout
    .split('\n')
    .map((line) => /^\s*(\d+) (.*)$/.exec(line))
    .find((match) => match && (match[2] === executable || match[2].startsWith(`${executable} `)))
  return found ? Number(found[1]) : undefined
}

// `sh` in a process group of its own, detached from this one's terminal, so it lives on when Blind quitting closes it.
function relaunchAfterExit (pid: number) {
  const script = `while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; open -a ${installedApp}`
  spawn('/bin/sh', ['-c', script, 'sh', String(pid)], { detached: true, stdio: 'ignore' }).unref()
}

// A process that's already gone has stopped, as asked.
function terminate (pid: number) {
  try {
    process.kill(pid, 'SIGTERM')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}
