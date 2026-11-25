// Blind Spot: the background process that holds the Shells, so they keep running after the app quits. The app starts it
// from its own executable run as Node, detached, passing the socket to listen on and the file to keep what it keeps for
// the next app in.
import { execFile } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import { spawn } from 'node-pty'
import { build } from '../shared/build'
import { createBlindSpot, type KeptForNextApp } from './blind-spot'
import { serveBlindSpot } from './server'

const execFileAsync = promisify(execFile)

const [socketPath, keptFile] = process.argv.slice(2)

// Electron's and npm's own variables don't belong in the user's Shell. `TERM_PROGRAM` names blind, replacing the value of
// any terminal blind itself was started from.
function shellEnvironment () {
  const inherited = Object.entries(process.env).filter(
    ([name]) => !name.startsWith('ELECTRON_') && !name.startsWith('npm_')
  )
  return { ...Object.fromEntries(inherited), TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'blind' }
}

// Read from the process, so no shell configuration is needed.
async function workingDirectoryOf (pid: number) {
  const { stdout } = await execFileAsync('lsof', ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'])
  return stdout
    .split('\n')
    .find((line) => line.startsWith('n'))
    ?.slice(1)
}

// The leader of the terminal's foreground process group, or undefined while the Shell itself is in the
// foreground, idle at a prompt. `comm` is the name the program gives itself: an executable's path, or a title
// such as npm's `npm exec` (its process is `node`), whose first word is the program.
async function runningProgramOf (pid: number) {
  const { stdout: group } = await execFileAsync('ps', ['-o', 'tpgid=', '-p', String(pid)])
  const foreground = Number(group.trim())
  if (!foreground || foreground === pid) return undefined
  const { stdout: command } = await execFileAsync('ps', ['-o', 'comm=', '-p', String(foreground)])
  const name = command.trim()
  return (name.startsWith('/') ? basename(name) : name.split(' ')[0]) || undefined
}

// Unreadable or missing, nothing was kept.
function readKept (): KeptForNextApp | undefined {
  try {
    return JSON.parse(readFileSync(keptFile, 'utf8'))
  } catch {
    return undefined
  }
}

const blindSpot = createBlindSpot({
  spawnShell: ({ shell, workingDirectory, cols, rows }) =>
    spawn(shell, ['-l'], { name: 'xterm-256color', cols, rows, cwd: workingDirectory, env: shellEnvironment() }),
  workingDirectoryOf,
  runningProgramOf,
  // Gone once an app has taken it all.
  save: (kept) => {
    if (Object.keys(kept.scrollback).length === 0 && kept.exited.length === 0) rmSync(keptFile, { force: true })
    else writeFileSync(keptFile, JSON.stringify(kept))
  },
  kept: readKept(),
  now: () => Date.now(),
  build,
  end: () => process.exit(0),
})

const server = await serveBlindSpot(blindSpot, socketPath)
if (!server) process.exit(0)
