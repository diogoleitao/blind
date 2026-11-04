import type { CoreState, PaneId } from "./state";

export type ShellEvent =
  | { type: "shellExited"; paneId: PaneId }
  | { type: "workingDirectoryChanged"; paneId: PaneId; workingDirectory: string }
  // `runningProgram` is undefined while the Shell is idle at a prompt.
  | { type: "runningProgramChanged"; paneId: PaneId; runningProgram: string | undefined };

export interface ShellHost {
  start(paneId: PaneId, options: { workingDirectory: string }): void;
  stop(paneId: PaneId): void;
  subscribe(listener: (event: ShellEvent) => void): void;
}

export interface StateStore {
  load(): CoreState | undefined;
  save(snapshot: CoreState): void;
}

export interface Clock {
  now(): number;
}
