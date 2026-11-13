import { existsSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Notification,
  powerMonitor,
  screen,
  shell,
  type WebContents,
} from 'electron'
import type { MenuBarIcon } from '../core/config'
import { createCore, type PaletteResult } from '../core/core'
import type { PaneId, SessionId } from '../core/state'
import { channels, type PalettePrompt, type SessionView, type TerminalSize, type WindowSettings } from '../shared/ipc'
import { type ConfigRead, createConfigFile } from './config-file'
import { fadeWindow } from './fade'
import { createFileStateStore } from './file-state-store'
import { createMenuBarIcon } from './menu-bar-icon'
import { createNodePtyShellHost } from './node-pty-shell-host'
import { createThemeFiles } from './theme-files'

// The installed app's Hotkey is F12; running from the repo uses F7, so both can run side by side.
const hotkey = app.isPackaged ? 'F12' : 'F7'

// How long quitting waits for the windows' terminals to report their scrollback.
const scrollbackFlushTimeoutMilliseconds = 1_000

// Written in full in one fixed form, e.g. `10 Nov 2026, 17:21`, whatever the system's locale.
const savedAtFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

// Separates a restored Pane's saved scrollback from its fresh Shell, dimmed, with when the Pane last showed output.
function restoredMarker (savedAt: number) {
  return `\x1b[2m── Restored · ${savedAtFormat.format(savedAt)} ──\x1b[0m`
}

