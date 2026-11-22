import { setTimeout as delay } from 'node:timers/promises'
import type { ShellOnQuit } from '../core/config'
import type { PaneReport, SavedScrollback, ShellFromBefore } from '../core/ports'
import type { PaneId } from '../core/state'
import { createHeadlessPane, type HeadlessPane } from './headless-pane'
import { type AppMessage, type BlindSpotMessage, protocolVersion } from './protocol'

// A Shell's pseudo-terminal, as node-pty runs it.
export interface Pty {
  pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  pause(): void;
  resume(): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: () => void): void;
}

export interface BlindSpotDependencies {
  // Runs `shell` as a login shell in a pseudo-terminal of the size given.
  spawnShell(options: { shell: string; workingDirectory: string; cols: number; rows: number }): Pty;
  // Read from the Shell's process, rejecting once it has exited.
  workingDirectoryOf(pid: number): Promise<string | undefined>;
  // The program in the Shell's foreground, or undefined while the Shell itself is, idle at a prompt.
  runningProgramOf(pid: number): Promise<string | undefined>;
  // Keeps what Blind Spot keeps for the next app where a launching app finds it, even once Blind Spot is gone, e.g.
  // once it ended with no Shell left, or after an OS restart.
  save(kept: KeptForNextApp): void;
  // What an earlier Blind Spot kept and no app has taken yet.
  kept?: KeptForNextApp;
  now(): number;
  // No app is connected and no Shell runs, or an app asked for every Shell to end: Blind Spot has nothing left to do.
  end(): void;
  // How long after a Pane's output its working directory and running program are read again.
  inspectionDelayMilliseconds?: number;
  // How long after a windowless Pane's output its scrollback is reported, as a window's terminal waits before reporting.
  reportDelayMilliseconds?: number;
  // How long Blind Spot waits for the app that started it to connect before it ends.
  firstConnectionWaitMilliseconds?: number;
}

// What Blind Spot keeps while no app is connected, for the next one: the Panes' scrollback saved meanwhile, and the
// Shells that exited meanwhile, with what their Panes reported first.
export interface KeptForNextApp {
  scrollback: Record<PaneId, SavedScrollback>;
  exited: ShellFromBefore[];
}

// The app connected to Blind Spot, which takes its messages.
export interface AppConnection {
  send(message: BlindSpotMessage): void;
  close(): void;
}

export interface BlindSpot {
  // An app connected, taking the place of any connected before. Answers how its messages are taken and its going.
  connected(connection: AppConnection): { received(message: AppMessage): void; closed(): void };
}

// Where a Shell's output goes besides its headless terminal: held for the window that first shows the Pane, sent to
// that window, or, with no window, nowhere, the Pane's scrollback then reported from its headless terminal.
type PaneWindow =
  | { state: 'awaited'; buffered: string[] }
  | { state: 'attached' }
  | { state: 'windowless'; reportTimer?: NodeJS.Timeout }

interface RunningShell {
  paneId: PaneId;
  pty: Pty;
  headless: HeadlessPane;
  window: PaneWindow;
  // What the Pane reported while no app was connected, for the next one.
  missed: PaneReport[];
  // Last reported.
  workingDirectory: string;
  runningProgram?: string;
  // The last title reported since the running program was last read, held until it's read again.
  pendingTitle?: string;
  inspecting: boolean;
  outputSinceInspection: boolean;
}

// The size a Shell starts at, until the window showing it gives its own.
const startingSize = { cols: 80, rows: 24 }

