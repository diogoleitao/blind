import { spawn, type IPty } from "node-pty";
import type { ShellEvent, ShellHost } from "../core/ports";
import type { PaneId } from "../core/state";
import type { TerminalSize } from "../shared/ipc";

export interface NodePtyShellHost extends ShellHost {
  // Output produced before a Pane is attached is buffered and replayed on attach.
  attach(paneId: PaneId, onData: (data: string) => void): void;
  write(paneId: PaneId, data: string): void;
  resize(paneId: PaneId, size: TerminalSize): void;
}

interface RunningShell {
  pty: IPty;
  buffered: string[];
  onData?: (data: string) => void;
}

// Electron's and npm's own variables don't belong in the user's Shell.
function shellEnvironment() {
  const inherited = Object.entries(process.env).filter(
    ([name]) => !name.startsWith("ELECTRON_") && !name.startsWith("npm_"),
  );
  return { ...Object.fromEntries(inherited), TERM: "xterm-256color", COLORTERM: "truecolor" };
}

// Runs each Pane's Shell as a login shell in a pseudo-terminal.
export function createNodePtyShellHost({ shell }: { shell: string }): NodePtyShellHost {
  const shells = new Map<PaneId, RunningShell>();
  const listeners: ((event: ShellEvent) => void)[] = [];

  return {
    start(paneId, { workingDirectory }) {
      const pty = spawn(shell, ["-l"], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: workingDirectory,
        env: shellEnvironment(),
      });
      const running: RunningShell = { pty, buffered: [] };
      shells.set(paneId, running);
      pty.onData((data) => {
        if (running.onData) running.onData(data);
        else running.buffered.push(data);
      });
      pty.onExit(() => {
        shells.delete(paneId);
        for (const listener of listeners) listener({ type: "shellExited", paneId });
      });
    },
    stop(paneId) {
      shells.get(paneId)?.pty.kill();
    },
    subscribe(listener) {
      listeners.push(listener);
    },
    attach(paneId, onData) {
      const running = shells.get(paneId);
      if (!running) return;
      running.onData = onData;
      for (const data of running.buffered.splice(0)) onData(data);
    },
    write(paneId, data) {
      shells.get(paneId)?.pty.write(data);
    },
    resize(paneId, { cols, rows }) {
      shells.get(paneId)?.pty.resize(cols, rows);
    },
  };
}
