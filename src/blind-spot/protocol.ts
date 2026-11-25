import type { Socket } from 'node:net'
import type { ShellOnQuit } from '../core/config'
import type { Build, PaneReport, SavedScrollback, ShellEvent, ShellFromBefore } from '../core/ports'
import type { PaneId } from '../core/state'

// How the app and Blind Spot talk: one JSON message per line over a Unix socket. Raised whenever a message changes, so
// an app finds a Blind Spot from another version and ends it. The `hello`, `welcome` and `shutdown` messages never
// change, so that any app can tell any Blind Spot's version and end it, except to gain optional fields, which leaves
// the version as it is: an app then hears none from an older Blind Spot of the same version.
export const protocolVersion = 1

export type AppMessage =
  | { type: 'hello'; version: number; onQuit: ShellOnQuit }
  // Ends every Shell, and Blind Spot with them.
  | { type: 'shutdown' }
  // What to do with the Shells should the app go without ending them: nothing, or end them too.
  | { type: 'onQuit'; onQuit: ShellOnQuit }
  // `restoredOutput` is what the Pane's window shows before the Shell's own output, which its headless terminal starts
  // from.
  | {
    type: 'start';
    paneId: PaneId;
    workingDirectory: string;
    shell: string;
    scrollbackLines: number;
    restoredOutput?: string;
  }
  | { type: 'stop'; paneId: PaneId }
  | { type: 'write'; paneId: PaneId; data: string }
  | { type: 'resize'; paneId: PaneId; cols: number; rows: number }
  // A window shows the Pane from now: its output goes to the app, its headless terminal's replay first if no window
  // showed it, answered with `attached` once the window has everything before the live output.
  | { type: 'attach'; paneId: PaneId }
  // The window showing the Pane is closing; the Shell runs on, watched by its headless terminal.
  | { type: 'windowClosed'; paneId: PaneId }
  // A title the Pane's window read from its output.
  | { type: 'reportTitle'; paneId: PaneId; title: string }
  | { type: 'setScrollbackLines'; lines: number }
  // Asks for every windowless Pane's scrollback now, answered with `windowlessScrollbackReported` once sent.
  | { type: 'reportWindowlessScrollback'; requestId: number }

export type BlindSpotMessage =
  // Answers `hello`. The Shells that ran on with no app connected, those exited since included, and the scrollback saved
  // meanwhile come only when the versions match. `build` is Blind Spot's own, absent from one older than Builds.
  | {
    type: 'welcome';
    version: number;
    build?: Build;
    shells?: ShellFromBefore[];
    scrollback?: Record<PaneId, SavedScrollback>;
  }
  | { type: 'data'; paneId: PaneId; data: string }
  | { type: 'report'; report: PaneReport | Extract<ShellEvent, { type: 'shellExited' }> }
  // A windowless Pane's scrollback, as its window's terminal would report it.
  | { type: 'scrollback'; paneId: PaneId; scrollback: string }
  | { type: 'attached'; paneId: PaneId }
  | { type: 'windowlessScrollbackReported'; requestId: number }

export function sendMessage (socket: Socket, message: AppMessage | BlindSpotMessage) {
  if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`)
}

// Calls `received` with each message the socket brings, whole, in order.
export function receiveMessages<Message> (socket: Socket, received: (message: Message) => void) {
  let pending = ''
  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    pending += chunk
    let end = pending.indexOf('\n')
    while (end !== -1) {
      const line = pending.slice(0, end)
      pending = pending.slice(end + 1)
      if (line !== '') received(JSON.parse(line) as Message)
      end = pending.indexOf('\n')
    }
  })
}
