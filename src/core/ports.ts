import type { CoreState, PaneId } from './state'

export type ShellEvent =
  | { type: 'shellExited'; paneId: PaneId }
  | { type: 'workingDirectoryChanged'; paneId: PaneId; workingDirectory: string }
  // `runningProgram` is undefined while the Shell is idle at a prompt.
  | { type: 'runningProgramChanged'; paneId: PaneId; runningProgram: string | undefined }

export interface ShellHost {
  // Runs `shell`, or the user's login shell without one.
  start(paneId: PaneId, options: { workingDirectory: string; shell?: string }): void;
  stop(paneId: PaneId): void;
  subscribe(listener: (event: ShellEvent) => void): void;
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
