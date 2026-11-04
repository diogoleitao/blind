import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, globalShortcut, ipcMain, screen } from "electron";
import { createCore } from "../core/core";
import { createInMemoryStateStore } from "../core/in-memory-state-store";
import type { FocusDirection } from "../core/layout";
import type { PaneId, SessionId } from "../core/state";
import { channels, type SessionView, type TerminalSize } from "../shared/ipc";
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

  function sessionView(sessionId: SessionId): SessionView | undefined {
    const session = core.state().sessions.find((candidate) => candidate.id === sessionId);
    if (!session) return undefined;
    return {
      tabs: session.tabs.map((tab) => ({
        id: tab.id,
        title: core.tabTitle(tab.id) ?? "",
        panes: core.paneRects(tab.id),
        focusedPaneId: tab.focusedPaneId,
      })),
      focusedTabId: session.focusedTabId,
    };
  }

  function sendSessionView(sessionId: SessionId, window: BrowserWindow) {
    const view = sessionView(sessionId);
    if (view && !window.isDestroyed()) window.webContents.send(channels.sessionView, view);
  }

  core.onStateChange(() => windows.forEach((window, sessionId) => sendSessionView(sessionId, window)));

  const arrowDirections: Record<string, FocusDirection> = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
  };

  // The Tab and Pane shortcuts, taken before the Pane's terminal sees them. Brackets match by character or by key
  // position, since Shift turns `[` into `{` on some layouts.
  function handleShortcut(sessionId: SessionId, input: Electron.Input) {
    if (input.type !== "keyDown" || !input.meta || input.control) return false;
    const key = input.key.toLowerCase();
    const leftBracket = key === "{" || key === "[" || input.code === "BracketLeft";
    const rightBracket = key === "}" || key === "]" || input.code === "BracketRight";
    if (input.alt) {
      const direction = arrowDirections[input.key];
      if (input.shift || !direction) return false;
      core.focusPaneInDirection(sessionId, direction);
    } else if (!input.shift && key === "t") core.newTab(sessionId);
    else if (key === "d") core.splitPane(sessionId, input.shift ? "horizontal" : "vertical");
    else if (!input.shift && key === "w") core.closePane(sessionId);
    else if (!input.shift && /^[1-9]$/.test(key)) core.focusTab(sessionId, Number(key) - 1);
    else if (input.shift && leftBracket) core.focusPreviousTab(sessionId);
    else if (input.shift && rightBracket) core.focusNextTab(sessionId);
    else if (leftBracket) core.focusPreviousPane(sessionId);
    else if (rightBracket) core.focusNextPane(sessionId);
    else return false;
    return true;
  }

  ipcMain.on(channels.focusPane, (_event, paneId: PaneId) => core.focusPane(paneId));

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
    window.webContents.on("did-finish-load", () => sendSessionView(session.id, window));
    window.webContents.on("before-input-event", (event, input) => {
      if (handleShortcut(session.id, input)) event.preventDefault();
    });
    // The app starts shown; showing now, not on ready-to-show, keeps the window in step with the core.
    showWindow(window);
    if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL);
    else window.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
});
