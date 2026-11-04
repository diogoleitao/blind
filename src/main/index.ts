import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { createCore } from "../core/core";
import { createInMemoryStateStore } from "../core/in-memory-state-store";
import type { PaneId, SessionId } from "../core/state";
import { channels, type TerminalSize } from "../shared/ipc";
import { createNodePtyShellHost } from "./node-pty-shell-host";

app.whenReady().then(() => {
  const shellHost = createNodePtyShellHost({ shell: process.env.SHELL || userInfo().shell || "/bin/zsh" });
  const core = createCore({
    shellHost,
    stateStore: createInMemoryStateStore(),
    clock: { now: () => Date.now() },
    homeDirectory: homedir(),
  });
  const windows = new Map<SessionId, BrowserWindow>();

  core.onEffect((effect) => {
    if (effect.type === "closeWindow") windows.get(effect.sessionId)?.close();
  });

  function sessionOf(window: BrowserWindow | null) {
    for (const [sessionId, candidate] of windows) {
      if (candidate === window) return core.state().sessions.find((session) => session.id === sessionId);
    }
  }

  ipcMain.handle(channels.sessionPane, (event) => {
    return sessionOf(BrowserWindow.fromWebContents(event.sender))?.tabs[0]?.panes[0]?.id;
  });
  ipcMain.handle(channels.attachPane, (event, paneId: PaneId, size: TerminalSize) => {
    shellHost.resize(paneId, size);
    shellHost.attach(paneId, (data) => {
      if (!event.sender.isDestroyed()) event.sender.send(channels.paneData, paneId, data);
    });
  });
  ipcMain.on(channels.writeToPane, (_event, paneId: PaneId, data: string) => shellHost.write(paneId, data));
  ipcMain.on(channels.resizePane, (_event, paneId: PaneId, size: TerminalSize) => shellHost.resize(paneId, size));

  core.start();

  for (const session of core.state().sessions) {
    if (session.status !== "open") continue;
    const window = new BrowserWindow({
      width: 900,
      height: 600,
      webPreferences: { preload: join(import.meta.dirname, "../preload/index.mjs"), sandbox: false },
    });
    windows.set(session.id, window);
    window.on("closed", () => windows.delete(session.id));
    if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL);
    else window.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
});
