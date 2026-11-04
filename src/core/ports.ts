import type { CoreState, PaneId } from "./state";

export type ShellEvent = { type: "shellExited"; paneId: PaneId };

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
