import { connect as connectSocket, type Socket } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { type AppMessage, type BlindSpotMessage, protocolVersion, receiveMessages, sendMessage } from '../blind-spot/protocol'
import type { ProgramStatusReport } from '../core/attention'
import type { ShellOnQuit } from '../core/config'
import type { Build, SavedScrollback, ShellEvent, ShellFromBefore, ShellHost } from '../core/ports'
import type { PaneId } from '../core/state'
import type { TerminalSize } from '../shared/ipc'

export interface BlindSpotShellHost extends ShellHost {
  // Connects to Blind Spot before the core starts, starting it when none runs. Answers whether a Blind Spot from another
  // version had to be ended first, its Shells with it, e.g. after an update. Rejects when none can be reached.
  connect(): Promise<{ endedOtherVersion: boolean }>;
  // Output produced before a Pane is first attached is held and sent on attach. A windowless Pane attached to a new
  // window is first sent its headless terminal's replay. Settles once the window has everything before the live output.
  attach(paneId: PaneId, onData: (data: string) => void): Promise<void>;
  // The window showing the Pane through `onData` is closing. The Shell keeps running, watched by its headless terminal.
  windowClosed(paneId: PaneId, onData: (data: string) => void): void;
  isWindowless(paneId: PaneId): boolean;
  // Reports every windowless Pane's scrollback, for a save before quitting.
  reportWindowlessScrollback(): Promise<void>;
  // As a window's terminals take a change to the scrollback lines setting.
  setScrollbackLines(lines: number): void;
  // What Blind Spot does with the Shells should the app go without ending them.
  setOnQuit(onQuit: ShellOnQuit): void;
  write(paneId: PaneId, data: string): void;
  resize(paneId: PaneId, size: TerminalSize): void;
  // A title the Pane's terminal read from its output, passed on once the running program has been read after it.
  reportTitle(paneId: PaneId, title: string): void;
  // The app is going: Blind Spot keeps the Shells, unless told to end them, and is not started again.
  close(): void;
}

// What a windowless Pane's headless terminal passes on, as a window's terminal does for an attached one.
export interface WindowlessPaneReports {
  notification(paneId: PaneId): void;
  programStatus(paneId: PaneId, report: ProgramStatusReport): void;
  scrollback(paneId: PaneId, scrollback: string): void;
}

export interface BlindSpotShellHostOptions {
  socketPath: string;
  // Starts Blind Spot, which listens on the socket shortly after.
  launch(): void;
  loginShell: string;
  scrollbackLines(): number;
  onQuit(): ShellOnQuit;
  restoredOutput(paneId: PaneId): string | undefined;
  windowlessReports: WindowlessPaneReports;
  // How long connecting waits for a Blind Spot just started to listen.
  launchTimeoutMilliseconds?: number;
}

// Where the app sends a Pane's output: nowhere yet, before a window shows it; to that window; or nowhere, its window
// closed, or the Pane kept from before the app started.
type PaneWindow = { state: 'awaited' } | { state: 'attached'; onData: (data: string) => void } | { state: 'windowless' }

const retryMilliseconds = 50

// Reaches the Blind Spot listening on the socket, or starts one and waits for it to listen. A connection that breaks
// once reached closes, which is all its callers need to hear of it.
async function reach (socketPath: string, launch: () => void, timeoutMilliseconds: number) {
  let launched = false
  const deadline = Date.now() + timeoutMilliseconds
  for (;;) {
    try {
      return await new Promise<Socket>((resolve, reject) => {
        const socket = connectSocket(socketPath)
        socket.once('connect', () => {
          socket.off('error', reject)
          socket.on('error', () => {})
          resolve(socket)
        })
        socket.once('error', reject)
      })
    } catch (error) {
      if (Date.now() > deadline) throw error
      if (!launched) launch()
      launched = true
      await delay(retryMilliseconds)
    }
  }
}

