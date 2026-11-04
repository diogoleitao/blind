import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, globalShortcut, ipcMain, screen } from "electron";
import { createCore } from "../core/core";
import { createInMemoryStateStore } from "../core/in-memory-state-store";
import type { PaneId, SessionId } from "../core/state";
import { channels, type TerminalSize } from "../shared/ipc";
import { fadeWindow } from "./fade";
import { createNodePtyShellHost } from "./node-pty-shell-host";

// The development Hotkey; the installed app's F12 comes with packaging.
const hotkey = "F7";

app.whenReady().then(() => {
  // Keeps the app out of the Dock and Cmd+Tab.
  app.setActivationPolicy("accessory");

  const shellHost = createNodePtyShellHost({ shell: process.env.SHELL || userInfo().shell || "/bin/zsh" });
  const core = createCore({
    shellHost,
    stateStore: createInMemoryStateStore(),
    clock: { now: () => Date.now() },
    homeDirectory: homedir(),
  });
  const windows = new Map<SessionId, BrowserWindow>();

  // Blind becomes the active app while shown, like iTerm2's hotkey window, so switching to any other app is a focus loss.
  function showWindow(window: BrowserWindow) {
    app.show();
    if (!window.isVisible()) {
      window.setOpacity(0);
      window.show();
    }
    app.focus({ steal: true });
    window.focus();
    fadeWindow(window, 1);
  }

  // Hiding the app hands focus back to the app that was active before.
  function hideWindow(window: BrowserWindow) {
    fadeWindow(window, 0, () => {
      window.hide();
      app.hide();
    });
  }

  core.onEffect((effect) => {
    if (effect.type === "closeWindow") windows.get(effect.sessionId)?.close();
    if (effect.type === "showApp") windows.forEach(showWindow);
    if (effect.type === "hideApp") windows.forEach(hideWindow);
  });

  if (!globalShortcut.register(hotkey, () => core.hotkeyPressed())) {
    console.error(`Couldn't register the Hotkey ${hotkey}; another app may own it.`);
  }
  app.on("will-quit", () => globalShortcut.unregisterAll());
  app.on("did-resign-active", () => core.focusLost());

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
    // A panel floats above other apps, fullscreen ones included.
    const window = new BrowserWindow({
      ...screen.getPrimaryDisplay().workArea,
      type: "panel",
      show: false,
      frame: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      vibrancy: "under-window",
      visualEffectState: "active",
      backgroundColor: "#00000000",
      webPreferences: { preload: join(import.meta.dirname, "../preload/index.mjs"), sandbox: false },
    });
    window.setAlwaysOnTop(true, "screen-saver");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    windows.set(session.id, window);
    window.on("closed", () => windows.delete(session.id));
    // The app starts shown; showing now, not on ready-to-show, keeps the window in step with the core.
    showWindow(window);
    if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL);
    else window.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
});
