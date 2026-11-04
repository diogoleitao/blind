import type { Clock, ShellEvent, ShellHost } from "./ports";
import type { PaneId } from "./state";

export function createFakeShellHost() {
  const started: { paneId: PaneId; workingDirectory: string }[] = [];
  const stopped: PaneId[] = [];
  const listeners: ((event: ShellEvent) => void)[] = [];
  const host: ShellHost = {
    start: (paneId, { workingDirectory }) => {
      started.push({ paneId, workingDirectory });
    },
    stop: (paneId) => {
      stopped.push(paneId);
    },
    subscribe: (listener) => {
      listeners.push(listener);
    },
  };
  return {
    ...host,
    started,
    stopped,
    exit: (paneId: PaneId) => {
      for (const listener of listeners) listener({ type: "shellExited", paneId });
    },
  };
}

export function createControllableClock(start: number) {
  let current = start;
  const clock: Clock = { now: () => current };
  return {
    ...clock,
    advance: (milliseconds: number) => {
      current += milliseconds;
    },
  };
}
