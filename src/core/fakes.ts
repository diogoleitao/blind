import type { KeyPress } from './key-bindings'
import type { Clock, SavedScrollback, ShellEvent, ShellFromBefore, ShellHost } from './ports'
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

// `fromBefore` and `saved` are what the app finds as it starts: the Shells from before it last quit that ran on, and the
// scrollback saved meanwhile.
export function createFakeShellHost (
  { fromBefore = [], saved = {} }: { fromBefore?: ShellFromBefore[]; saved?: Record<PaneId, SavedScrollback> } = {}
) {
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
    shellsFromBefore: () => fromBefore,
    savedScrollback: () => saved,
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
    setTitle: (paneId: PaneId, title: string) => emit({ type: 'titleChanged', paneId, title }),
    lose: () => emit({ type: 'shellsLost' }),
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
