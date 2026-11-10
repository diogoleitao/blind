import { execFile } from "node:child_process";
import { basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { spawn, type IPty } from "node-pty";
import type { ShellEvent, ShellHost } from "../core/ports";
import type { PaneId } from "../core/state";
import type { TerminalSize } from "../shared/ipc";

const execFileAsync = promisify(execFile);

// How long after a Pane's output its working directory and running program are read again.
// Output marks every change: a new prompt after `cd` or a program exiting, a program's own output, or the echo of Enter.
const inspectionDelayMilliseconds = 250;

export interface NodePtyShellHost extends ShellHost {
  // Output produced before a Pane is attached is buffered and replayed on attach.
  attach(paneId: PaneId, onData: (data: string) => void): void;
  write(paneId: PaneId, data: string): void;
  resize(paneId: PaneId, size: TerminalSize): void;
}

interface RunningShell {
  paneId: PaneId;
  pty: IPty;
  buffered: string[];
  onData?: (data: string) => void;
  // Last reported to the core.
  workingDirectory: string;
  runningProgram?: string;
  inspecting: boolean;
  outputSinceInspection: boolean;
}

// Electron's and npm's own variables don't belong in the user's Shell.
function shellEnvironment() {
  const inherited = Object.entries(process.env).filter(
    ([name]) => !name.startsWith("ELECTRON_") && !name.startsWith("npm_"),
  );
  return { ...Object.fromEntries(inherited), TERM: "xterm-256color", COLORTERM: "truecolor" };
}

// Read from the process, so no shell configuration is needed.
async function workingDirectoryOf(pid: number) {
  const { stdout } = await execFileAsync("lsof", ["-a", "-d", "cwd", "-p", String(pid), "-Fn"]);
  return stdout
    .split("\n")
    .find((line) => line.startsWith("n"))
    ?.slice(1);
}

// The leader of the terminal's foreground process group, or undefined while the Shell itself is in the
// foreground, idle at a prompt. `comm` is the name the program gives itself: an executable's path, or a title
// such as npm's `npm exec` (its process is `node`), whose first word is the program.
async function runningProgramOf(pid: number) {
  const { stdout: group } = await execFileAsync("ps", ["-o", "tpgid=", "-p", String(pid)]);
  const foreground = Number(group.trim());
  if (!foreground || foreground === pid) return undefined;
  const { stdout: command } = await execFileAsync("ps", ["-o", "comm=", "-p", String(foreground)]);
  const name = command.trim();
  return (name.startsWith("/") ? basename(name) : name.split(" ")[0]) || undefined;
}

// Runs each Pane's Shell as a login shell in a pseudo-terminal, `loginShell` unless the core asks for another.
export function createNodePtyShellHost({ loginShell }: { loginShell: string }): NodePtyShellHost {
  const shells = new Map<PaneId, RunningShell>();
  const listeners: ((event: ShellEvent) => void)[] = [];

  function emit(event: ShellEvent) {
    for (const listener of listeners) listener(event);
  }

  // Reports working directory and running program changes until no output arrived during the last read.
  async function inspect(running: RunningShell) {
    const { paneId } = running;
    running.inspecting = true;
    while (running.outputSinceInspection && shells.get(paneId) === running) {
      running.outputSinceInspection = false;
      await delay(inspectionDelayMilliseconds);
      try {
        const [workingDirectory, runningProgram] = await Promise.all([
          workingDirectoryOf(running.pty.pid),
          runningProgramOf(running.pty.pid),
        ]);
        if (shells.get(paneId) !== running) break;
        if (workingDirectory && workingDirectory !== running.workingDirectory) {
          running.workingDirectory = workingDirectory;
          emit({ type: "workingDirectoryChanged", paneId, workingDirectory });
        }
        if (runningProgram !== running.runningProgram) {
          running.runningProgram = runningProgram;
          emit({ type: "runningProgramChanged", paneId, runningProgram });
        }
      } catch {
        // The Shell exited while it was being read; its exit is reported separately.
      }
    }
    running.inspecting = false;
  }

  return {
    start(paneId, { workingDirectory, shell = loginShell }) {
      const pty = spawn(shell, ["-l"], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: workingDirectory,
        env: shellEnvironment(),
      });
      const running: RunningShell = {
        paneId,
        pty,
        buffered: [],
        workingDirectory,
        inspecting: false,
        outputSinceInspection: false,
      };
      shells.set(paneId, running);
      pty.onData((data) => {
        if (running.onData) running.onData(data);
        else running.buffered.push(data);
        running.outputSinceInspection = true;
        if (!running.inspecting) void inspect(running);
      });
      pty.onExit(() => {
        shells.delete(paneId);
        emit({ type: "shellExited", paneId });
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