// The Shells run in Blind Spot, so they outlive the app. Messages wait while no Blind Spot is reached, e.g. after it has
// gone, which ends every Shell; another Blind Spot is started then, to run fresh ones.
export function createBlindSpotShellHost (options: BlindSpotShellHostOptions): BlindSpotShellHost {
  const { socketPath, launch, launchTimeoutMilliseconds = 5_000 } = options
  const listeners: ((event: ShellEvent) => void)[] = []
  const panes = new Map<PaneId, PaneWindow>()
  const attaching = new Map<PaneId, () => void>()
  const scrollbackReports = new Map<number, () => void>()
  let lastRequestId = 0
  let socket: Socket | undefined
  // Messages sent while no Blind Spot is reached, sent once one is.
  let waiting: AppMessage[] = []
  let fromBefore: ShellFromBefore[] = []
  let saved: Record<PaneId, SavedScrollback> = {}
  // What the Blind Spot reached last welcomed with.
  let blindSpotBuild: Build | undefined

  function emit (event: ShellEvent) {
    for (const listener of listeners) listener(event)
  }

  function send (message: AppMessage) {
    if (socket) sendMessage(socket, message)
    else waiting.push(message)
  }

  function received (message: BlindSpotMessage) {
    if (message.type === 'data') {
      const window = panes.get(message.paneId)
      if (window?.state === 'attached') window.onData(message.data)
    }
    if (message.type === 'attached') {
      attaching.get(message.paneId)?.()
      attaching.delete(message.paneId)
    }
    if (message.type === 'scrollback') options.windowlessReports.scrollback(message.paneId, message.scrollback)
    if (message.type === 'windowlessScrollbackReported') {
      scrollbackReports.get(message.requestId)?.()
      scrollbackReports.delete(message.requestId)
    }
    if (message.type === 'report') {
      const { report } = message
      if (report.type === 'notification') return options.windowlessReports.notification(report.paneId)
      if (report.type === 'programStatus') return options.windowlessReports.programStatus(report.paneId, report.report)
      if (report.type === 'shellExited') panes.delete(report.paneId)
      emit(report)
    }
  }

  // Says hello, answering with Blind Spot's welcome, or undefined when it closes, or doesn't answer in time, before it
  // welcomes. Every message after the welcome goes to `received`.
  function greet (reached: Socket) {
    return new Promise<Extract<BlindSpotMessage, { type: 'welcome' }> | undefined>((resolve) => {
      const timer = setTimeout(() => reached.destroy(), launchTimeoutMilliseconds)
      let welcomed = false
      receiveMessages<BlindSpotMessage>(reached, (message) => {
        if (welcomed) return received(message)
        if (message.type !== 'welcome') return
        welcomed = true
        clearTimeout(timer)
        resolve(message)
      })
      reached.once('close', () => {
        clearTimeout(timer)
        resolve(undefined)
      })
      sendMessage(reached, { type: 'hello', version: protocolVersion, onQuit: options.onQuit() })
    })
  }

  // Ends the Blind Spot reached, from another version, and waits for it to go, or for a while at most.
  function shutdown (reached: Socket) {
    return new Promise<void>((resolve) => {
      if (reached.destroyed) return resolve()
      const timer = setTimeout(() => reached.destroy(), launchTimeoutMilliseconds)
      reached.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
      sendMessage(reached, { type: 'shutdown' })
    })
  }

  // Reaches a Blind Spot of this version and answers with its welcome, ending one of another version first, which it
  // says it did. One that closes before it welcomes, e.g. as it ends, or that can't be reached in time, is tried again,
  // up to `attempts` times in all.
  async function establish (attempts: number) {
    let endedOtherVersion = false
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const reached = await reach(socketPath, launch, launchTimeoutMilliseconds)
        const welcome = await greet(reached)
        if (welcome?.version === protocolVersion) return { reached, welcome, endedOtherVersion }
        if (welcome) {
          endedOtherVersion = true
          await shutdown(reached)
        } else {
          reached.destroy()
        }
      } catch {
        // Not reached in time; tried again below.
      }
      await delay(retryMilliseconds)
    }
    throw new Error(`Blind Spot couldn't be reached at ${socketPath}`)
  }

  // From here messages go to the Blind Spot reached, those that waited first, and its Build is the one its welcome
  // reported, if any. Losing it ends every Shell.
  function connected (reached: Socket, welcome: Extract<BlindSpotMessage, { type: 'welcome' }>) {
    socket = reached
    blindSpotBuild = welcome.build
    reached.once('close', lost)
    for (const message of waiting) sendMessage(reached, message)
    waiting = []
  }

  // The Shells went with Blind Spot. A window waiting on one has all it will get, and another Blind Spot is started for
  // the fresh Shells, tried until one is reached; the fresh Shells' messages wait for it. Should the connection alone
  // have broken, the Blind Spot reached again ends each Shell a fresh one takes the place of.
  async function lost () {
    socket = undefined
    panes.clear()
    for (const settle of [...attaching.values(), ...scrollbackReports.values()]) settle()
    attaching.clear()
    scrollbackReports.clear()
    emit({ type: 'shellsLost' })
    const { reached, welcome } = await establish(Infinity)
    connected(reached, welcome)
  }

  return {
    async connect () {
      const { reached, welcome, endedOtherVersion } = await establish(3)
      fromBefore = welcome.shells ?? []
      saved = welcome.scrollback ?? {}
      for (const { paneId, exited } of fromBefore) if (!exited) panes.set(paneId, { state: 'windowless' })
      connected(reached, welcome)
      return { endedOtherVersion }
    },
    shellsFromBefore: () => fromBefore,
    savedScrollback: () => saved,
    blindSpotBuild: () => blindSpotBuild,
    start (paneId, { workingDirectory, shell = options.loginShell }) {
      panes.set(paneId, { state: 'awaited' })
      send({
        type: 'start',
        paneId,
        workingDirectory,
        shell,
        scrollbackLines: options.scrollbackLines(),
        restoredOutput: options.restoredOutput(paneId),
      })
    },
    stop (paneId) {
      send({ type: 'stop', paneId })
    },
    subscribe (listener) {
      listeners.push(listener)
    },
    attach (paneId, onData) {
      if (!panes.has(paneId)) return Promise.resolve()
      panes.set(paneId, { state: 'attached', onData })
      return new Promise<void>((resolve) => {
        attaching.get(paneId)?.()
        attaching.set(paneId, resolve)
        send({ type: 'attach', paneId })
      })
    },
    windowClosed (paneId, onData) {
      const window = panes.get(paneId)
      if (window?.state !== 'attached' || window.onData !== onData) return
      panes.set(paneId, { state: 'windowless' })
      send({ type: 'windowClosed', paneId })
    },
    isWindowless: (paneId) => panes.get(paneId)?.state === 'windowless',
    reportWindowlessScrollback () {
      if (!socket) return Promise.resolve()
      lastRequestId += 1
      const requestId = lastRequestId
      return new Promise<void>((resolve) => {
        scrollbackReports.set(requestId, resolve)
        send({ type: 'reportWindowlessScrollback', requestId })
      })
    },
    setScrollbackLines (lines) {
      send({ type: 'setScrollbackLines', lines })
    },
    setOnQuit (onQuit) {
      send({ type: 'onQuit', onQuit })
    },
    write (paneId, data) {
      send({ type: 'write', paneId, data })
    },
    resize (paneId, { cols, rows }) {
      send({ type: 'resize', paneId, cols, rows })
    },
    reportTitle (paneId, title) {
      send({ type: 'reportTitle', paneId, title })
    },
    close () {
      socket?.off('close', lost)
      socket?.end()
      socket = undefined
    },
  }
}
