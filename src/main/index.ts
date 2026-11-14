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
import type { ProgramStatusReport } from '../core/attention'
import { blurIssueUrl, shouldWarnBlurUnavailable } from '../core/blur-warning'
import { type MenuBarIcon, minimumBlurRadius } from '../core/config'
import { createCore, type Effect, type PaletteResult } from '../core/core'
import type { PaneId, SessionId } from '../core/state'
import { channels, type PalettePrompt, type SessionView, type TerminalSize, type WindowSettings } from '../shared/ipc'
import { createBlurWarningFile } from './blur-warning-file'
import { type ConfigRead, createConfigFile } from './config-file'
import { fadeWindow } from './fade'
import { createFileStateStore } from './file-state-store'
import { createMenuBarIcon } from './menu-bar-icon'
import { createNodePtyShellHost } from './node-pty-shell-host'
import { createThemeFiles } from './theme-files'
import { loadWindowEffects } from './window-effects'

// The installed app's Hotkey is F12; running from the repo uses F7, so both can run side by side.
const hotkey = app.isPackaged ? 'F12' : 'F7'

// Running from the repo keeps its data and config apart from the installed app's, so trying a change never touches the
// installed app's Sessions or settings. Electron's own files go with the data, set before the app is ready, as Electron
// requires; the installed app keeps Electron's default.
const dataDirectory = join(app.getPath('appData'), app.isPackaged ? 'Blind' : 'Blind Dev')
const configDirectory = join(homedir(), '.config', app.isPackaged ? 'blind' : 'blind-dev')
if (!app.isPackaged) app.setPath('userData', dataDirectory)

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
    stateStore: createFileStateStore(dataDirectory),
    clock: { now: () => Date.now() },
    homeDirectory: homedir(),
  })
  const configFile = createConfigFile(configDirectory)
  const themeFiles = createThemeFiles(join(configDirectory, 'themes'))
  const windows = new Map<SessionId, BrowserWindow>()
  // The installed app carries the native addon outside its archive.
  const windowEffects = loadWindowEffects(
    app.isPackaged
      ? join(process.resourcesPath, 'native', 'window_effects.node')
      : join(app.getAppPath(), 'native', 'build', 'Release', 'window_effects.node')
  )
  const blurWarningFile = createBlurWarningFile(dataDirectory)
  let blurWarnedThisLaunch = false

  // Blind shows only on the primary display, filling its work area, which can change after a window was made: another
  // display becomes primary, or the resolution or the Dock changes.
  function fitToPrimaryDisplay (window: BrowserWindow) {
    if (!window.isDestroyed()) window.setBounds(screen.getPrimaryDisplay().workArea)
  }

  // Every window is fitted again when displays change, hidden ones too, so a Session's Panes already have their new size
  // when cycling swaps it in. A display unplugged while Blind is shown leaves the remaining primary display to fill.
  function fitAllWindows () {
    windows.forEach(fitToPrimaryDisplay)
  }

  // Blind becomes the active app while shown, like iTerm2's hotkey window, so switching to any other app is a focus loss.
  function showWindow (window: BrowserWindow) {
    app.show()
    fitToPrimaryDisplay(window)
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

  // Shows the Session's window at once and hides the one it replaces, with no fade.
  function swapToWindow (sessionId: SessionId) {
    const window = windowFor(sessionId)
    fitToPrimaryDisplay(window)
    window.setOpacity(1)
    window.show()
    window.focus()
    for (const other of windows.values()) {
      if (other !== window && other.isVisible()) other.hide()
    }
  }

  // A window cycling has just made for the Session is still loading, so the banner waits for its page, and is dropped
  // if another press has swapped the window out by then.
  function showSessionBanner (sessionId: SessionId) {
    const window = windows.get(sessionId)
    const label = core.shortSessionLabel(sessionId)
    if (!window || label === undefined) return
    const send = () => {
      if (!window.isDestroyed() && window.isVisible()) window.webContents.send(channels.showSessionBanner, label)
    }
    if (window.webContents.isLoading()) window.webContents.once('did-finish-load', send)
    else send()
  }

  // With no window left on screen, e.g. once the last Open Session's window closed, there's nothing to fade.
  function hideApp () {
    const visible = [...windows.values()].filter((window) => window.isVisible())
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
    if (effect.type === 'openPalette') windows.get(effect.sessionId)?.webContents.send(channels.openPalette)
    if (effect.type === 'hideApp') hideApp()
    if (effect.type === 'showSession') swapToWindow(effect.sessionId)
    if (effect.type === 'showSessionBanner') showSessionBanner(effect.sessionId)
    if (effect.type === 'confirmQuit') confirmQuit(effect)
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
    if (effect.type === 'applyTheme') windows.forEach(sendTheme)
    if (effect.type === 'writeConfig') configFile.write(effect.text)
    if (effect.type === 'pickTheme') windows.get(effect.sessionId)?.webContents.send(channels.pickTheme)
    if (effect.type === 'applyMenuBarIcon') menuBarIcon.show(effect.icon)
    if (effect.type === 'pickMenuBarIcon') {
      windows.get(effect.sessionId)?.webContents.send(channels.pickMenuBarIcon, core.menuBarIcon())
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
  // Set while the dialog is up for a restart, or for a quit that a restart was asked for during, so that confirming it
  // starts Blind again.
  let restartOnQuit = false
  // Set once saving for a quit has begun, so that ways of quitting that meet, e.g. SIGTERM while the dialog is up, save
  // and quit once.
  let saving = false
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
  // from outside while hidden, the app comes forward to show it. Answers with the chosen button's index and whether the
  // checkbox, if any, was ticked.
  async function ask (options: Electron.MessageBoxOptions) {
    const parent = [...windows.values()].find((window) => window.isVisible())
    if (!parent) app.focus({ steal: true })
    return parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
  }

  // Saves and quits, taking the terminals' latest scrollback first unless told not to wait for it.
  async function saveAndQuit ({ waitForScrollback }: { waitForScrollback: boolean }) {
    if (savedForQuit || saving) return
    saving = true
    if (waitForScrollback) await flushScrollback()
    core.quitConfirmed()
  }

  // Tells how many Sessions quitting deletes, if any. A restart starts Blind again once it has quit, from the copy now in
  // its place, e.g. one just installed; cancelled, nothing of it is left to happen later.
  async function confirmQuit ({ restart, sessionsToDelete }: Extract<Effect, { type: 'confirmQuit' }>) {
    if (quitInProgress) {
      restartOnQuit ||= restart === true
      return
    }
    quitInProgress = true
    restartOnQuit = restart === true
    const deletionNote =
      sessionsToDelete === undefined
        ? ''
        : sessionsToDelete === 1
          ? ' 1 Session without a name or Root directory is deleted.'
          : ` ${sessionsToDelete} Sessions without a name or Root directory are deleted.`
    const comingBack = restart ? 'as Blind starts again' : 'the next time Blind starts'
    const { response } = await ask({
      type: 'question',
      message: restart ? 'Restart Blind?' : 'Quit Blind?',
      detail: `Every Shell stops. Sessions come back with fresh Shells ${comingBack}.${deletionNote}`,
      buttons: [restart ? 'Restart' : 'Quit', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    })
    if (response !== 0) {
      quitInProgress = false
      restartOnQuit = false
      return
    }
    if (restartOnQuit) app.relaunch()
    await saveAndQuit({ waitForScrollback: true })
  }

  // Like the quit confirmation, Return accepts and Escape cancels.
  async function confirmDelete (sessionId: SessionId) {
    const label = core.sessionLabel(sessionId)
    if (label === undefined) return
    const { response } = await ask({
      type: 'warning',
      message: `Delete ${label}?`,
      detail: 'Its Shells stop, and its Tabs, Panes and scrollback are removed for good.',
      buttons: ['Delete', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    })
    if (response === 0) core.deleteConfirmed(sessionId)
  }

  // Blurs what's behind a Session window as the settings say, through the native addon. `none` sets the lightest blur
  // rather than none at all, so that `blur` can come back. Only a visible window: macOS makes a window's backing only
  // once it is first shown, and a window's blur is set again each time it shows.
  function applyBackgroundEffect (window: BrowserWindow) {
    if (window.isDestroyed() || !window.isVisible()) return
    const { backgroundEffect, backgroundBlurRadius } = core.settings()
    windowEffects.setBlurRadius(window, backgroundEffect === 'blur' ? backgroundBlurRadius : minimumBlurRadius)
  }

  // Says that windows can't blur, while blur is wanted: once per launch, and not again until Blind or macOS changes
  // version once "Don't show again" is ticked. Report on GitHub opens a new issue, filled in.
  async function warnIfBlurUnavailable () {
    const failure = windowEffects.blurFailure
    if (!failure) return
    const versions = { app: app.getVersion(), os: process.getSystemVersion() }
    const check = {
      backgroundEffect: core.settings().backgroundEffect,
      warnedThisLaunch: blurWarnedThisLaunch,
      dismissedFor: blurWarningFile.dismissedFor(),
      versions,
    }
    if (!shouldWarnBlurUnavailable(check)) return
    blurWarnedThisLaunch = true
    const { response, checkboxChecked } = await ask({
      type: 'warning',
      message: "Windows can't blur",
      detail:
        "Blind blurs what's behind its windows through a private macOS function, which no longer works, so windows show it unblurred. Setting backgroundEffect to none in config.jsonc stops this message.",
      buttons: ['Report on GitHub', 'OK'],
      defaultId: 1,
      cancelId: 1,
      checkboxLabel: "Don't show again",
    })
    if (checkboxChecked) blurWarningFile.dismiss(versions)
    if (response === 0) shell.openExternal(blurIssueUrl(versions, failure, homedir()))
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
  // An OS restart or shutdown isn't the user quitting, so it saves and quits without asking. It skips waiting for the
  // terminals, whose scrollback is at most a moment old, so that the system's own quit request finds the app quitting
  // rather than cancelling the OS restart.
  powerMonitor.on('shutdown', () => saveAndQuit({ waitForScrollback: false }))
  // Being told to stop, e.g. by `blind install --force` or `kill`, saves and quits without asking, as an OS restart or
  // shutdown does, though with time to take the terminals' latest scrollback first.
  process.on('SIGTERM', () => saveAndQuit({ waitForScrollback: true }))
  // `blind install` asks for a restart into the copy it has just installed. Only the installed app takes `blind:` URLs,
  // and any app or web page can open one, so a restart this way is always confirmed.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    if (url === 'blind://restart') core.restartRequested()
  })
  // Closing the last Open Session's window leaves the app running, so the Hotkey can open a new Session.
  app.on('window-all-closed', () => {})
  app.on('did-resign-active', () => core.focusLost())
  screen.on('display-added', fitAllWindows)
  screen.on('display-removed', fitAllWindows)
  screen.on('display-metrics-changed', fitAllWindows)

  function sessionView (sessionId: SessionId): SessionView | undefined {
    const session = core.state().sessions.find((candidate) => candidate.id === sessionId)
    if (!session) return undefined
    return {
      sessionLabel: core.shortSessionLabel(sessionId) ?? '',
      activityChips: core.activityChips(sessionId),
      tabs: session.tabs.map((tab) => ({
        id: tab.id,
        title: core.tabTitle(tab.id) ?? '',
        panes: core.paneRects(tab.id),
        focusedPaneId: tab.focusedPaneId,
        activity: core.tabHasActivity(tab.id),
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
    const { scrollbackLines, sessionLabelPosition, panePadding, paneScrollBar, backgroundTransparency } = core.settings()
    const settings: WindowSettings = {
      scrollbackLines,
      sessionLabelPosition,
      panePadding,
      paneScrollBar,
      backgroundTransparency,
    }
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
  ipcMain.on(channels.reportNotification, (_event, paneId: PaneId) => core.notificationReceived(paneId))
  ipcMain.on(channels.reportProgramStatus, (_event, paneId: PaneId, report: ProgramStatusReport) =>
    core.programStatusReported(paneId, report)
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
  // It shows without macOS's zoom animation, so cycling swaps windows in a single frame; the Hotkey fades it instead.
  function createPanel (options: Electron.BrowserWindowConstructorOptions = {}) {
    const window = new BrowserWindow({
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
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: { preload: join(import.meta.dirname, '../preload/index.mjs'), sandbox: false },
      ...options,
    })
    window.setAlwaysOnTop(true, 'screen-saver')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    fitToPrimaryDisplay(window)
    windowEffects.turnOffShowAnimation(window)
    window.webContents.on('did-finish-load', () => {
      sendWindowSettings(window)
      sendTheme(window)
    })
    return window
  }

  // The renderer's page.
  function loadPage (window: BrowserWindow) {
    const url = process.env.ELECTRON_RENDERER_URL
    if (url) window.loadURL(url)
    else window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }

  // One window per Open Session, made the first time the Session is shown, with the window's blur behind its Panes.
  function windowFor (sessionId: SessionId) {
    const existing = windows.get(sessionId)
    if (existing) return existing
    const window = createPanel()
    windows.set(sessionId, window)
    window.on('show', () => applyBackgroundEffect(window))
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
    windows.forEach(sendWindowSettings)
    windows.forEach(applyBackgroundEffect)
    warnIfBlurUnavailable()
    // The cycle order setting may have changed.
    menuBarIcon.update()
  })
  // The installed app opens at login, hidden or shown as the loginLaunch setting says.
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true })
  const { shown } = core.start({ atLogin: app.getLoginItemSettings().wasOpenedAtLogin })
  // Showing now, not on ready-to-show, keeps the window in step with the core.
  if (shown) showWindow(windowFor(core.state().currentSessionId!))
  warnIfBlurUnavailable()
})
