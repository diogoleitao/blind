import { SerializeAddon } from '@xterm/addon-serialize'
// A CommonJS bundle whose exports Node can't name when the main process loads it as an ES module, so it comes in whole.
import headless, { type Terminal } from '@xterm/headless'
import {
  isNotification,
  notificationOscs,
  programStatus,
  programStatusSupported,
  type ProgramStatusReport,
} from '../core/attention'

const { Terminal: HeadlessTerminal } = headless

export interface HeadlessPane {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  // While watching, it answers the program's queries and passes on what asks for the user's attention and the titles the
  // program sets. A window's terminal does all of it while the Pane is attached to one, so the Pane watches only once
  // its window has closed.
  watch(watching: boolean): void;
  // As a window's terminal takes a change to the scrollback lines setting.
  setScrollbackLines(lines: number): void;
  // What a fresh terminal is written first to take this one's place: its screen, scrollback, cursor and every mode the
  // program set, once everything written so far is in.
  replay(): Promise<string>;
  // The scrollback saved for Restore, as a window's terminal reports it: without a full-screen program's screen or the
  // modes, which belong to a process that won't be there after Restore.
  scrollback(): Promise<string>;
  dispose(): void;
}

export interface HeadlessPaneOptions {
  cols: number;
  rows: number;
  scrollbackLines: number;
  onReply(data: string): void;
  onNotification(): void;
  onProgramStatus(report: ProgramStatusReport): void;
  onTitle(title: string): void;
}

// The DEC private modes the serialize addon already replays, from the terminal's modes or with the alternate screen,
// and those unsafe to replay: 3 clears the screen, 1048 saves the cursor, and 2026 would hold back drawing until the
// program next ends a frame.
const modesNotTracked = new Set([1, 3, 6, 7, 9, 45, 47, 66, 1000, 1002, 1003, 1004, 1047, 1048, 1049, 2004, 2026])

// A terminal with no screen, fed the Shell's output from its start, so a Pane keeps its whole state while no window
// shows it. Beside what the terminal's modes tell, it keeps the modes, scroll region and character set a program sets
// through the sequences it watches for, which the serialize addon leaves out.
export function createHeadlessPane (options: HeadlessPaneOptions): HeadlessPane {
  // The serialize addon reads the terminal through what headless xterm.js counts as proposed API.
  const terminal = new HeadlessTerminal({
    cols: options.cols,
    rows: options.rows,
    scrollback: options.scrollbackLines,
    allowProposedApi: true,
  })
  const serialize = new SerializeAddon()
  terminal.loadAddon(serialize as unknown as Parameters<Terminal['loadAddon']>[0])
  let watching = false
  // Each mode's last state, set or reset, by its number.
  const modes = new Map<number, boolean>()
  // Absent while the scroll region is the whole screen.
  let scrollRegion: { top: number; bottom: number } | undefined
  let lineDrawing = false

  function forget () {
    modes.clear()
    scrollRegion = undefined
    lineDrawing = false
  }

  function trackModes (params: (number | number[])[], set: boolean) {
    for (const param of params) {
      if (typeof param === 'number' && !modesNotTracked.has(param)) modes.set(param, set)
    }
    return false
  }

  // Returning false leaves each sequence to the terminal's own handling too.
  terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => trackModes(params, true))
  terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params) => trackModes(params, false))
  terminal.parser.registerCsiHandler({ final: 'r' }, (params) => {
    const top = typeof params[0] === 'number' && params[0] > 0 ? params[0] : 1
    const bottom = typeof params[1] === 'number' && params[1] > 0 ? params[1] : terminal.rows
    if (top < bottom) scrollRegion = top === 1 && bottom === terminal.rows ? undefined : { top, bottom }
    return false
  })
  terminal.parser.registerEscHandler({ intermediates: '(', final: '0' }, () => {
    lineDrawing = true
    return false
  })
  terminal.parser.registerEscHandler({ intermediates: '(', final: 'B' }, () => {
    lineDrawing = false
    return false
  })
  terminal.parser.registerEscHandler({ final: 'c' }, () => {
    forget()
    return false
  })
  terminal.parser.registerCsiHandler({ intermediates: '!', final: 'p' }, () => {
    forget()
    return false
  })

  terminal.onData((data) => {
    if (watching) options.onReply(data)
  })
  terminal.onTitleChange((title) => {
    if (watching) options.onTitle(title)
  })
  terminal.parser.registerOscHandler(7501, (payload) => {
    if (!watching) return true
    const status = programStatus(payload)
    if (status?.type === 'query') options.onReply(programStatusSupported)
    if (status?.type === 'report') options.onProgramStatus({ id: status.id, state: status.state })
    return true
  })
  for (const osc of notificationOscs) {
    terminal.parser.registerOscHandler(osc, (payload) => {
      if (watching && isNotification(osc, payload)) options.onNotification()
      return true
    })
  }

  // Resolves once the terminal has taken in everything written to it so far.
  function parsed () {
    return new Promise<void>((resolve) => terminal.write('', resolve))
  }

  // Setting the scroll region homes the cursor, so the cursor's place goes last, counted from the region's top in
  // origin mode.
  function trackedStateSequences () {
    let sequences = [...modes].map(([mode, set]) => `\x1b[?${mode}${set ? 'h' : 'l'}`).join('')
    if (scrollRegion) sequences += `\x1b[${scrollRegion.top};${scrollRegion.bottom}r`
    if (lineDrawing) sequences += '\x1b(0'
    const { cursorX, cursorY } = terminal.buffer.active
    const row = cursorY + 1 - (terminal.modes.originMode && scrollRegion ? scrollRegion.top - 1 : 0)
    return `${sequences}\x1b[${row};${cursorX + 1}H`
  }

  return {
    write (data) {
      terminal.write(data)
    },
    // The terminal sets the scroll region back to the whole screen as it resizes.
    resize (cols, rows) {
      terminal.resize(cols, rows)
      scrollRegion = undefined
    },
    watch (next) {
      watching = next
    },
    setScrollbackLines (lines) {
      terminal.options.scrollback = lines
    },
    async replay () {
      await parsed()
      return serialize.serialize({ scrollback: terminal.options.scrollback }) + trackedStateSequences()
    },
    async scrollback () {
      await parsed()
      return serialize.serialize({ scrollback: terminal.options.scrollback, excludeAltBuffer: true, excludeModes: true })
    },
    dispose () {
      terminal.dispose()
    },
  }
}