app.whenReady().then(() => {
  // Keeps the app out of the Dock and Cmd+Tab.
  app.setActivationPolicy('accessory')

  const shellHost = createNodePtyShellHost({ loginShell: process.env.SHELL || userInfo().shell || '/bin/zsh' })
  const core = createCore({
    shellHost,
    stateStore: createFileStateStore(join(app.getPath('appData'), 'Blind')),
    clock: { now: () => Date.now() },
    homeDirectory: homedir(),
  })
  const configDirectory = join(homedir(), '.config', 'blind')
  const configFile = createConfigFile(configDirectory)
  const themeFiles = createThemeFiles(join(configDirectory, 'themes'))
  const windows = new Map<SessionId, BrowserWindow>()
  // The Command Palette on its own, made the first time the Hotkey shows it with no Open Sessions.
  let paletteWindow: BrowserWindow | undefined

  function allWindows () {
    return paletteWindow ? [...windows.values(), paletteWindow] : [...windows.values()]
  }

  // Blind becomes the active app while shown, like iTerm2's hotkey window, so switching to any other app is a focus loss.
  function showWindow (window: BrowserWindow) {
    app.show()
    if (!window.isVisible()) {
      window.setOpacity(0)
      window.show()
    }
    app.focus({ steal: true })
    window.focus()
    fadeWindow(window, 1)
  }

  // Hiding the app hands focus back to the app that was active before.
  function hideWindow (window: BrowserWindow) {
    fadeWindow(window, 0, () => {
      window.hide()
      app.hide()
    })
  }

  // Shows the Session's window at once and hides the one it replaces, or the Command Palette on its own, with no fade.
  function swapToWindow (sessionId: SessionId) {
    const window = windowFor(sessionId)
    window.setOpacity(1)
    window.show()
    window.focus()
    for (const other of allWindows()) {
      if (other !== window && other.isVisible()) other.hide()
    }
  }

  // Asks a loaded page for the palette again; a page still loading opens it by itself.
  function showPaletteWindow () {
    if (!paletteWindow) {
      const window = createPanel()
      window.on('closed', () => {
        paletteWindow = undefined
      })
      loadPage(window, 'palette')
      paletteWindow = window
    } else if (!paletteWindow.webContents.isLoading()) {
      paletteWindow.webContents.send(channels.openPalette)
    }
    showWindow(paletteWindow)
  }

  // With no window left on screen, e.g. once the last Open Session's window closed, there's nothing to fade.
  function hideApp () {
    const visible = allWindows().filter((window) => window.isVisible())
    if (visible.length === 0) app.hide()
    visible.forEach(hideWindow)
  }

  // Hidden at once, and closed once its terminals have reported their latest scrollback, which a Closed Session keeps.
  function closeWindow (sessionId: SessionId) {
    const window = windows.get(sessionId)
    windows.delete(sessionId)
    if (!window) return
    window.hide()
    flushScrollback([window]).then(() => window.close())
  }

  core.onEffect((effect) => {
    if (effect.type === 'closeWindow') closeWindow(effect.sessionId)
    if (effect.type === 'showApp') showWindow(windowFor(effect.sessionId))
    if (effect.type === 'showPalette') showPaletteWindow()
    if (effect.type === 'openPalette') windows.get(effect.sessionId)?.webContents.send(channels.openPalette)
    if (effect.type === 'hideApp') hideApp()
    if (effect.type === 'showSession') swapToWindow(effect.sessionId)
    if (effect.type === 'confirmQuit') confirmQuit(effect.sessionsToDelete)
    if (effect.type === 'confirmDelete') confirmDelete(effect.sessionId)
    if (effect.type === 'askSessionName' || effect.type === 'askTabTitle') {
      windows.get(effect.sessionId)?.webContents.send(channels.promptPalette, effect)
    }
    if (effect.type === 'openSettings') openSettings()
    if (effect.type === 'settingsRejected') {
      notify('Some settings were rejected', `${effect.settings.join(', ')} in config.jsonc use their defaults.`)
    }
    if (effect.type === 'configUnreadable') {
      notify("Settings couldn't be read", "config.jsonc couldn't be read as JSON with comments; settings are unchanged.")
    }
    if (effect.type === 'applyTheme') allWindows().forEach(sendTheme)
    if (effect.type === 'writeConfig') configFile.write(effect.text)
    if (effect.type === 'pickTheme') {
      const window = effect.sessionId === undefined ? paletteWindow : windows.get(effect.sessionId)
      window?.webContents.send(channels.pickTheme)
    }
    if (effect.type === 'applyMenuBarIcon') menuBarIcon.show(effect.icon)
    if (effect.type === 'pickMenuBarIcon') {
      const window = effect.sessionId === undefined ? paletteWindow : windows.get(effect.sessionId)
      window?.webContents.send(channels.pickMenuBarIcon, core.menuBarIcon())
    }
    if (effect.type === 'themesRejected') {
      // A file named alone was skipped; a field rejected in a file takes the Default Theme's value.
      const rejected = effect.rejected.join(', ')
      notify('Some Themes were rejected', `Files skipped or fields given the Default Theme's values: ${rejected}.`)
    }
    if (effect.type === 'quit') {
      savedForQuit = true
      app.quit()
    }
    if (effect.type === 'findInPane') windows.get(effect.sessionId)?.webContents.send(channels.findInPane, effect.paneId)
    if (effect.type === 'clearScrollback') {
      windows.get(effect.sessionId)?.webContents.send(channels.clearScrollback, effect.paneId)
    }
    if (effect.type === 'copy') windows.get(effect.sessionId)?.webContents.send(channels.copy)
    // The clipboard is read asynchronously; a window that closed meanwhile gets nothing.
    if (effect.type === 'paste') {
      clipboard.readText().then((text) => windows.get(effect.sessionId)?.webContents.send(channels.paste, text))
    }
  })

  // A system notification, seen even while Blind is hidden behind the editor the config file was saved from.
  function notify (title: string, body: string) {
    new Notification({ title, body }).show()
  }

  // With no app set to open `.jsonc` files, the file is shown in Finder instead.
  async function openSettings () {
    configFile.createIfMissing()
    const failure = await shell.openPath(configFile.path)
    if (failure) shell.showItemInFolder(configFile.path)
  }

  // Set once everything is saved, letting the next quit through.
  let savedForQuit = false
  // Set from the confirmation dialog appearing until the quit is cancelled or saved, so a second quit doesn't ask again.
  let quitInProgress = false
  // Each window waiting to report its scrollback, by its page.
  const scrollbackFlushes = new Map<WebContents, () => void>()

  // Asks the windows' terminals, every window's by default, for their latest scrollback, waiting a bounded time for the
  // answers.
  function flushScrollback (targets = [...windows.values()]) {
    const pages = targets.filter((window) => !window.isDestroyed()).map((window) => window.webContents)
    return Promise.all(
      pages.map(
        (page) =>
          new Promise<void>((resolve) => {
            const timer = setTimeout(done, scrollbackFlushTimeoutMilliseconds)
            function done () {
              clearTimeout(timer)
              scrollbackFlushes.delete(page)
              resolve()
            }
            scrollbackFlushes.set(page, done)
            page.send(channels.flushScrollback)
          })
      )
    )
  }

  // Attached to the visible window, if any, so the dialog shows above the floating panel. With none, e.g. when quit
  // from outside while hidden, the app comes forward to show it. Answers with the chosen button's index.
  async function ask (options: Electron.MessageBoxOptions) {
    const parent = allWindows().find((window) => window.isVisible())
    if (!parent) app.focus({ steal: true })
    const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
    return response
  }

  // Tells how many Sessions quitting deletes, if any.
  async function confirmQuit (sessionsToDelete?: number) {
    if (quitInProgress) return
    quitInProgress = true
    const deletionNote =
      sessionsToDelete === undefined
        ? ''
        : sessionsToDelete === 1
          ? ' 1 Session without a name or Root directory is deleted.'
          : ` ${sessionsToDelete} Sessions without a name or Root directory are deleted.`
    const response = await ask({
      type: 'question',
      message: 'Quit Blind?',
      detail: `Every Shell stops. Sessions come back with fresh Shells the next time Blind starts.${deletionNote}`,
      buttons: ['Quit', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    })
    if (response !== 0) {
      quitInProgress = false
      core.quitCancelled()
      return
    }
    await flushScrollback()
    core.quitConfirmed()
  }

  // Like the quit confirmation, Return accepts and Escape cancels.
  async function confirmDelete (sessionId: SessionId) {
    const label = core.sessionLabel(sessionId)
    if (label === undefined) return
    const response = await ask({
      type: 'warning',
      message: `Delete ${label}?`,
      detail: 'Its Shells stop, and its Tabs, Panes and scrollback are removed for good.',
      buttons: ['Delete', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    })
    if (response === 0) core.deleteConfirmed(sessionId)
  }

  if (!globalShortcut.register(hotkey, () => core.hotkeyPressed())) {
    console.error(`Couldn't register the Hotkey ${hotkey}; another app may own it.`)
  }
  app.on('will-quit', () => globalShortcut.unregisterAll())
  // Every way of quitting, Cmd+Q included, goes through the core's confirmation.
  app.on('before-quit', (event) => {
    if (savedForQuit) return
    event.preventDefault()
    core.quitRequested()
  })
  // A restart or shutdown isn't the user quitting, so it saves and quits without asking. It skips waiting for the
  // terminals, whose scrollback is at most a moment old, so that the system's own quit request finds the app quitting
  // rather than cancelling the restart.
  powerMonitor.on('shutdown', () => {
    if (!savedForQuit) core.quitConfirmed()
  })
  // Closing the last Open Session's window leaves the app running, so the Hotkey can open a new Session.
  app.on('window-all-closed', () => {})
  app.on('did-resign-active', () => core.focusLost())

  function sessionView (sessionId: SessionId): SessionView | undefined {
    const session = core.state().sessions.find((candidate) => candidate.id === sessionId)
    if (!session) return undefined
    return {
      sessionLabel: core.shortSessionLabel(sessionId) ?? '',
      tabs: session.tabs.map((tab) => ({
        id: tab.id,
        title: core.tabTitle(tab.id) ?? '',
        panes: core.paneRects(tab.id),
        focusedPaneId: tab.focusedPaneId,
      })),
      focusedTabId: session.focusedTabId,
    }
  }

  function sendSessionView (sessionId: SessionId, window: BrowserWindow) {
    const view = sessionView(sessionId)
    if (view && !window.isDestroyed()) window.webContents.send(channels.sessionView, view)
  }

  core.onStateChange(() => windows.forEach((window, sessionId) => sendSessionView(sessionId, window)))

  function sendWindowSettings (window: BrowserWindow) {
    if (window.isDestroyed()) return
    const { scrollbackLines, sessionLabelPosition } = core.settings()
    const settings: WindowSettings = { scrollbackLines, sessionLabelPosition }
    window.webContents.send(channels.windowSettings, settings)
  }

  function sendTheme (window: BrowserWindow) {
    if (!window.isDestroyed()) window.webContents.send(channels.applyTheme, core.theme())
  }

  ipcMain.on(channels.focusPane, (_event, paneId: PaneId) => core.focusPane(paneId))
  ipcMain.handle(channels.searchThemes, (_event, query: string) => core.themeResults(query))
  ipcMain.on(channels.previewTheme, (_event, name: string) => core.previewTheme(name))
  ipcMain.handle(channels.searchMenuBarIcons, (_event, query: string) => core.menuBarIconResults(query))
  ipcMain.on(channels.previewMenuBarIcon, (_event, icon: MenuBarIcon) => core.previewMenuBarIcon(icon))
  ipcMain.handle(channels.searchPalette, (_event, query: string) => core.paletteResults(query))
  ipcMain.on(channels.choosePaletteResult, (_event, result: PaletteResult) => core.choosePaletteResult(result))
  ipcMain.on(channels.dismissPalette, () => core.paletteDismissed())
  ipcMain.on(channels.answerPalettePrompt, (_event, prompt: PalettePrompt, answer: string) => {
    if (prompt.type === 'askSessionName') core.renameSession(prompt.sessionId, answer)
    else core.renameTab(prompt.tabId, answer)
  })

  // A restored Pane's terminal gets its saved scrollback first, with no colour or style left over from it. The line the
  // cursor was on, usually the old Shell's idle prompt, gives way to a dim marker, and the fresh Shell's output follows.
  ipcMain.handle(channels.attachPane, (event, paneId: PaneId, size: TerminalSize) => {
    const scrollback = core.scrollback(paneId)
    if (scrollback) {
      const replay = `${scrollback.text}\x1b[0m\r\x1b[2K${restoredMarker(scrollback.savedAt)}\r\n`
      event.sender.send(channels.paneData, paneId, replay)
    }
    shellHost.resize(paneId, size)
    shellHost.attach(paneId, (data) => {
      if (!event.sender.isDestroyed()) event.sender.send(channels.paneData, paneId, data)
    })
  })
  ipcMain.on(channels.writeToPane, (_event, paneId: PaneId, data: string) => shellHost.write(paneId, data))
  ipcMain.on(channels.resizePane, (_event, paneId: PaneId, size: TerminalSize) => shellHost.resize(paneId, size))
  ipcMain.on(channels.reportScrollback, (_event, paneId: PaneId, scrollback: string) =>
    core.scrollbackChanged(paneId, scrollback)
  )
  ipcMain.on(channels.scrollbackFlushed, (event) => scrollbackFlushes.get(event.sender)?.())
  ipcMain.on(channels.copyText, (_event, text: string) => clipboard.writeText(text))
  ipcMain.handle(channels.openableLinks, (_event, paneId: PaneId, texts: string[]) =>
    texts.map((text) => {
      const target = core.linkTarget(paneId, text)
      return target?.type === 'url' || (target?.type === 'path' && existsSync(target.path))
    })
  )
  ipcMain.on(channels.openLink, (_event, paneId: PaneId, text: string) => {
    const target = core.linkTarget(paneId, text)
    if (target?.type === 'url') shell.openExternal(target.url)
    if (target?.type === 'path') shell.openPath(target.path)
  })

  // A transparent panel filling the visible area, floating above other apps, fullscreen ones included, on every Space.
  function createPanel (options: Electron.BrowserWindowConstructorOptions = {}) {
    const window = new BrowserWindow({
      ...screen.getPrimaryDisplay().workArea,
      type: 'panel',
      show: false,
      frame: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      webPreferences: { preload: join(import.meta.dirname, '../preload/index.mjs'), sandbox: false },
      ...options,
    })
    window.setAlwaysOnTop(true, 'screen-saver')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    window.webContents.on('did-finish-load', () => {
      sendWindowSettings(window)
      sendTheme(window)
    })
    return window
  }

  // The renderer's page; `hash` picks which page it is.
  function loadPage (window: BrowserWindow, hash?: string) {
    const url = process.env.ELECTRON_RENDERER_URL
    if (url) window.loadURL(hash ? `${url}#${hash}` : url)
    else window.loadFile(join(import.meta.dirname, '../renderer/index.html'), { hash })
  }

  // One window per Open Session, made the first time the Session is shown, with the window's blur behind its Panes.
  function windowFor (sessionId: SessionId) {
    const existing = windows.get(sessionId)
    if (existing) return existing
    const window = createPanel({ vibrancy: 'under-window', visualEffectState: 'active' })
    windows.set(sessionId, window)
    // A window closing late, after its scrollback flush, leaves alone the window a reopened Session has since made.
    window.on('closed', () => {
      if (windows.get(sessionId) === window) windows.delete(sessionId)
    })
    window.webContents.on('did-finish-load', () => sendSessionView(sessionId, window))
    // Bound shortcuts are taken before the Pane's terminal sees them.
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && core.keyPressed(sessionId, input)) event.preventDefault()
    })
    loadPage(window)
    return window
  }

  // Read before starting, so restored Shells start with the configured shell.
  function applyConfig (read: ConfigRead) {
    if (read.readable) core.configChanged(read.text)
    else core.configUnreadable()
  }

  // Made before the config file is read, which can change the icon. The installed app carries `resources/` outside its
  // archive.
  const resourcesDirectory = app.isPackaged ? process.resourcesPath : app.getAppPath()
  const menuBarIcon = createMenuBarIcon(core, join(resourcesDirectory, 'resources'))

  // The Themes load first, so the theme setting can name a Theme file's Theme.
  themeFiles.writeSchema()
  core.themeFilesChanged(themeFiles.read())
  themeFiles.watch((files) => core.themeFilesChanged(files))
  configFile.writeSchema()
  applyConfig(configFile.read())
  configFile.watch((read) => {
    applyConfig(read)
    allWindows().forEach(sendWindowSettings)
    // The cycle order setting may have changed.
    menuBarIcon.update()
  })
  // The installed app opens at login, hidden or shown as the loginLaunch setting says.
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true })
  const { shown } = core.start({ atLogin: app.getLoginItemSettings().wasOpenedAtLogin })
  // Showing now, not on ready-to-show, keeps the window in step with the core.
  if (shown) showWindow(windowFor(core.state().currentSessionId!))
})
