import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { spawn, type IPty } from 'node-pty'
import type { ProgramStatusReport } from '../core/attention'
import type { ShellEvent, ShellHost } from '../core/ports'
import type { PaneId } from '../core/state'
import type { TerminalSize } from '../shared/ipc'
import { createHeadlessPane, type HeadlessPane } from './headless-pane'

const execFileAsync = promisify(execFile)

// How long after a Pane's output its working directory and running program are read again.
// Output marks every change: a new prompt after `cd` or a program exiting, a program's own output, or the echo of Enter.
const inspectionDelayMilliseconds = 250

// How long after a windowless Pane's output its scrollback is reported, as a window's terminal waits before reporting.
const windowlessReportDelayMilliseconds = 1_000

export interface NodePtyShellHost extends ShellHost {
  // Output produced before a Pane is first attached is buffered and replayed on attach. A windowless Pane attached to a
  // new window is first sent its headless terminal's replay, its output held back meanwhile.
  attach(paneId: PaneId, onData: (data: string) => void): Promise<void>;
  // The window showing the Pane through `onData` is closing. The Shell keeps running, watched by its headless terminal.
  windowClosed(paneId: PaneId, onData: (data: string) => void): void;
  isWindowless(paneId: PaneId): boolean;
  // Reports every windowless Pane's scrollback, for a save before quitting.
  reportWindowlessScrollback(): Promise<void>;
  // As a window's terminals take a change to the scrollback lines setting.
  setScrollbackLines(lines: number): void;
  write(paneId: PaneId, data: string): void;
  resize(paneId: PaneId, size: TerminalSize): void;
  // A title the Pane's terminal read from its output, passed on once the running program has been read after it.
  reportTitle(paneId: PaneId, title: string): void;
}

// What a windowless Pane's headless terminal passes on, as a window's terminal does for an attached one.
export interface WindowlessPaneReports {
  notification(paneId: PaneId): void;
  programStatus(paneId: PaneId, report: ProgramStatusReport): void;
  scrollback(paneId: PaneId, scrollback: string): void;
}

// Where a Shell's output goes besides its headless terminal: held for the window that first shows the Pane, sent to
// that window, or, once the window has closed, nowhere, the Pane's scrollback then reported from its headless terminal.
type PaneWindow =
  | { state: 'awaited'; buffered: string[] }
  | { state: 'attached'; onData: (data: string) => void }
  | { state: 'windowless'; reportTimer?: NodeJS.Timeout }

interface RunningShell {
  paneId: PaneId;
  pty: IPty;
  headless: HeadlessPane;
  window: PaneWindow;
  // Last reported to the core.
  workingDirectory: string;
  runningProgram?: string;
  // The last title reported since the running program was last read, held until it's read again.
  pendingTitle?: string;
  inspecting: boolean;
  outputSinceInspection: boolean;
}

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

