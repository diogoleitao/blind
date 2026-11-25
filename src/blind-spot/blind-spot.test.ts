import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Terminal } from '@xterm/xterm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ShellOnQuit } from '../core/config'
import type { Build, SavedScrollback, ShellEvent } from '../core/ports'
import { createBlindSpotShellHost } from '../main/blind-spot-shell-host'
import { createBlindSpot, type KeptForNextApp, type Pty } from './blind-spot'
import { protocolVersion, receiveMessages, sendMessage } from './protocol'
import { serveBlindSpot } from './server'

// A pseudo-terminal whose Shell's output, exit and process the test decides.
interface FakePty extends Pty {
  shell: string;
  written: string[];
  killed: boolean;
  output(data: string): void;
  exit(): void;
}

function createFakePty (shell: string, pid: number): FakePty {
  const dataListeners: ((data: string) => void)[] = []
  const exitListeners: (() => void)[] = []
  let exited = false
  const pty: FakePty = {
    pid,
    shell,
    written: [],
    killed: false,
    write: (data) => pty.written.push(data),
    resize: () => {},
    kill: () => {
      pty.killed = true
      pty.exit()
    },
    pause: () => {},
    resume: () => {},
    onData: (listener) => dataListeners.push(listener),
    onExit: (listener) => exitListeners.push(listener),
    output: (data) => dataListeners.forEach((listener) => listener(data)),
    exit: () => {
      if (exited) return
      exited = true
      exitListeners.forEach((listener) => listener())
    },
  }
  return pty
}

const directories: string[] = []
const servers: Server[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

// A place for Blind Spot's socket, and what launching Blind Spot there starts: one in this process, with fake ptys
// whose working directory and running program the test sets. Each Blind Spot launched is listed, with what it saved and
// whether it has ended.
function createWorld () {
  const directory = mkdtempSync(join(tmpdir(), 'blind-spot-'))
  directories.push(directory)
  const socketPath = join(directory, 'blind-spot.sock')
  const ptys: FakePty[] = []
  const inspected = new Map<number, { workingDirectory?: string; runningProgram?: string }>()
  const launched: { ended: boolean; saved: Record<string, SavedScrollback>[]; sockets: Socket[]; server?: Server }[] = []
  let keptOnDisk: KeptForNextApp | undefined
  // How many launches from now start nothing, as though Blind Spot failed to start.
  let launchesFailing = 0

  function launch () {
    if (launchesFailing > 0) {
      launchesFailing -= 1
      return
    }
    const instance: (typeof launched)[number] = { ended: false, saved: [], sockets: [] }
    launched.push(instance)
    const blindSpot = createBlindSpot({
      spawnShell: ({ shell }) => {
        const pty = createFakePty(shell, ptys.length + 1)
        ptys.push(pty)
        return pty
      },
      workingDirectoryOf: async (pid) => {
        world.inspections += 1
        return inspected.get(pid)?.workingDirectory
      },
      runningProgramOf: async (pid) => inspected.get(pid)?.runningProgram,
      save: (kept) => {
        instance.saved.push(kept.scrollback)
        keptOnDisk = kept
      },
      kept: keptOnDisk,
      now: () => 5_000,
      build: world.build,
      end: () => {
        instance.ended = true
        instance.server?.close()
      },
      inspectionDelayMilliseconds: 1,
      reportDelayMilliseconds: 1,
    })
    serveBlindSpot(blindSpot, socketPath).then((server) => {
      if (!server) return
      instance.server = server
      servers.push(server)
      server.on('connection', (socket) => instance.sockets.push(socket))
    })
  }

  // An app's ShellHost, with what it heard.
  function app ({ onQuit = 'keepRunning' }: { onQuit?: ShellOnQuit } = {}) {
    const events: ShellEvent[] = []
    const notifications: string[] = []
    const scrollback = new Map<string, string>()
    const host = createBlindSpotShellHost({
      socketPath,
      launch,
      loginShell: '/bin/zsh',
      scrollbackLines: () => 1_000,
      onQuit: () => onQuit,
      restoredOutput: () => undefined,
      launchTimeoutMilliseconds: 200,
      windowlessReports: {
        notification: (paneId) => notifications.push(paneId),
        programStatus: () => {},
        scrollback: (paneId, text) => scrollback.set(paneId, text),
      },
    })
    host.subscribe((event) => events.push(event))
    return { host, events, notifications, scrollback }
  }

  // Ends Blind Spot as though it crashed: its connections close with no word.
  function crash () {
    const instance = launched.at(-1)!
    for (const socket of instance.sockets) socket.destroy()
    instance.server?.close()
  }

  const failLaunches = (count: number) => {
    launchesFailing = count
  }

  const world = {
    socketPath,
    ptys,
    inspected,
    inspections: 0,
    // The Build each Blind Spot launched from now runs.
    build: { version: '0.0.0', commit: '45e9d74b1c0a8f3e2d6b9a7c5e4f3d2c1b0a9e8f' } as Build,
    launched,
    launch,
    app,
    crash,
    failLaunches,
  }
  return world
}

// Attaches a window to the Pane, answering what it was sent.
async function attachWindow (host: ReturnType<ReturnType<typeof createWorld>['app']>['host'], paneId: string) {
  const received: string[] = []
  const onData = (data: string) => received.push(data)
  await host.attach(paneId, onData)
  return { received, onData }
}

// What a terminal shows after being written the data, line by line, trailing spaces trimmed.
async function screenOf (data: string) {
  const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true })
  await new Promise<void>((resolve) => terminal.write(data, resolve))
  const lines = []
  for (let y = 0; y < terminal.buffer.active.length; y++) {
    lines.push(terminal.buffer.active.getLine(y)!.translateToString(true))
  }
  terminal.dispose()
  return lines.join('\n').trimEnd()
}

