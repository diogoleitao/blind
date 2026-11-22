import type { ProgramStatusReport } from './attention'
import type { CoreState, PaneId } from './state'

export type ShellEvent =
  | { type: 'shellExited'; paneId: PaneId }
  | { type: 'workingDirectoryChanged'; paneId: PaneId; workingDirectory: string }
  // `runningProgram` is undefined while the Shell is idle at a prompt.
  | { type: 'runningProgramChanged'; paneId: PaneId; runningProgram: string | undefined }
  // A title set in the Pane with OSC 0 or 2, by its program or by the Shell itself, empty to clear it. Reported after the
  // running program as it stood once the title arrived, so a title the idle Shell sets comes with no running program.
  | { type: 'titleChanged'; paneId: PaneId; title: string }
  // Every Shell ended at once, as whatever held them is gone; no `shellExited` follows for any of them.
  | { type: 'shellsLost' }

// What a Pane whose Shell runs on reports besides its output: how its Shell changed, and what of its program's asks
// for the user's attention while no window shows it, as a window's terminal would report it.
export type PaneReport =
  | Exclude<ShellEvent, { type: 'shellExited' | 'shellsLost' }>
  | { type: 'notification'; paneId: PaneId }
  | { type: 'programStatus'; paneId: PaneId; report: ProgramStatusReport }

// A Shell the app started before it last quit that ran on once it was gone, with what its Pane reported meanwhile, in
// order. One that has exited since leaves its Pane for a fresh Shell, which follows what it reported, such as its last
// working directory.
export interface ShellFromBefore {
  paneId: PaneId;
  missed: PaneReport[];
  exited?: true;
}

export interface ShellHost {
  // Runs `shell`, or the user's login shell without one.
  start(paneId: PaneId, options: { workingDirectory: string; shell?: string }): void;
  stop(paneId: PaneId): void;
  subscribe(listener: (event: ShellEvent) => void): void;
  // The Shells from before the app last quit that ran on once it was gone, those still running and those exited since.
  shellsFromBefore(): ShellFromBefore[];
  // Scrollback saved for Panes while the app was gone, e.g. a Shell's last before it exited, or before the OS
  // restarted.
  savedScrollback(): Record<PaneId, SavedScrollback>;
}

// A Pane's serialized terminal and the clock's time when it was reported.
export interface SavedScrollback {
  text: string;
  savedAt: number;
}

// What Restore brings back: the state and each Pane's scrollback.
export interface Snapshot {
  state: CoreState;
  scrollback: Record<PaneId, SavedScrollback>;
}

export interface StateStore {
  load(): Snapshot | undefined;
  // May write later, e.g. to batch a burst of changes.
  save(snapshot: Snapshot): void;
  // Writes whatever `save` left pending.
  flush(): void;
}

export interface Clock {
  now(): number;
}
