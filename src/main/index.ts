import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, powerMonitor, screen, type WebContents } from "electron";
import { createCore, type PaletteResult } from "../core/core";
import type { FocusDirection } from "../core/layout";
import type { PaneId, SessionId } from "../core/state";
import { channels, type SessionView, type TerminalSize } from "../shared/ipc";
import { fadeWindow } from "./fade";
import { createFileStateStore } from "./file-state-store";
import { createNodePtyShellHost } from "./node-pty-shell-host";

// The development Hotkey; the installed app's F12 comes with packaging.
const hotkey = "F7";

// How long quitting waits for the windows' terminals to report their scrollback.
const scrollbackFlushTimeoutMilliseconds = 1_000;

// Written in full in one fixed form, e.g. `10 Nov 2026, 17:21`, whatever the system's locale.
const savedAtFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// Separates a restored Pane's saved scrollback from its fresh Shell, dimmed, with when the Pane last showed output.
function restoredMarker(savedAt: number) {
  return `\x1b[2m── Restored · ${savedAtFormat.format(savedAt)} ──\x1b[0m`;
}

app.whenReady().then(() => {
  // Keeps the app out of the Dock and Cmd+Tab.
  app.setActivationPolicy("accessory");

  const shellHost = createNodePtyShellHost({ shell: process.env.SHELL || userInfo().shell || "/bin/zsh" });
  const core = createCore({
    shellHost,
    stateStore: createFileStateStore(join(app.getPath("appData"), "Blind")),
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

  // Shows the Session's window at once and hides the one it replaces, with no fade.
  function swapToWindow(sessionId: SessionId) {
    const window = windowFor(sessionId);
    window.setOpacity(1);
    window.show();
    window.focus();
    windows.forEach((other, otherId) => {
      if (otherId !== sessionId && other.isVisible()) other.hide();
    });
  }

  // With no window left on screen, e.g. once the last Open Session's window closed, there's nothing to fade.
  function hideApp() {
    const visible = [...windows.values()].filter((window) => window.isVisible());
    if (visible.length === 0) app.hide();
    visible.forEach(hideWindow);
  }

  core.onEffect((effect) => {
    if (effect.type === "closeWindow") {
      const window = windows.get(effect.sessionId);
      windows.delete(effect.sessionId);
      window?.close();
    }
    if (effect.type === "showApp") showWindow(windowFor(effect.sessionId));
    if (effect.type === "hideApp") hideApp();
    if (effect.type === "showSession") swapToWindow(effect.sessionId);
    if (effect.type === "confirmQuit") void confirmQuit();
    if (effect.type === "quit") {
      savedForQuit = true;
      app.quit();
    }
  });

  // Set once everything is saved, letting the next quit through.
  let savedForQuit = false;
  // Set from the confirmation dialog appearing until the quit is cancelled or saved, so a second quit doesn't ask again.
  let quitInProgress = false;
  // Each window waiting to report its scrollback, by its page.
  const scrollbackFlushes = new Map<WebContents, () => void>();

  // Asks every window's terminals for their latest scrollback, waiting a bounded time for the answers.
  function flushScrollback() {
    const pages = [...windows.values()].filter((window) => !window.isDestroyed()).map((window) => window.webContents);
    return Promise.all(
      pages.map(
        (page) =>
          new Promise<void>((resolve) => {
            const timer = setTimeout(done, scrollbackFlushTimeoutMilliseconds);
            function done() {
              clearTimeout(timer);
              scrollbackFlushes.delete(page);
              resolve();
            }
            scrollbackFlushes.set(page, done);
            page.send(channels.flushScrollback);
          }),
      ),
    );
  }

  // Attached to the visible window, if any, so the dialog shows above the floating panel. With none, e.g. when quit
  // from outside while hidden, the app comes forward to show it.
  async function confirmQuit() {
    if (quitInProgress) return;
    quitInProgress = true;
    const parent = [...windows.values()].find((window) => window.isVisible());
    if (!parent) app.focus({ steal: true });
    const options = {
      type: "question" as const,
      message: "Quit Blind?",
      detail: "Every Shell stops. Sessions come back with fresh Shells the next time Blind starts.",
      buttons: ["Quit", "Cancel"],
      defaultId: 0,
      cancelId: 1,
    };
    const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
    if (response !== 0) {
      quitInProgress = false;
      return;
    }
    await flushScrollback();
    core.quitConfirmed();
  }

  if (!globalShortcut.register(hotkey, () => core.hotkeyPressed())) {
    console.error(`Couldn't register the Hotkey ${hotkey}; another app may own it.`);
  }
  app.on("will-quit", () => globalShortcut.unregisterAll());
  // Every way of quitting, Cmd+Q included, goes through the core's confirmation.
  app.on("before-quit", (event) => {
    if (savedForQuit) return;
    event.preventDefault();
    core.quitRequested();
  });
  // A restart or shutdown isn't the user quitting, so it saves and quits without asking. It skips waiting for the
  // terminals, whose scrollback is at most a moment old, so that the system's own quit request finds the app quitting
  // rather than cancelling the restart.
  powerMonitor.on("shutdown", () => {
    if (!savedForQuit) core.quitConfirmed();
  });
  // Closing the last Open Session's window leaves the app running, so the Hotkey can open a new Session.
  app.on("window-all-closed", () => {});
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

  // The Command Palette, Session, Tab and Pane shortcuts, taken before the Pane's terminal sees them. Brackets and the
  // backtick match by key position too, since Shift turns them into other characters on some layouts.
  function handleShortcut(sessionId: SessionId, input: Electron.Input) {
    if (input.type !== "keyDown" || !input.meta || input.control) return false;
    const key = input.key.toLowerCase();
    const leftBracket = key === "{" || key === "[" || input.code === "BracketLeft";
    const rightBracket = key === "}" || key === "]" || input.code === "BracketRight";
    if (input.alt) {
      const direction = arrowDirections[input.key];
      if (input.shift || !direction) return false;
      core.focusPaneInDirection(sessionId, direction);
    } else if (input.code === "Backquote") {
      if (input.shift) core.focusPreviousSession();
      else core.focusNextSession();
    } else if (!input.shift && key === "k") windows.get(sessionId)?.webContents.send(channels.openPalette);
    else if (!input.shift && key === "n") core.newSession();
    else if (!input.shift && key === "t") core.newTab(sessionId);
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
  ipcMain.handle(channels.searchPalette, (_event, query: string) => core.paletteResults(query));
  ipcMain.on(channels.choosePaletteResult, (_event, result: PaletteResult) => core.choosePaletteResult(result));

  // A restored Pane's terminal gets its saved scrollback first, with no colour or style left over from it. The line the
  // cursor was on, usually the old Shell's idle prompt, gives way to a dim marker, and the fresh Shell's output follows.
  ipcMain.handle(channels.attachPane, (event, paneId: PaneId, size: TerminalSize) => {
    const scrollback = core.scrollback(paneId);
    if (scrollback) {
      const replay = `${scrollback.text}\x1b[0m\r\x1b[2K${restoredMarker(scrollback.savedAt)}\r\n`;
      event.sender.send(channels.paneData, paneId, replay);
    }
    shellHost.resize(paneId, size);
    shellHost.attach(paneId, (data) => {
      if (!event.sender.isDestroyed()) event.sender.send(channels.paneData, paneId, data);
    });
  });
  ipcMain.on(channels.writeToPane, (_event, paneId: PaneId, data: string) => shellHost.write(paneId, data));
  ipcMain.on(channels.resizePane, (_event, paneId: PaneId, size: TerminalSize) => shellHost.resize(paneId, size));
  ipcMain.on(channels.reportScrollback, (_event, paneId: PaneId, scrollback: string) =>
    core.scrollbackChanged(paneId, scrollback),
  );
  ipcMain.on(channels.scrollbackFlushed, (event) => scrollbackFlushes.get(event.sender)?.());

  // One window per Open Session, made the first time the Session is shown.
  function windowFor(sessionId: SessionId) {
    const existing = windows.get(sessionId);
    if (existing) return existing;
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
    windows.set(sessionId, window);
    window.on("closed", () => windows.delete(sessionId));
    window.webContents.on("did-finish-load", () => sendSessionView(sessionId, window));
    window.webContents.on("before-input-event", (event, input) => {
      if (handleShortcut(sessionId, input)) event.preventDefault();
    });
    if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL);
    else window.loadFile(join(import.meta.dirname, "../renderer/index.html"));
    return window;
  }

  core.start();
  // The app starts shown; showing now, not on ready-to-show, keeps the window in step with the core.
  showWindow(windowFor(core.state().currentSessionId!));
});