// Holds the Shells, so that they outlive the app that started them. Each Shell's output feeds a headless terminal from
// its start, which keeps the Pane's whole state while no window shows it: then it answers the program's queries and
// reports what asks for the user's attention, and the Pane's scrollback, to the app, or, with no app connected, keeps
// them for the next one.
export function createBlindSpot (dependencies: BlindSpotDependencies): BlindSpot {
  const { inspectionDelayMilliseconds = 250, reportDelayMilliseconds = 1_000 } = dependencies
  const shells = new Map<PaneId, RunningShell>()
  let app: AppConnection | undefined
  let onQuit: ShellOnQuit = 'keepRunning'
  let kept: KeptForNextApp = dependencies.kept ?? { scrollback: {}, exited: [] }

  function keep (next: KeptForNextApp) {
    kept = next
    dependencies.save(kept)
  }
  setTimeout(() => endIfIdle(), dependencies.firstConnectionWaitMilliseconds ?? 30_000).unref()

  function send (message: BlindSpotMessage) {
    app?.send(message)
  }

  function report (running: RunningShell, paneReport: PaneReport) {
    if (app) send({ type: 'report', report: paneReport })
    else running.missed.push(paneReport)
  }

  function reportScrollbackText (paneId: PaneId, scrollback: string) {
    if (app) return send({ type: 'scrollback', paneId, scrollback })
    keep({ ...kept, scrollback: { ...kept.scrollback, [paneId]: { text: scrollback, savedAt: dependencies.now() } } })
  }

  function cancelScrollbackReport (running: RunningShell) {
    if (running.window.state !== 'windowless') return
    clearTimeout(running.window.reportTimer)
    running.window.reportTimer = undefined
  }

  async function reportScrollback (running: RunningShell) {
    cancelScrollbackReport(running)
    reportScrollbackText(running.paneId, await running.headless.scrollback())
  }

  // A fresh Shell already in the Pane's place has taken over its scrollback, so the exited Shell's last output since its
  // last report is lost then.
  async function reportExitedScrollback (running: RunningShell) {
    cancelScrollbackReport(running)
    const scrollback = await running.headless.scrollback()
    running.headless.dispose()
    if (!shells.has(running.paneId)) reportScrollbackText(running.paneId, scrollback)
  }

  function endIfIdle () {
    if (!app && shells.size === 0) dependencies.end()
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
          dependencies.workingDirectoryOf(running.pty.pid),
          dependencies.runningProgramOf(running.pty.pid),
        ])
        if (shells.get(paneId) !== running) break
        if (workingDirectory && workingDirectory !== running.workingDirectory) {
          running.workingDirectory = workingDirectory
          report(running, { type: 'workingDirectoryChanged', paneId, workingDirectory })
        }
        if (runningProgram !== running.runningProgram) {
          running.runningProgram = runningProgram
          report(running, { type: 'runningProgramChanged', paneId, runningProgram })
        }
        if (title !== undefined) report(running, { type: 'titleChanged', paneId, title })
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

  function reportTitle (paneId: PaneId, title: string) {
    const running = shells.get(paneId)
    if (!running) return
    running.pendingTitle = title
    inspectSoon(running)
  }

  // From here its headless terminal answers for it, as no window does.
  function makeWindowless (running: RunningShell) {
    running.window = { state: 'windowless' }
    running.headless.watch(true)
  }

  // With no app connected, it starts with no window to wait for. A Shell already in the Pane, which an app that lost
  // touch with Blind Spot counts as gone, ends.
  function start ({ paneId, workingDirectory, shell, scrollbackLines, restoredOutput }: Extract<AppMessage, { type: 'start' }>) {
    const replaced = shells.get(paneId)
    if (replaced) {
      cancelScrollbackReport(replaced)
      replaced.pty.kill()
      replaced.headless.dispose()
    }
    const pty = dependencies.spawnShell({ shell, workingDirectory, ...startingSize })
    const headless = createHeadlessPane({
      ...startingSize,
      scrollbackLines,
      onReply: (data) => pty.write(data),
      onNotification: () => report(running, { type: 'notification', paneId }),
      onProgramStatus: (status) => report(running, { type: 'programStatus', paneId, report: status }),
      onTitle: (title) => reportTitle(paneId, title),
    })
    if (restoredOutput !== undefined) headless.write(restoredOutput)
    const running: RunningShell = {
      paneId,
      pty,
      headless,
      window: { state: 'awaited', buffered: [] },
      missed: [],
      workingDirectory,
      inspecting: false,
      outputSinceInspection: false,
    }
    if (!app) makeWindowless(running)
    shells.set(paneId, running)
    pty.onData((data) => {
      headless.write(data)
      const { window } = running
      if (window.state === 'attached') send({ type: 'data', paneId, data })
      if (window.state === 'awaited') window.buffered.push(data)
      if (window.state === 'windowless') {
        window.reportTimer ??= setTimeout(() => reportScrollback(running), reportDelayMilliseconds)
      }
      inspectSoon(running)
    })
    // A windowless Pane stays, its Shell gone, so its output is kept for the fresh Shell to follow. With no app
    // connected, what the Pane reported is kept too, for the fresh Shell to start from.
    pty.onExit(() => {
      if (shells.get(paneId) !== running) return
      shells.delete(paneId)
      if (app) send({ type: 'report', report: { type: 'shellExited', paneId } })
      else keep({ ...kept, exited: [...kept.exited, { paneId, missed: running.missed, exited: true }] })
      if (running.window.state === 'windowless') reportExitedScrollback(running)
      else headless.dispose()
      endIfIdle()
    })
  }

  async function attach (paneId: PaneId) {
    const running = shells.get(paneId)
    if (!running) return send({ type: 'attached', paneId })
    if (running.window.state !== 'windowless') {
      const buffered = running.window.state === 'awaited' ? running.window.buffered : []
      running.window = { state: 'attached' }
      for (const data of buffered) send({ type: 'data', paneId, data })
      return send({ type: 'attached', paneId })
    }
    running.pty.pause()
    try {
      const replay = await running.headless.replay()
      if (shells.get(paneId) !== running || running.window.state !== 'windowless') return
      cancelScrollbackReport(running)
      running.window = { state: 'attached' }
      running.headless.watch(false)
      send({ type: 'data', paneId, data: replay })
    } finally {
      running.pty.resume()
      send({ type: 'attached', paneId })
    }
  }

  // Its scrollback is reported at once, being the latest the Pane has.
  function windowClosed (paneId: PaneId) {
    const running = shells.get(paneId)
    if (running?.window.state !== 'attached') return
    makeWindowless(running)
    reportScrollback(running)
  }

  // Answers with the Shells running and what was kept for the app, which takes them over from here, when the versions
  // match.
  function welcome (version: number) {
    if (version !== protocolVersion) return send({ type: 'welcome', version: protocolVersion })
    const running: ShellFromBefore[] = [...shells.values()].map(({ paneId, missed }) => ({ paneId, missed }))
    send({ type: 'welcome', version: protocolVersion, shells: [...running, ...kept.exited], scrollback: kept.scrollback })
    for (const shell of shells.values()) shell.missed = []
    keep({ scrollback: {}, exited: [] })
  }

  function shutdown () {
    for (const running of shells.values()) running.pty.kill()
    shells.clear()
    app?.close()
    app = undefined
    dependencies.end()
  }

  async function received (message: AppMessage) {
    if (message.type === 'hello') {
      onQuit = message.onQuit
      return welcome(message.version)
    }
    if (message.type === 'shutdown') return shutdown()
    if (message.type === 'onQuit') onQuit = message.onQuit
    if (message.type === 'start') start(message)
    if (message.type === 'stop') shells.get(message.paneId)?.pty.kill()
    if (message.type === 'write') shells.get(message.paneId)?.pty.write(message.data)
    if (message.type === 'resize') {
      const running = shells.get(message.paneId)
      running?.pty.resize(message.cols, message.rows)
      running?.headless.resize(message.cols, message.rows)
    }
    if (message.type === 'attach') await attach(message.paneId)
    if (message.type === 'windowClosed') windowClosed(message.paneId)
    if (message.type === 'reportTitle') reportTitle(message.paneId, message.title)
    if (message.type === 'setScrollbackLines') {
      for (const running of shells.values()) running.headless.setScrollbackLines(message.lines)
    }
    if (message.type === 'reportWindowlessScrollback') {
      const windowless = [...shells.values()].filter((running) => running.window.state === 'windowless')
      await Promise.all(windowless.map(reportScrollback))
      send({ type: 'windowlessScrollbackReported', requestId: message.requestId })
    }
  }

  // Every Pane is windowless once its app has gone, and its scrollback saved from now. Shells the app was to end on
  // quitting end with it, however it went.
  function appGone () {
    app = undefined
    for (const running of shells.values()) {
      if (running.window.state === 'windowless') continue
      makeWindowless(running)
      reportScrollback(running)
    }
    if (onQuit === 'end') for (const running of shells.values()) running.pty.kill()
  }

  return {
    // An app connecting before the one before it is seen to go has taken its place, so that one has gone.
    connected (connection) {
      const previous = app
      if (previous) {
        appGone()
        previous.close()
      }
      app = connection
      return {
        received,
        closed () {
          if (app !== connection) return
          appGone()
          endIfIdle()
        },
      }
    },
  }
}