describe('Blind Spot', () => {
  it('is started by the first app, which then runs its Shells there', async () => {
    const world = createWorld()
    const { host } = world.app()

    await host.connect()
    host.start('pane-1', { workingDirectory: '/Users/me', shell: '/bin/bash' })

    await vi.waitFor(() => expect(world.ptys.map((pty) => pty.shell)).toEqual(['/bin/bash']))
    expect(world.launched).toHaveLength(1)
    expect(host.shellsFromBefore()).toEqual([])
  })

  it("holds a Shell's output until a window shows its Pane, then passes it on live", async () => {
    const world = createWorld()
    const { host } = world.app()
    await host.connect()
    host.start('pane-1', { workingDirectory: '/Users/me' })
    await vi.waitFor(() => expect(world.ptys).toHaveLength(1))
    world.ptys[0].output('$ ')

    const window = await attachWindow(host, 'pane-1')
    world.ptys[0].output('ls')

    await vi.waitFor(() => expect(window.received).toEqual(['$ ', 'ls']))
    host.write('pane-1', 'x')
    await vi.waitFor(() => expect(world.ptys[0].written).toEqual(['x']))
  })

  it('keeps the Shells running after the app goes, for the next app to find, each Pane shown as it was', async () => {
    const world = createWorld()
    const first = world.app()
    await first.host.connect()
    first.host.start('pane-1', { workingDirectory: '/Users/me' })
    await vi.waitFor(() => expect(world.ptys).toHaveLength(1))
    await attachWindow(first.host, 'pane-1')
    world.ptys[0].output('$ vim\r\n\x1b[?1049h\x1b[?1hediting')

    first.host.close()
    const next = world.app()
    await next.host.connect()

    expect(world.launched).toHaveLength(1)
    expect(world.ptys[0].killed).toBe(false)
    expect(next.host.shellsFromBefore()).toEqual([{ paneId: 'pane-1', missed: [] }])
    expect(next.host.isWindowless('pane-1')).toBe(true)
    const window = await attachWindow(next.host, 'pane-1')
    const replay = window.received.join('')
    expect(replay).toContain('\x1b[?1049h')
    expect(replay).toContain('\x1b[?1h')
    // The alternate screen keeps the cursor's row, below the prompt.
    expect(await screenOf(replay)).toBe('\nediting')
  })

  it('hands the next app what each Pane reported while no app was there, in order', async () => {
    const world = createWorld()
    const first = world.app()
    await first.host.connect()
    first.host.start('pane-1', { workingDirectory: '/Users/me' })
    await vi.waitFor(() => expect(world.ptys).toHaveLength(1))
    first.host.close()
    await vi.waitFor(() => expect(world.launched[0].saved.at(-1)).toHaveProperty('pane-1'))

    world.inspected.set(1, { workingDirectory: '/Users/me/api', runningProgram: 'claude' })
    world.ptys[0].output('\x1b]9;Done\x07')
    await vi.waitFor(() => expect(world.inspections).toBeGreaterThan(0))
    await new Promise((resolve) => setTimeout(resolve, 20))
    const next = world.app()
    await next.host.connect()

    expect(next.host.shellsFromBefore()).toEqual([
      {
        paneId: 'pane-1',
        missed: [
          { type: 'notification', paneId: 'pane-1' },
          { type: 'workingDirectoryChanged', paneId: 'pane-1', workingDirectory: '/Users/me/api' },
          { type: 'runningProgramChanged', paneId: 'pane-1', runningProgram: 'claude' },
        ],
      },
    ])
  })

  it('saves scrollback while no app is there, handing it to the next app, and saving it no longer', async () => {
    const world = createWorld()
    const first = world.app()
    await first.host.connect()
    first.host.start('pane-1', { workingDirectory: '/Users/me' })
    await vi.waitFor(() => expect(world.ptys).toHaveLength(1))
    first.host.close()

    world.ptys[0].output('built in 3s')
    await vi.waitFor(() => expect(world.launched[0].saved.at(-1)?.['pane-1']?.text).toContain('built in 3s'))
    const next = world.app()
    await next.host.connect()

    expect(next.host.savedScrollback()['pane-1']).toEqual({ text: expect.stringContaining('built in 3s'), savedAt: 5_000 })
    expect(world.launched[0].saved.at(-1)).toEqual({})
  })

  it('hands the next app what a Shell that exited while no app was there reported, its last scrollback saved, and ends with none left', async () => {
    const world = createWorld()
    const first = world.app()
    await first.host.connect()
    first.host.start('pane-1', { workingDirectory: '/Users/me' })
    await vi.waitFor(() => expect(world.ptys).toHaveLength(1))
    first.host.close()
    await vi.waitFor(() => expect(world.launched[0].saved.at(-1)).toHaveProperty('pane-1'))
    world.inspected.set(1, { workingDirectory: '/Users/me/api' })
    world.ptys[0].output('last words')
    await vi.waitFor(() => expect(world.inspections).toBeGreaterThan(0))
    await new Promise((resolve) => setTimeout(resolve, 20))

    world.ptys[0].exit()

    await vi.waitFor(() => expect(world.launched[0].ended).toBe(true))
    await vi.waitFor(() => expect(world.launched[0].saved.at(-1)?.['pane-1']?.text).toContain('last words'))
    const next = world.app()
    await next.host.connect()
    expect(world.launched).toHaveLength(2)
    expect(next.host.shellsFromBefore()).toEqual([
      {
        paneId: 'pane-1',
        missed: [{ type: 'workingDirectoryChanged', paneId: 'pane-1', workingDirectory: '/Users/me/api' }],
        exited: true,
      },
    ])
    expect(next.host.isWindowless('pane-1')).toBe(false)
    expect(next.host.savedScrollback()['pane-1']?.text).toContain('last words')
  })

  it('ends the Shells as the app goes, however it goes, while the app would end them on quitting', async () => {
    const world = createWorld()
    const { host } = world.app({ onQuit: 'end' })
    await host.connect()
    host.start('pane-1', { workingDirectory: '/Users/me' })
    await vi.waitFor(() => expect(world.ptys).toHaveLength(1))

    host.close()

    await vi.waitFor(() => expect(world.ptys[0].killed).toBe(true))
    await vi.waitFor(() => expect(world.launched[0].ended).toBe(true))
  })

  it('reports a windowless Pane\'s Activity and scrollback to the app, once its window closed', async () => {
    const world = createWorld()
    const { host, notifications, scrollback } = world.app()
    await host.connect()
    host.start('pane-1', { workingDirectory: '/Users/me' })
    await vi.waitFor(() => expect(world.ptys).toHaveLength(1))
    const window = await attachWindow(host, 'pane-1')

    host.windowClosed('pane-1', window.onData)
    await vi.waitFor(() => expect(scrollback.has('pane-1')).toBe(true))
    world.ptys[0].output('tests passed\x1b]9;Done\x07')

    await vi.waitFor(() => expect(notifications).toEqual(['pane-1']))
    await vi.waitFor(() => expect(scrollback.get('pane-1')).toContain('tests passed'))
    expect(host.isWindowless('pane-1')).toBe(true)
  })

  it('tells the app when it is lost, and is started again for the fresh Shells, until one is reached', async () => {
    const world = createWorld()
    const { host, events } = world.app()
    await host.connect()
    host.start('pane-1', { workingDirectory: '/Users/me' })
    await vi.waitFor(() => expect(world.ptys).toHaveLength(1))
    world.failLaunches(2)

    world.crash()
    await vi.waitFor(() => expect(events).toEqual([{ type: 'shellsLost' }]))
    host.start('pane-1', { workingDirectory: '/Users/me' })

    await vi.waitFor(() => expect(world.ptys).toHaveLength(2), { timeout: 5_000 })
    expect(world.launched).toHaveLength(2)
  })

  it('tries again when a Blind Spot closes before it welcomes, e.g. as it ends, rather than taking it for another version', async () => {
    const world = createWorld()
    // A Blind Spot just ending: it takes one connection, closes it, and goes.
    const ending = createServer((socket) => {
      socket.destroy()
      ending.close()
    })
    await new Promise<void>((resolve) => ending.listen(world.socketPath, resolve))
    const { host } = world.app()

    const { endedOtherVersion } = await host.connect()

    expect(endedOtherVersion).toBe(false)
    expect(world.launched).toHaveLength(1)
  })

  it('is ended, with its Shells, by an app from another version, which starts its own', async () => {
    const world = createWorld()
    const shutdowns: string[] = []
    // A Blind Spot from another version: it answers hello with its own version, and ends on shutdown.
    const older = createServer((socket) => {
      receiveMessages<{ type: string }>(socket, (message) => {
        if (message.type === 'hello') sendMessage(socket, { type: 'welcome', version: 0 })
        if (message.type === 'shutdown') {
          shutdowns.push('shutdown')
          socket.destroy()
          older.close()
        }
      })
    })
    await new Promise<void>((resolve) => older.listen(world.socketPath, resolve))
    const { host } = world.app()

    const { endedOtherVersion } = await host.connect()

    expect(endedOtherVersion).toBe(true)
    expect(shutdowns).toEqual(['shutdown'])
    expect(world.launched).toHaveLength(1)
    expect(host.shellsFromBefore()).toEqual([])
  })
})

