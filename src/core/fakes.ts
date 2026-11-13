import type { KeyPress } from './key-bindings'
import type { Clock, ShellEvent, ShellHost } from './ports'
import type { PaneId } from './state'

// A key pressed as the keyboard reports it: the key it produces, the physical key, and the modifiers held, e.g.
// `press("}", "BracketRight", "meta", "shift")`.
export function press (key: string, code: string, ...modifiers: ('meta' | 'shift' | 'alt' | 'control')[]): KeyPress {
  return {
    key,
    code,
    meta: modifiers.includes('meta'),
    shift: modifiers.includes('shift'),
    alt: modifiers.includes('alt'),
    control: modifiers.includes('control'),
  }
}

export function createFakeShellHost () {
  const started: { paneId: PaneId; workingDirectory: string; shell?: string }[] = []
  const stopped: PaneId[] = []
  const listeners: ((event: ShellEvent) => void)[] = []
  const host: ShellHost = {
    start: (paneId, { workingDirectory, shell }) => {
      started.push({ paneId, workingDirectory, shell })
    },
    stop: (paneId) => {
      stopped.push(paneId)
    },
    subscribe: (listener) => {
      listeners.push(listener)
    },
  }
  const emit = (event: ShellEvent) => {
    for (const listener of listeners) listener(event)
  }
  return {
    ...host,
    started,
    stopped,
    exit: (paneId: PaneId) => emit({ type: 'shellExited', paneId }),
    changeWorkingDirectory: (paneId: PaneId, workingDirectory: string) =>
      emit({ type: 'workingDirectoryChanged', paneId, workingDirectory }),
    changeRunningProgram: (paneId: PaneId, runningProgram: string | undefined) =>
      emit({ type: 'runningProgramChanged', paneId, runningProgram }),
  }
}

export function createControllableClock (start: number) {
  let current = start
  const clock: Clock = { now: () => current }
  return {
    ...clock,
    advance: (milliseconds: number) => {
      current += milliseconds
    },
  }
}