// Runs each Pane's Shell as a login shell in a pseudo-terminal, `loginShell` unless the core asks for another. Each
// Shell's output also feeds a headless terminal from the start, which keeps the Pane's whole state once its window
// closes and the Shell runs on. A restored Pane's headless terminal starts from what its window shows first: the
// `restoredOutput` before the fresh Shell's.
export function createNodePtyShellHost ({
  loginShell,
  scrollbackLines,
  restoredOutput,
  windowlessReports,
}: {
  loginShell: string;
  scrollbackLines: () => number;
  restoredOutput: (paneId: PaneId) => string | undefined;
  windowlessReports: WindowlessPaneReports;
}): NodePtyShellHost {
  const shells = new Map<PaneId, RunningShell>()
  const listeners: ((event: ShellEvent) => void)[] = []

  function cancelScrollbackReport (running: RunningShell) {
    if (running.window.state !== 'windowless') return
    clearTimeout(running.window.reportTimer)
    running.window.reportTimer = undefined
  }

  async function reportScrollback (running: RunningShell) {
    cancelScrollbackReport(running)
    windowlessReports.scrollback(running.paneId, await running.headless.scrollback())
  }

  // A fresh Shell already in the Pane's place, as its Session reopened in the meantime, has taken over its scrollback,
  // so the exited Shell's last output since its last report is lost then.
  async function reportExitedScrollback (running: RunningShell) {
    cancelScrollbackReport(running)
    const scrollback = await running.headless.scrollback()
    running.headless.dispose()
    if (!shells.has(running.paneId)) windowlessReports.scrollback(running.paneId, scrollback)
  }

  function emit (event: ShellEvent) {
    for (const listener of listeners) listener(event)
  }

  // Reports working directory and running program changes until no output arrived during the last read. A title
  // reported before a read is passed on after it, so the core judges it by the program running once it was set: a
  // program can set its title before it's seen running, and the Shell can set its own once the program has exited.
  async function inspect (running: RunningShell) {
    const { paneId } = running
    running.inspecting = true
    while (running.outputSinceInspection && shells.get(paneId) === running) {
      running.outputSinceInspection = false
      await delay(inspectionDelayMilliseconds)
      const title = running.pendingTitle
      running.pendingTitle = undefined
      try {
        const [workingDirectory, runningProgram] = await Promise.all([
          workingDirectoryOf(running.pty.pid),
          runningProgramOf(running.pty.pid),
        ])
        if (shells.get(paneId) !== running) break
        if (workingDirectory && workingDirectory !== running.workingDirectory) {
          running.workingDirectory = workingDirectory
          emit({ type: 'workingDirectoryChanged', paneId, workingDirectory })
        }
        if (runningProgram !== running.runningProgram) {
          running.runningProgram = runningProgram
          emit({ type: 'runningProgramChanged', paneId, runningProgram })
        }
        if (title !== undefined) emit({ type: 'titleChanged', paneId, title })
      } catch {
        // The Shell exited while it was being read; its exit is reported separately.
      }
    }
    running.inspecting = false
  }

  // Reads the Shell again after the delay, or once more after the read under way.
  function inspectSoon (running: RunningShell) {
    running.outputSinceInspection = true
    if (!running.inspecting) inspect(running)
  }

  return {
    start (paneId, { workingDirectory, shell = loginShell }) {
      const pty = spawn(shell, ['-l'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: workingDirectory,
        env: shellEnvironment(),
      })
      const headless = createHeadlessPane({
        cols: 80,
        rows: 24,
        scrollbackLines: scrollbackLines(),
        onReply: (data) => pty.write(data),
        onNotification: () => windowlessReports.notification(paneId),
        onProgramStatus: (report) => windowlessReports.programStatus(paneId, report),
        onTitle: (title) => reportTitle(paneId, title),
      })
      const restored = restoredOutput(paneId)
      if (restored !== undefined) headless.write(restored)
      const running: RunningShell = {
        paneId,
        pty,
        headless,
        window: { state: 'awaited', buffered: [] },
        workingDirectory,
        inspecting: false,
        outputSinceInspection: false,
      }
      shells.set(paneId, running)
      pty.onData((data) => {
        headless.write(data)
        const { window } = running
        if (window.state === 'attached') window.onData(data)
        if (window.state === 'awaited') window.buffered.push(data)
        if (window.state === 'windowless') {
          window.reportTimer ??= setTimeout(() => reportScrollback(running), windowlessReportDelayMilliseconds)
        }
        inspectSoon(running)
      })
      // A windowless Pane stays, its Shell gone, so its output is kept for the fresh Shell to follow.
      pty.onExit(() => {
        shells.delete(paneId)
        emit({ type: 'shellExited', paneId })
        if (running.window.state === 'windowless') reportExitedScrollback(running)
        else headless.dispose()
      })
    },
    stop (paneId) {
      shells.get(paneId)?.pty.kill()
    },
    subscribe (listener) {
      listeners.push(listener)
    },
    async attach (paneId, onData) {
      const running = shells.get(paneId)
      if (!running) return
      if (running.window.state !== 'windowless') {
        const buffered = running.window.state === 'awaited' ? running.window.buffered : []
        running.window = { state: 'attached', onData }
        for (const data of buffered) onData(data)
        return
      }
      running.pty.pause()
      try {
        const replay = await running.headless.replay()
        if (shells.get(paneId) !== running || running.window.state !== 'windowless') return
        cancelScrollbackReport(running)
        running.window = { state: 'attached', onData }
        running.headless.watch(false)
        onData(replay)
      } finally {
        running.pty.resume()
      }
    },
    // Its scrollback is reported at once, being the latest the Pane has.
    windowClosed (paneId, onData) {
      const running = shells.get(paneId)
      if (running?.window.state !== 'attached' || running.window.onData !== onData) return
      running.window = { state: 'windowless' }
      running.headless.watch(true)
      reportScrollback(running)
    },
    isWindowless: (paneId) => shells.get(paneId)?.window.state === 'windowless',
    async reportWindowlessScrollback () {
      const windowless = [...shells.values()].filter((running) => running.window.state === 'windowless')
      await Promise.all(windowless.map(reportScrollback))
    },
    setScrollbackLines (lines) {
      for (const running of shells.values()) running.headless.setScrollbackLines(lines)
    },
    write (paneId, data) {
      shells.get(paneId)?.pty.write(data)
    },
    resize (paneId, { cols, rows }) {
      const running = shells.get(paneId)
      running?.pty.resize(cols, rows)
      running?.headless.resize(cols, rows)
    },
    reportTitle,
  }

  function reportTitle (paneId: PaneId, title: string) {
    const running = shells.get(paneId)
    if (!running) return
    running.pendingTitle = title
    inspectSoon(running)
  }
}
