import { Terminal } from '@xterm/headless'
import { describe, expect, it } from 'vitest'
import { programStatusSupported, type ProgramStatusReport } from '../core/attention'
import { createHeadlessPane } from './headless-pane'

function startPane () {
  const replies: string[] = []
  const notifications: number[] = []
  const reports: ProgramStatusReport[] = []
  const titles: string[] = []
  const pane = createHeadlessPane({
    cols: 40,
    rows: 10,
    scrollbackLines: 100,
    onReply: (data) => replies.push(data),
    onNotification: () => notifications.push(1),
    onProgramStatus: (report) => reports.push(report),
    onTitle: (title) => titles.push(title),
  })
  return { pane, replies, notifications, reports, titles }
}

// A fresh terminal, as a reopened Session's window opens one, with the replay written into it.
async function replayedInto (replay: string) {
  const terminal = new Terminal({ cols: 40, rows: 10, allowProposedApi: true })
  await new Promise<void>((resolve) => terminal.write(replay, resolve))
  return terminal
}

function screenText (terminal: Terminal) {
  const buffer = terminal.buffer.active
  const lines: string[] = []
  for (let y = 0; y < terminal.rows; y += 1) lines.push(buffer.getLine(buffer.viewportY + y)!.translateToString(true))
  return lines.join('\n').trimEnd()
}

describe('a headless Pane', () => {
  it("replays a full-screen program's screen, cursor and modes into a fresh terminal", async () => {
    const { pane } = startPane()
    pane.write('$ vim notes.md\r\n')
    pane.write('\x1b[?1049h\x1b[?1h\x1b[?2004h\x1b[?1000h\x1b[?1004h\x1b[H~\r\n~\r\n"notes.md" 2L\x1b[2;3H')

    const terminal = await replayedInto(await pane.replay())

    expect(terminal.buffer.active.type).toBe('alternate')
    expect(screenText(terminal)).toBe('~\n~\n"notes.md" 2L')
    expect([terminal.buffer.active.cursorY, terminal.buffer.active.cursorX]).toEqual([1, 2])
    expect(terminal.modes).toMatchObject({
      applicationCursorKeysMode: true,
      bracketedPasteMode: true,
      mouseTrackingMode: 'vt200',
      sendFocusMode: true,
    })
  })

  it("replays what a terminal's modes leave out: mouse encoding, cursor visibility, scroll region and character set", async () => {
    const { pane } = startPane()
    pane.write('\x1b[?1000h\x1b[?1006h\x1b[?25l\x1b[2;8r\x1b(0\x1b[5;4H')

    const replay = await pane.replay()

    for (const sequence of ['\x1b[?1006h', '\x1b[?25l', '\x1b[2;8r', '\x1b(0']) expect(replay).toContain(sequence)
    const terminal = await replayedInto(replay)
    expect([terminal.buffer.active.cursorY, terminal.buffer.active.cursorX]).toEqual([4, 3])
  })

  it('replays the same state again from a Pane fed its replay', async () => {
    const { pane } = startPane()
    pane.write('top\r\n\x1b[?1002h\x1b[?1006h\x1b[?7l\x1b[3;9r\x1b[6;2H')
    const replay = await pane.replay()

    const { pane: copy } = startPane()
    copy.write(replay)

    expect(await copy.replay()).toBe(replay)
  })

  it('forgets the modes a reset clears', async () => {
    const { pane } = startPane()
    pane.write('\x1b[?1006h\x1b[?25l\x1b[2;8r\x1b(0')

    pane.write('\x1bc')

    const replay = await pane.replay()
    for (const sequence of ['\x1b[?1006h', '\x1b[?25l', '\x1b[2;8r', '\x1b(0']) expect(replay).not.toContain(sequence)
  })

  it("saves scrollback without a full-screen program's screen or modes, as a window's terminal does", async () => {
    const { pane } = startPane()
    pane.write('$ ls\r\nsrc\r\n$ vim\r\n\x1b[?1049h\x1b[?2004hEDITING')

    const scrollback = await pane.scrollback()

    expect(scrollback).toContain('src')
    expect(scrollback).not.toContain('EDITING')
    expect(scrollback).not.toContain('\x1b[?2004h')
  })

  it('keeps as many lines of scrollback as it was last told to', async () => {
    const { pane } = startPane()

    pane.setScrollbackLines(2)
    for (let line = 1; line <= 20; line += 1) pane.write(`line ${line}\r\n`)

    // Ten rows on screen, the last one empty, and two above them.
    const scrollback = await pane.scrollback()
    expect(scrollback).not.toContain('line 9\r\n')
    expect(scrollback).toContain('line 10\r\n')
  })

  describe('while watching, as it does once its window has closed', () => {
    it("answers the program's queries", async () => {
      const { pane, replies } = startPane()
      pane.watch(true)

      pane.write('\x1b[6n\x1b]7501;?\x1b\\')
      await pane.replay()

      expect(replies).toEqual(['\x1b[1;1R', programStatusSupported])
    })

    it("passes on the program's notifications, status reports and titles", async () => {
      const { pane, notifications, reports, titles } = startPane()
      pane.watch(true)

      pane.write('\x1b]9;Build done\x07\x1b]9;4;1;50\x07\x1b]7501;id=a:state=done\x1b\\\x1b]2;✳ Claude Code\x07')
      await pane.replay()

      expect(notifications).toEqual([1])
      expect(reports).toEqual([{ id: 'a', state: 'done' }])
      expect(titles).toEqual(['✳ Claude Code'])
    })

    it('does none of it while not watching, as the window answers and passes them on', async () => {
      const { pane, replies, notifications, reports, titles } = startPane()

      pane.write('\x1b[6n\x1b]7501;?\x1b\\\x1b]9;Build done\x07\x1b]7501;state=done\x1b\\\x1b]2;vim\x07')
      await pane.replay()

      expect([replies, notifications, reports, titles]).toEqual([[], [], [], []])
    })
  })
})