describe("Blind Spot's Build", () => {
  it('is what Blind Spot welcomes the app with', async () => {
    const world = createWorld()
    world.build = { version: '0.1.0', commit: 'b6c7143a9e8f7d6c5b4a3f2e1d0c9b8a7f6e5d4c' }
    const { host } = world.app()

    await host.connect()

    expect(host.blindSpotBuild()).toEqual({ version: '0.1.0', commit: 'b6c7143a9e8f7d6c5b4a3f2e1d0c9b8a7f6e5d4c' })
  })

  it('is none from a Blind Spot of this version that welcomes without one, which the app keeps, not ending it', async () => {
    const world = createWorld()
    const received: string[] = []
    // A Blind Spot from before Builds were reported: it welcomes as one of this version did then.
    const older = createServer((socket) => {
      receiveMessages<{ type: string }>(socket, (message) => {
        received.push(message.type)
        if (message.type === 'hello') sendMessage(socket, { type: 'welcome', version: protocolVersion, shells: [] })
      })
    })
    servers.push(older)
    await new Promise<void>((resolve) => older.listen(world.socketPath, resolve))
    const { host } = world.app()

    const { endedOtherVersion } = await host.connect()

    expect(endedOtherVersion).toBe(false)
    expect(host.blindSpotBuild()).toBeUndefined()
    expect(received).toEqual(['hello'])
    expect(world.launched).toHaveLength(0)
  })
})
