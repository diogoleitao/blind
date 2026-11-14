import {
  type FocusDirection,
  neighbourOf,
  type PaneRect,
  paneRects,
  removePane,
  replacePane,
  successorOf,
} from './layout'
import {
  defaultSettings,
  type MenuBarIcon,
  menuBarIcons,
  type PaneSearchScope,
  type ParsedConfig,
  parseConfig,
  type Settings,
  type StartDirectory,
  starterConfig,
  type TabSearchScope,
} from './config'
import { fuzzyScore } from './fuzzy'
import { setJsoncProperty } from './jsonc'
import { type BoundAction, type KeyPress, matchesShortcut } from './key-bindings'
import { type LinkTarget, linkTarget } from './links'
import type { Clock, SavedScrollback, ShellHost, Snapshot, StateStore } from './ports'
import { capScrollback } from './scrollback'
import { builtInThemes, defaultTheme, loadThemes, type Theme, type ThemeFile } from './themes'
import {
  type CoreState,
  idsIn,
  type Pane,
  panesIn,
  type PaneId,
  type Session,
  type SessionId,
  type SplitDirection,
  type Tab,
  type TabId,
} from './state'

export type Effect =
  | { type: 'closeWindow'; sessionId: SessionId }
  // Fades the app in with the Session visible.
  | { type: 'showApp'; sessionId: SessionId }
  // Fades the app in with the Command Palette on its own, over no Session.
  | { type: 'showPalette' }
  // Opens the Command Palette over the Session's window.
  | { type: 'openPalette'; sessionId: SessionId }
  | { type: 'hideApp' }
  // Makes the Session the visible one in place of the Session shown before, without a fade.
  | { type: 'showSession'; sessionId: SessionId }
  // Shows the Session Banner over the Session's window, which cycling has just swapped in.
  | { type: 'showSessionBanner'; sessionId: SessionId }
  // Asks the user whether to quit, answered with `quitConfirmed`, telling how many Sessions quitting deletes, if any.
  | { type: 'confirmQuit'; sessionsToDelete?: number }
  // Asks the user for the Session's name, offering `suggestion`, answered with `renameSession`.
  | { type: 'askSessionName'; sessionId: SessionId; suggestion: string }
  // Asks the user whether to delete the Session, answered with `deleteConfirmed`.
  | { type: 'confirmDelete'; sessionId: SessionId }
  // Asks the user for the title of a Tab in the Session, offering `suggestion`, answered with `renameTab`.
  | { type: 'askTabTitle'; sessionId: SessionId; tabId: TabId; suggestion: string }
  // Opens the config file for editing.
  | { type: 'openSettings' }
  // Everything is saved; the app can exit.
  | { type: 'quit' }
  // Tells the user the config file's settings that were rejected and fell back to their defaults.
  | { type: 'settingsRejected'; settings: string[] }
  // Tells the user the config file couldn't be read as a JSON object, comments allowed, so the settings stay as they were.
  | { type: 'configUnreadable' }
  // The Theme in effect changed; every window follows it.
  | { type: 'applyTheme'; theme: Theme }
  // The menu bar icon in effect changed.
  | { type: 'applyMenuBarIcon'; icon: MenuBarIcon }
  // Replaces the config file's text, e.g. to set the theme setting to the Theme chosen in the Command Palette.
  | { type: 'writeConfig'; text: string }
  // Has the Command Palette list the Themes, over the Session's window or, without one, on its own.
  | { type: 'pickTheme'; sessionId?: SessionId }
  // Has the Command Palette list the menu bar icons, like `pickTheme`.
  | { type: 'pickMenuBarIcon'; sessionId?: SessionId }
  // Tells the user the Theme files, or their fields, that were rejected, as `loadThemes` names them.
  | { type: 'themesRejected'; rejected: string[] }
  // Opens a search over the Pane's scrollback in the Session's window.
  | { type: 'findInPane'; sessionId: SessionId; paneId: PaneId }
  // Clears the scrollback of the Pane's terminal in the Session's window.
  | { type: 'clearScrollback'; sessionId: SessionId; paneId: PaneId }
  // Copies what is selected in the Session's window: in its focused Pane's terminal, or in a text field it has open.
  | { type: 'copy'; sessionId: SessionId }
  // Pastes the clipboard's text where the Session's window takes typing.
  | { type: 'paste'; sessionId: SessionId }

// Every app action, in the order the Command Palette offers them, by its label.
const paletteActionLabels = {
  newSession: 'New Session',
  renameSession: 'Rename Session',
  setSessionRoot: 'Set Session Root',
  clearSessionRoot: 'Clear Session Root',
  closeSession: 'Close Session',
  deleteSession: 'Delete Session',
  newTab: 'New Tab',
  renameTab: 'Rename Tab',
  clearTabTitle: 'Clear Tab Title',
  splitPaneVertically: 'Split Pane Vertically',
  splitPaneHorizontally: 'Split Pane Horizontally',
  closePane: 'Close Pane',
  nextSession: 'Next Session',
  previousSession: 'Previous Session',
  nextTab: 'Next Tab',
  previousTab: 'Previous Tab',
  nextPane: 'Next Pane',
  previousPane: 'Previous Pane',
  focusPaneLeft: 'Focus Pane Left',
  focusPaneRight: 'Focus Pane Right',
  focusPaneUp: 'Focus Pane Above',
  focusPaneDown: 'Focus Pane Below',
  findInPane: 'Find in Pane',
  clearScrollback: 'Clear Scrollback',
  changeTheme: 'Change Theme',
  changeMenuBarIcon: 'Change Menu Bar Icon',
  openSettings: 'Open Settings',
  quit: 'Quit Blind',
} as const

export type PaletteAction = keyof typeof paletteActionLabels

// How deep a result sits in the Command Palette's nested view: 0 at the top, 1 under a Session, 2 under a Tab.
export type PaletteLevel = 0 | 1 | 2

// One entry the Command Palette offers. `current` marks the Current Session, Current Tab or Current Pane, where the
// user already is, which the Command Palette lists and lets the user select but not choose. `level` is set in the
// nested view alone.
export type PaletteResult =
  | { type: 'session'; sessionId: SessionId; label: string; closed: boolean; current: boolean; level?: PaletteLevel }
  | { type: 'tab'; tabId: TabId; label: string; sessionLabel: string; current: boolean; level?: PaletteLevel }
  | {
    type: 'pane';
    paneId: PaneId;
    label: string;
    workingDirectory: string;
    sessionLabel: string;
    current: boolean;
    level?: PaletteLevel;
  }
  | { type: 'action'; action: PaletteAction; label: string; level?: PaletteLevel }
  // A Theme, labelled with its name.
  | { type: 'theme'; name: string; label: string }
  | { type: 'menuBarIcon'; icon: MenuBarIcon; label: string }

const menuBarIconLabels: Record<MenuBarIcon, string> = {
  monochrome: 'Monochrome',
  colour: 'Colour',
}

// The app actions the menu bar icon's menu offers after the Sessions, in order.
const menuBarActions = ['newSession', 'openSettings', 'quit'] as const satisfies PaletteAction[]

export type MenuBarAction = (typeof menuBarActions)[number]

// A Session the menu bar icon's menu lists, under its label.
export interface MenuBarSession {
  sessionId: SessionId;
  label: string;
}

// What the menu bar icon's menu lists: the Open Sessions and the Closed Sessions apart, each in cycle order, then the
// app actions under their Command Palette labels.
export interface MenuBar {
  open: MenuBarSession[];
  closed: MenuBarSession[];
  actions: { action: MenuBarAction; label: string }[];
}

export interface CoreDependencies {
  shellHost: ShellHost;
  stateStore: StateStore;
  clock: Clock;
  homeDirectory: string;
}

export interface Core {
  // The launch at login starts hidden or shown as the loginLaunch setting says; started hidden, the app stays off screen
  // until the Hotkey shows it. Answers whether the app started shown.
  start(options: { atLogin: boolean }): { shown: boolean };
  state(): CoreState;
  // With no Open Sessions, shows a new Session or the Command Palette on its own, as the setting says.
  hotkeyPressed(): void;
  // The Command Palette closed without a choice, ending any Theme preview. Shown on its own, with no Current Session,
  // the app hides with it.
  paletteDismissed(): void;
  // Blind stopped being the active app, e.g. because another app was clicked.
  focusLost(): void;
  // Quitting always asks for confirmation first.
  quitRequested(): void;
  // With the Command Palette on its own, the only thing on screen, the app hides once the quit is cancelled.
  quitCancelled(): void;
  quitConfirmed(): void;
  // The config file's text, or undefined without a file. Settings start at their defaults, as without a file. Text that
  // isn't a JSON object, e.g. a save caught halfway through an edit, leaves the settings as they were.
  configChanged(config: string | undefined): void;
  // The config file exists but couldn't be opened; the settings stay as they were.
  configUnreadable(): void;
  settings(): Settings;
  // The Theme in effect.
  theme(): Theme;
  // The menu bar icon in effect.
  menuBarIcon(): MenuBarIcon;
  // Every Theme file in the themes folder, read again whenever one changes.
  themeFilesChanged(files: ThemeFile[]): void;
  // The Themes the Command Palette offers for a query: the built-in ones, the Default Theme first, then the Theme
  // files' by name.
  themeResults(query: string): PaletteResult[];
  // Puts the Theme in effect while the Command Palette lists the Themes: choosing a Theme keeps one, and dismissing the
  // palette restores the Theme from before.
  previewTheme(name: string): void;
  // The menu bar icons the Command Palette offers for a query, monochrome first.
  menuBarIconResults(query: string): PaletteResult[];
  // Like `previewTheme`, for the menu bar icon.
  previewMenuBarIcon(icon: MenuBarIcon): void;
  // Opens an Unnamed Session with one Tab at the home directory and makes it the Current Session.
  newSession(): void;
  // Opens a Closed Session again as the Current Session, restoring it as Restore does. One closed through its last Tab
  // gets a fresh Tab at the home directory when the newTabDirectory setting is home, and otherwise at its Root
  // directory, or the home directory without one.
  reopenSession(sessionId: SessionId): void;
  // Shows the app with the Session chosen from the menu bar icon's menu as the Current Session, reopening a Closed
  // Session first.
  menuBarSessionChosen(sessionId: SessionId): void;
  // Runs an app action chosen from the menu bar icon's menu; a new Session is shown even while the app is hidden.
  menuBarActionChosen(action: MenuBarAction): void;
  // Gives the Session a name, freeing its label number. A name another Session holds gets the smallest free number from
  // 2, e.g. `api 2`, so names stay unique; a blank name changes nothing.
  renameSession(sessionId: SessionId, name: string): void;
  // Makes the current Pane's working directory the Session's Root directory. An Unnamed Session is named after the
  // last segment of its path, as `renameSession` names it, even when it already had this Root directory.
  setSessionRoot(sessionId: SessionId): void;
  clearSessionRoot(sessionId: SessionId): void;
  // Makes an Open Session a Closed Session at once, stopping its Shells and keeping its Tabs and Panes for Restore.
  closeSession(sessionId: SessionId): void;
  // Deleting always asks for confirmation first.
  deleteRequested(sessionId: SessionId): void;
  // Removes the Session, Open or Closed, for good, with its scrollback, stopping its Shells.
  deleteConfirmed(sessionId: SessionId): void;
  // Both move the Current Session through the Open Sessions in cycle order, wrapping around.
  focusPreviousSession(): void;
  focusNextSession(): void;
  // Opens a Tab after the others and focuses it, in the directory the newTabDirectory setting picks.
  newTab(sessionId: SessionId): void;
  // Focuses the Tab at a zero-based position, if there is one.
  focusTab(sessionId: SessionId, position: number): void;
  // Both wrap around between the first and last Tab.
  focusPreviousTab(sessionId: SessionId): void;
  focusNextTab(sessionId: SessionId): void;
  // Fixes the Tab's title until it's cleared; a blank title clears it.
  renameTab(tabId: TabId, title: string): void;
  // The Tab's title follows its focused Pane again.
  clearTabTitle(tabId: TabId): void;
  // Splits the focused Pane in two, starting the new half's Shell in the directory the splitPaneDirectory setting picks,
  // and focuses it.
  splitPane(sessionId: SessionId, direction: SplitDirection): void;
  // Closes the focused Pane and stops its Shell, following the same chain as the Shell exiting.
  closePane(sessionId: SessionId): void;
  // Both move through the focused Tab's Panes in layout order, wrapping around between the first and last.
  focusPreviousPane(sessionId: SessionId): void;
  focusNextPane(sessionId: SessionId): void;
  // Moves to the Pane across the focused Pane's edge, if there is one.
  focusPaneInDirection(sessionId: SessionId, direction: FocusDirection): void;
  // Runs the action the key is bound to on the Session whose window it was pressed in, answering whether one was, so
  // the Pane's terminal gets the key only when none was.
  keyPressed(sessionId: SessionId, keyPress: KeyPress): boolean;
  // Focuses a Pane within its Tab, e.g. because it was clicked.
  focusPane(paneId: PaneId): void;
  // The title the Tab was renamed to, or else the focused Pane's running program, or its working directory's folder name
  // while the Shell is idle.
  tabTitle(tabId: TabId): string | undefined;
  // The Session's name, or for an Unnamed Session `Session N (<dir>)` with the focused Pane's working directory.
  sessionLabel(sessionId: SessionId): string | undefined;
  // The Session's name, or for an Unnamed Session `Session N` alone, as the Tab bar shows it.
  shortSessionLabel(sessionId: SessionId): string | undefined;
  // Every Session, Open or Closed, in the order cycling follows: Unnamed Sessions after the named ones.
  sessionsInCycleOrder(): Session[];
  menuBar(): MenuBar;
  // What the Command Palette offers for a query: every Session, Open and Closed, the Tabs and Panes of Open Sessions,
  // and every app action. `ss `, `tt ` and `pp ` narrow it to Sessions, Tabs or Panes.
  paletteResults(query: string): PaletteResult[];
  // Jumps to a Session, Tab or Pane, making its Session the Current Session with the Tab or Pane focused and reopening a
  // Closed Session first; or runs an app action on the Current Session.
  choosePaletteResult(result: PaletteResult): void;
  // Where each of the Tab's Panes sits, in layout order.
  paneRects(tabId: TabId): PaneRect[];
  // A Pane's terminal reported its serialized scrollback, which is kept up to its last lines, as many as the scrollback
  // lines setting says, and stamped with the clock's time.
  scrollbackChanged(paneId: PaneId, scrollback: string): void;
  // The Pane's saved scrollback, for its terminal to replay when it opens.
  scrollback(paneId: PaneId): SavedScrollback | undefined;
  // What Cmd+clicking a link in the Pane's terminal opens: a relative path is taken from the Pane's working directory.
  // Absent for an unknown Pane.
  linkTarget(paneId: PaneId, text: string): LinkTarget | undefined;
  onEffect(listener: (effect: Effect) => void): void;
  onStateChange(listener: (state: CoreState) => void): void;
}

export function createCore ({ shellHost, stateStore, clock, homeDirectory }: CoreDependencies): Core {
  let state: CoreState = { sessions: [] }
  // Kept out of the state: terminals report it far more often than anything else changes.
  let scrollback: Record<PaneId, SavedScrollback> = {}
  // Whether the app is on screen. Not part of the snapshot: it says nothing about Sessions.
  let appShown = true
  let settings: Settings = defaultSettings
  // The config file's text the settings were last read from, read again when the Themes change.
  let configText: string | undefined
  // Whether the config file read as it is now, so that it's written only over text the settings came from.
  let configReadable = true
  // Whether the theme setting names no Theme loaded, so the user hears of it once.
  let themeSettingRejected = false
  let themes: Theme[] = builtInThemes
  // The Theme the windows were last told to follow.
  let appliedTheme = defaultTheme
  // The name of the Theme browsed to in the Command Palette, in effect until the palette closes; absent otherwise.
  let previewedTheme: string | undefined
  // The icon the menu bar was last told to show.
  let appliedMenuBarIcon = defaultSettings.menuBarIcon
  // The menu bar icon browsed to in the Command Palette, in effect until the palette closes; absent otherwise.
  let previewedMenuBarIcon: MenuBarIcon | undefined
  // The Session order taken at the first of a run of consecutive cycle presses; absent outside one.
  let cycleStreak: SessionId[] | undefined
  const effectListeners: ((effect: Effect) => void)[] = []
  const stateListeners: ((state: CoreState) => void)[] = []
  let lastId = 0

  function nextId (kind: 'session' | 'tab' | 'pane') {
    lastId += 1
    return `${kind}-${lastId}`
  }

  function emit (effect: Effect) {
    for (const listener of effectListeners) listener(effect)
  }

  // Absent for no name.
  function findTheme (name: string | undefined) {
    return themes.find((theme) => theme.name === name)
  }

  // The Theme being previewed, or else the one the theme setting names, or the Default Theme when none goes by that
  // name. A previewed Theme whose file went is passed over.
  function themeInEffect () {
    return findTheme(previewedTheme) ?? findTheme(settings.theme) ?? defaultTheme
  }

  // Sets the setting in the config file too, unless the file can't be read as it is now.
  function writeSetting (name: keyof Settings, value: string) {
    if (!configReadable) return emit({ type: 'configUnreadable' })
    configText = setJsoncProperty(configText ?? starterConfig, name, value)
    emit({ type: 'writeConfig', text: configText })
  }

  // Ends any preview, keeping the Theme chosen and setting the theme setting to it. A Theme whose file went since it
  // was listed leaves the setting as it was.
  function chooseTheme (name: string) {
    previewedTheme = undefined
    if (!findTheme(name)) return applyThemeInEffect()
    settings = { ...settings, theme: name }
    themeSettingRejected = false
    applyThemeInEffect()
    writeSetting('theme', name)
  }

  // Ends any preview, keeping the icon chosen and setting the menuBarIcon setting to it.
  function chooseMenuBarIcon (icon: MenuBarIcon) {
    previewedMenuBarIcon = undefined
    settings = { ...settings, menuBarIcon: icon }
    applyMenuBarIconInEffect()
    writeSetting('menuBarIcon', icon)
  }

  // Noting whether the theme setting names no Theme loaded.
  function takeSettings (parsed: ParsedConfig) {
    settings = parsed.settings
    themeSettingRejected = parsed.rejected.includes('theme')
  }

  function themeNames () {
    return themes.map((theme) => theme.name)
  }

  // Compared by value: reading the Theme files again makes new Themes of unchanged ones.
  function applyThemeInEffect () {
    const theme = themeInEffect()
    if (JSON.stringify(theme) === JSON.stringify(appliedTheme)) return
    appliedTheme = theme
    emit({ type: 'applyTheme', theme })
  }

  // The icon being previewed, or else the one the menuBarIcon setting names.
  function applyMenuBarIconInEffect () {
    const icon = previewedMenuBarIcon ?? settings.menuBarIcon
    if (icon === appliedMenuBarIcon) return
    appliedMenuBarIcon = icon
    emit({ type: 'applyMenuBarIcon', icon })
  }

  function save () {
    stateStore.save({ state, scrollback })
  }

  function setState (next: CoreState) {
    state = next
    save()
    for (const listener of stateListeners) listener(state)
  }

  function findSession (sessionId: SessionId) {
    return state.sessions.find((session) => session.id === sessionId)
  }

  function findTab (tabId: TabId) {
    return state.sessions.flatMap((session) => session.tabs).find((tab) => tab.id === tabId)
  }

  // Leaves the state, and its listeners, alone when `update` returns the Session unchanged.
  function updateSession (sessionId: SessionId, update: (session: Session) => Session) {
    const session = findSession(sessionId)
    if (!session) return
    const updated = update(session)
    if (updated === session) return
    setState({ ...state, sessions: state.sessions.map((candidate) => (candidate === session ? updated : candidate)) })
  }

  function updatePane (paneId: PaneId, update: (pane: Pane) => Pane) {
    setState({
      ...state,
      sessions: state.sessions.map((session) => ({
        ...session,
        tabs: session.tabs.map((tab) => ({
          ...tab,
          panes: tab.panes.map((pane) => (pane.id === paneId ? update(pane) : pane)),
        })),
      })),
    })
  }

  function focusedTab (session: Session) {
    return session.tabs.find((tab) => tab.id === session.focusedTabId)
  }

  function focusedPane (tab: Tab) {
    return tab.panes.find((pane) => pane.id === tab.focusedPaneId)!
  }

  // Like `updateSession`, leaves the state alone when `update` returns the Tab unchanged.
  function updateTab (tabId: TabId, update: (tab: Tab) => Tab) {
    const session = state.sessions.find((candidate) => candidate.tabs.some((tab) => tab.id === tabId))
    if (!session) return
    updateSession(session.id, (session) => {
      const tab = session.tabs.find((candidate) => candidate.id === tabId)!
      const updated = update(tab)
      if (updated === tab) return session
      return { ...session, tabs: session.tabs.map((candidate) => (candidate === tab ? updated : candidate)) }
    })
  }

  // The Session's focused Tab; absent for an unknown Session or one without Tabs.
  function focusedTabOf (sessionId: SessionId) {
    const session = findSession(sessionId)
    return session && focusedTab(session)
  }

  function updateFocusedTab (sessionId: SessionId, update: (tab: Tab) => Tab) {
    const tab = focusedTabOf(sessionId)
    if (tab) updateTab(tab.id, update)
  }

  function withFocusedPane (tab: Tab, paneId: PaneId): Tab {
    return paneId === tab.focusedPaneId ? tab : { ...tab, focusedPaneId: paneId }
  }

  function hasPane (tab: Tab, paneId: PaneId) {
    return tab.panes.some((pane) => pane.id === paneId)
  }

  function findSessionWithPane (paneId: PaneId) {
    return state.sessions.find((session) => session.tabs.some((tab) => hasPane(tab, paneId)))
  }

  function findPane (paneId: PaneId) {
    return panesIn(state).find((pane) => pane.id === paneId)
  }

  function focusPaneBy (sessionId: SessionId, offset: number) {
    updateFocusedTab(sessionId, (tab) => {
      const count = tab.panes.length
      const position = tab.panes.findIndex((pane) => pane.id === tab.focusedPaneId)
      return withFocusedPane(tab, tab.panes[(position + offset + count) % count].id)
    })
  }

  function focusedTabPosition (session: Session) {
    return session.tabs.findIndex((tab) => tab.id === session.focusedTabId)
  }

  // The last segment of a path, or "/" for the filesystem root.
  function folderName (directory: string) {
    return directory.split('/').filter(Boolean).at(-1) ?? '/'
  }

  // Runs the shell setting's program, so a change to it reaches only the Shells started after it.
  function startShell ({ id, workingDirectory }: Pane) {
    shellHost.start(id, { workingDirectory, shell: settings.shell })
  }

  // A new Pane whose Shell starts in `workingDirectory`.
  function openPane (workingDirectory: string): Pane {
    const pane = { id: nextId('pane'), workingDirectory }
    startShell(pane)
    return pane
  }

  // The Session's Panes with a fresh Shell each, in their working directories. Nothing that ran before runs again.
  function restartShells (session: Session): Session {
    return {
      ...session,
      tabs: session.tabs.map((tab) => ({
        ...tab,
        panes: tab.panes.map(({ runningProgram: _stopped, ...pane }) => {
          startShell(pane)
          return pane
        }),
      })),
    }
  }

  // Brings back the saved Sessions, starting Shells for the Open ones. New ids continue after the saved ones.
  function restore (saved: Snapshot) {
    lastId = Math.max(lastId, ...idsIn(saved.state).map((id) => Number(id.split('-').at(-1))))
    scrollback = saved.scrollback
    const sessions = saved.state.sessions.map((session) =>
      session.status === 'open' ? restartShells(session) : session
    )
    setState({ ...saved.state, sessions })
  }

  // The directory a new Tab or Pane starts in, given its Session's Root directory and the working directory of the Pane
  // it opens from.
  function resolveStartDirectory (setting: StartDirectory, rootDirectory: string | undefined, currentDirectory: string) {
    if (setting === 'home') return homeDirectory
    if (setting === 'root') return rootDirectory ?? currentDirectory
    return currentDirectory
  }

  function openTab (workingDirectory: string): Tab {
    const pane = openPane(workingDirectory)
    return { id: nextId('tab'), panes: [pane], layout: { type: 'pane', paneId: pane.id }, focusedPaneId: pane.id }
  }

  function focusTabBy (sessionId: SessionId, offset: number) {
    updateSession(sessionId, (session) => {
      const count = session.tabs.length
      if (count === 0) return session
      const position = focusedTabPosition(session)
      return { ...session, focusedTabId: session.tabs[(position + offset + count) % count].id }
    })
  }

  // The Pane's sibling fills its space; closing the last Pane closes its Tab, and closing the last Tab closes the Session.
  // When the focused Pane closes, the Pane nearest to it in that sibling is focused. When the focused Tab closes, the
  // Tab that takes its place is focused, or the new last Tab.
  function removePaneFromSession (paneId: PaneId) {
    const session = findSessionWithPane(paneId)
    if (!session) return
    const { [paneId]: _dropped, ...kept } = scrollback
    scrollback = kept
    const tabs = session.tabs.flatMap((tab): Tab[] => {
      if (!hasPane(tab, paneId)) return [tab]
      const layout = removePane(tab.layout, paneId)
      if (!layout) return []
      const focusedPaneId = tab.focusedPaneId === paneId ? successorOf(tab.layout, paneId)! : tab.focusedPaneId
      return [{ ...tab, panes: tab.panes.filter((pane) => pane.id !== paneId), layout, focusedPaneId }]
    })
    // Without its last Pane the Session holds no Shell left to stop.
    if (tabs.length === 0 && deletesOnClose(session)) return deleteSession({ ...session, tabs })
    updateSession(session.id, (session) => {
      if (tabs.length === 0) return { ...session, status: 'closed', tabs, focusedTabId: undefined }
      if (tabs.some((tab) => tab.id === session.focusedTabId)) return { ...session, tabs }
      const position = focusedTabPosition(session)
      return { ...session, tabs, focusedTabId: tabs[Math.min(position, tabs.length - 1)].id }
    })
    if (tabs.length > 0) return
    closeWindow(session.id)
  }

  // When the Session's window was the one on screen, another Open Session takes its place.
  function closeWindow (sessionId: SessionId) {
    emit({ type: 'closeWindow', sessionId })
    if (sessionId === state.currentSessionId) replaceCurrentSession()
  }

  function paneIdsOf (session: Session) {
    return session.tabs.flatMap((tab) => tab.panes.map((pane) => pane.id))
  }

  // Whether closing the Session deletes it rather than making it a Closed Session, as the setting says for Sessions with
  // neither a name nor a Root directory.
  function deletesOnClose (session: Session) {
    return (
      settings.sessionsWithoutNameOrRootOnClose === 'delete' && session.name === undefined && session.rootDirectory === undefined
    )
  }

  // Drops the Sessions from the state with their scrollback, answering whether the Current Session was among them. The
  // Current Session goes with them, so no state names a Session that no longer exists.
  function removeSessions (removed: Session[]) {
    const sessionIds = removed.map((session) => session.id)
    const paneIds = removed.flatMap(paneIdsOf)
    scrollback = Object.fromEntries(Object.entries(scrollback).filter(([paneId]) => !paneIds.includes(paneId)))
    const wasCurrent = state.currentSessionId !== undefined && sessionIds.includes(state.currentSessionId)
    setState({
      sessions: state.sessions.filter((session) => !sessionIds.includes(session.id)),
      currentSessionId: wasCurrent ? undefined : state.currentSessionId,
    })
    return wasCurrent
  }

  // Removes the Session, Open or Closed, for good, with its scrollback, stopping its Shells.
  function deleteSession (session: Session) {
    const wasCurrent = removeSessions([session])
    if (session.status !== 'open') return
    for (const paneId of paneIdsOf(session)) shellHost.stop(paneId)
    emit({ type: 'closeWindow', sessionId: session.id })
    if (wasCurrent) replaceCurrentSession()
  }

  // Quitting closes every Open Session, so the ones closing deletes go, along with the Closed ones it would have deleted,
  // e.g. those closed before the setting said so.
  function sessionsDeletedOnQuit () {
    return state.sessions.filter(deletesOnClose)
  }

  // After the Current Session closes, the most recently used Open Session takes its place; with none left, the app
  // hides.
  function replaceCurrentSession () {
    const next = mostRecentlyUsedOpenSession()
    if (next) return makeCurrent(next.id)
    setState({ ...state, currentSessionId: undefined })
    if (!appShown) return
    appShown = false
    emit({ type: 'hideApp' })
  }

  // The Open Session used last; absent with no Open Session.
  function mostRecentlyUsedOpenSession () {
    const open = state.sessions.filter((session) => session.status === 'open')
    return open.toSorted((a, b) => b.lastUsedAt - a.lastUsedAt)[0]
  }

  // Their windows and Shells go with the app, and a Current Session among them passes on to the most recently used Open
  // Session left without being shown.
  function deleteSessionsOnQuit () {
    if (!removeSessions(sessionsDeletedOnQuit())) return
    setState({ ...state, currentSessionId: mostRecentlyUsedOpenSession()?.id })
  }

  // With the Command Palette on its own, the only thing on screen, the app hides.
  function hideWithNoCurrentSession () {
    if (!appShown || state.currentSessionId !== undefined) return
    appShown = false
    emit({ type: 'hideApp' })
  }

  // The smallest label number no Unnamed Session holds, starting at 1.
  function freeLabelNumber () {
    const taken = new Set(state.sessions.map((session) => session.labelNumber))
    let number = 1
    while (taken.has(number)) number += 1
    return number
  }

  // The name, or when another Session holds it, the name with the smallest free number from 2, e.g. `api 2`.
  function uniqueName (name: string, sessionId: SessionId) {
    const taken = new Set(state.sessions.filter((session) => session.id !== sessionId).map((session) => session.name))
    if (!taken.has(name)) return name
    let number = 2
    while (taken.has(`${name} ${number}`)) number += 1
    return `${name} ${number}`
  }

  // The Session given the name, kept unique, freeing its label number.
  function withName ({ labelNumber: _freed, ...session }: Session, name: string): Session {
    return { ...session, name: uniqueName(name, session.id) }
  }

  function openSession (): Session {
    const now = clock.now()
    const tab = openTab(homeDirectory)
    return {
      id: nextId('session'),
      labelNumber: freeLabelNumber(),
      status: 'open',
      createdAt: now,
      lastUsedAt: now,
      tabs: [tab],
      focusedTabId: tab.id,
    }
  }

  // Named Sessions before Unnamed Sessions, each group in the cycle order setting's order. Alphabetically, Unnamed
  // Sessions go by label number.
  function compareInCycleOrder (a: Session, b: Session) {
    if ((a.name === undefined) !== (b.name === undefined)) return a.name === undefined ? 1 : -1
    if (settings.cycleOrder === 'recent') return b.lastUsedAt - a.lastUsedAt
    if (settings.cycleOrder === 'created') return a.createdAt - b.createdAt
    if (a.name !== undefined) return a.name.localeCompare(b.name!, undefined, { numeric: true })
    return a.labelNumber! - b.labelNumber!
  }

  function sessionsInCycleOrder () {
    return state.sessions.toSorted(compareInCycleOrder)
  }

  // Wraps a command so that it ends any run of cycle presses.
  function command<Args extends unknown[], Result> (run: (...args: Args) => Result) {
    return (...args: Args) => {
      cycleStreak = undefined
      return run(...args)
    }
  }

  // Makes the Session the Current Session, marking it as the most recently used, and swaps it in while the app is shown.
  function makeCurrent (sessionId: SessionId) {
    const now = clock.now()
    setState({
      ...state,
      currentSessionId: sessionId,
      sessions: state.sessions.map((session) => (session.id === sessionId ? { ...session, lastUsedAt: now } : session)),
    })
    if (appShown) emit({ type: 'showSession', sessionId })
  }

  // Consecutive presses keep the order from the first one, so that marking each Session as used on the way doesn't
  // re-sort the `recent` order under them. Each Session swapped in shows the Session Banner unless the setting is off.
  function focusSessionBy (offset: number) {
    const order = cycleStreak ?? sessionsInCycleOrder().map((session) => session.id)
    const open = order.filter((sessionId) => findSession(sessionId)?.status === 'open')
    if (open.length < 2) return
    const position = open.indexOf(state.currentSessionId!)
    const sessionId = open[(position + offset + open.length) % open.length]
    makeCurrent(sessionId)
    if (appShown && settings.sessionBanner) emit({ type: 'showSessionBanner', sessionId })
    cycleStreak = order
  }

  // Opens a new Session as the Current Session.
  function addSession () {
    const session = openSession()
    setState({ sessions: [...state.sessions, session], currentSessionId: session.id })
  }

  // The directory with the home directory shown as `~`.
  function displayDirectory (directory: string) {
    if (directory === homeDirectory) return '~'
    return directory.startsWith(`${homeDirectory}/`) ? `~${directory.slice(homeDirectory.length)}` : directory
  }

  // The Session's name, or an Unnamed Session's numbered placeholder label, e.g. `Session 1`.
  function shortLabelOf (session: Session) {
    return session.name ?? `Session ${session.labelNumber}`
  }

  function labelOf (session: Session) {
    if (session.name !== undefined) return session.name
    const tab = focusedTab(session)
    const directory = tab ? focusedPane(tab).workingDirectory : homeDirectory
    return `${shortLabelOf(session)} (${displayDirectory(directory)})`
  }

  // The Pane's running program, or its working directory's folder name while the Shell is idle.
  function paneTitle (pane: Pane) {
    return pane.runningProgram ?? folderName(pane.workingDirectory)
  }

  function titleOf (tab: Tab) {
    return tab.title ?? paneTitle(focusedPane(tab))
  }

  function clearTitle (tab: Tab): Tab {
    if (tab.title === undefined) return tab
    const { title: _cleared, ...cleared } = tab
    return cleared
  }

  function sessionResults (): PaletteResult[] {
    return sessionsInCycleOrder().map(sessionResult)
  }

  function sessionResult (session: Session): PaletteResult {
    return {
      type: 'session',
      sessionId: session.id,
      label: labelOf(session),
      closed: session.status === 'closed',
      current: session.id === state.currentSessionId,
    }
  }

  function openSessionsInCycleOrder () {
    return sessionsInCycleOrder().filter((session) => session.status === 'open')
  }

  // The Tabs a search scope covers, each with its Session, Session by Session in cycle order: every Open Session's, the
  // Current Session's, or the Current Tab alone.
  function tabsInScope (scope: TabSearchScope | PaneSearchScope) {
    return openSessionsInCycleOrder().flatMap((session) => {
      if (scope !== 'all' && session.id !== state.currentSessionId) return []
      const current = focusedTab(session)
      const tabs = scope === 'currentTab' ? (current ? [current] : []) : session.tabs
      return tabs.map((tab) => ({ session, tab }))
    })
  }

  // Whether the Tab is the Current Tab: the focused Tab of the Current Session.
  function isCurrentTab (session: Session, tab: Tab) {
    return session.id === state.currentSessionId && tab.id === session.focusedTabId
  }

  // Whether the Pane is the Current Pane: the focused Pane of the Current Tab.
  function isCurrentPane (session: Session, tab: Tab, pane: Pane) {
    return isCurrentTab(session, tab) && pane.id === tab.focusedPaneId
  }

  function tabResults (tabs = tabsInScope('all')): PaletteResult[] {
    return tabs.map(({ session, tab }) => ({
      type: 'tab' as const,
      tabId: tab.id,
      label: titleOf(tab),
      sessionLabel: labelOf(session),
      current: isCurrentTab(session, tab),
    }))
  }

  function paneResults (tabs = tabsInScope('all')): PaletteResult[] {
    return tabs.flatMap(({ session, tab }) =>
      tab.panes.map((pane) => ({
        type: 'pane' as const,
        paneId: pane.id,
        label: paneTitle(pane),
        workingDirectory: displayDirectory(pane.workingDirectory),
        sessionLabel: labelOf(session),
        current: isCurrentPane(session, tab, pane),
      }))
    )
  }

  // The Sessions that match the search, best first, the Open ones before the Closed ones unless the sessionSearchOrder
  // setting keeps them together.
  function searchSessions (search: string) {
    const found = searchResults(sessionResults(), search)
    if (settings.sessionSearchOrder === 'cycle') return found
    const isClosed = (result: PaletteResult) => result.type === 'session' && result.closed
    return [...found.filter((result) => !isClosed(result)), ...found.filter(isClosed)]
  }

  // What each prefix narrows the Command Palette to: the results that match the rest of the query, in the order they're
  // offered.
  const paletteScopes: Record<string, (search: string) => PaletteResult[]> = {
    'ss ': searchSessions,
    'tt ': (search) => searchResults(tabResults(tabsInScope(settings.tabSearchScope)), search),
    'pp ': (search) => searchResults(paneResults(tabsInScope(settings.paneSearchScope)), search),
  }

  // Every Session, each Open Session followed by its Tabs and each Tab by its Panes, then every app action, each at its
  // level.
  function nestedResults (): PaletteResult[] {
    return [
      ...sessionsInCycleOrder().flatMap((session) => [
        ...atLevel([sessionResult(session)], 0),
        ...(session.status === 'open' ? nestedUnder(session) : []),
      ]),
      ...atLevel(actionResults(), 0),
    ]
  }

  // An Open Session's Tabs at level 1, each followed by its Panes at level 2. A Session's only Tab is left out, its Panes
  // taking its place at level 1, and a Tab's only Pane is left out.
  function nestedUnder (session: Session): PaletteResult[] {
    const panesAt = (tab: Tab, level: PaletteLevel) =>
      tab.panes.length > 1 ? atLevel(paneResults([{ session, tab }]), level) : []
    if (session.tabs.length === 1) return panesAt(session.tabs[0], 1)
    return session.tabs.flatMap((tab) => [...atLevel(tabResults([{ session, tab }]), 1), ...panesAt(tab, 2)])
  }

  function atLevel (results: PaletteResult[], level: PaletteLevel): PaletteResult[] {
    return results.map((result) => ({ ...result, level }))
  }

  // The results that match the query, in the order they're offered.
  function searchPalette (query: string) {
    if (query === '' && settings.paletteNesting === 'nested') return nestedResults()
    const prefix = Object.keys(paletteScopes).find((candidate) => query.startsWith(candidate))
    if (prefix) return paletteScopes[prefix](query.slice(prefix.length))
    return searchResults([...sessionResults(), ...tabResults(), ...paneResults(), ...actionResults()], query)
  }

  function reopenSession (sessionId: SessionId) {
    if (findSession(sessionId)?.status !== 'closed') return
    updateSession(sessionId, (session) => {
      if (session.tabs.length > 0) return { ...restartShells(session), status: 'open' }
      // With no Pane to open from, a Tab that would start in its working directory starts at the Root directory or home.
      const { rootDirectory } = session
      const tab = openTab(resolveStartDirectory(settings.newTabDirectory, rootDirectory, rootDirectory ?? homeDirectory))
      return { ...session, status: 'open', tabs: [tab], focusedTabId: tab.id }
    })
    makeCurrent(sessionId)
  }

  // Makes the Session the Current Session, reopening it first when it's closed.
  function jumpToSession (sessionId: SessionId) {
    const session = findSession(sessionId)
    if (session?.status === 'closed') reopenSession(sessionId)
    else if (session) makeCurrent(sessionId)
  }

  // Fades the app in with the Current Session visible; while shown, making it current has already swapped it in.
  function showAppIfHidden () {
    if (appShown) return
    appShown = true
    emit({ type: 'showApp', sessionId: state.currentSessionId! })
  }

  // Makes the Tab's Session, when open, the Current Session with the Tab focused.
  function jumpToTab (tabId: TabId) {
    const session = state.sessions.find((candidate) => candidate.tabs.some((tab) => tab.id === tabId))
    if (session?.status !== 'open') return
    updateSession(session.id, (session) =>
      session.focusedTabId === tabId ? session : { ...session, focusedTabId: tabId }
    )
    makeCurrent(session.id)
  }

  // Makes the Pane's Session, when open, the Current Session with the Pane and its Tab focused.
  function jumpToPane (paneId: PaneId) {
    const session = findSessionWithPane(paneId)
    if (session?.status !== 'open') return
    const tab = session.tabs.find((candidate) => hasPane(candidate, paneId))!
    updateSession(session.id, (session) => ({
      ...session,
      tabs: session.tabs.map((candidate) => (candidate === tab ? withFocusedPane(tab, paneId) : candidate)),
    }))
    jumpToTab(tab.id)
  }

  // A result's label and, for a Tab or Pane, what places it: the Pane's working directory and the Session's label.
  function searchedText (result: PaletteResult) {
    if (result.type === 'tab') return `${result.label} ${result.sessionLabel}`
    if (result.type === 'pane') return `${result.label} ${result.workingDirectory} ${result.sessionLabel}`
    return result.label
  }

  // The results that match the search, best first, keeping their order on ties.
  function searchResults (results: PaletteResult[], search: string) {
    return results
      .map((result) => ({ result, score: fuzzyScore(search, searchedText(result)) }))
      .filter((scored) => scored.score !== undefined)
      .toSorted((a, b) => b.score! - a.score!)
      .map(({ result }) => result)
  }

  function actionResults (): PaletteResult[] {
    return Object.entries(paletteActionLabels).map(([action, label]) => ({
      type: 'action',
      action: action as PaletteAction,
      label,
    }))
  }

  // A stopped Shell can still report on its way out, and a Closed Session keeps its Panes as they were when it closed.
  shellHost.subscribe((event) => {
    if (findSessionWithPane(event.paneId)?.status !== 'open') return
    if (event.type === 'shellExited') removePaneFromSession(event.paneId)
    if (event.type === 'workingDirectoryChanged') {
      updatePane(event.paneId, (pane) => ({ ...pane, workingDirectory: event.workingDirectory }))
    }
    if (event.type === 'runningProgramChanged') {
      updatePane(event.paneId, (pane) => ({ ...pane, runningProgram: event.runningProgram }))
    }
  })

  // The app actions on the Current Session, by the core's own commands.
  const sessionActions: Record<
    Exclude<PaletteAction, 'newSession' | 'changeTheme' | 'changeMenuBarIcon' | 'openSettings' | 'quit'>,
    (sessionId: SessionId) => void
  > = {
    renameSession: (sessionId) => {
      const tab = focusedTabOf(sessionId)
      if (!tab) return
      const suggestion = uniqueName(folderName(focusedPane(tab).workingDirectory), sessionId)
      emit({ type: 'askSessionName', sessionId, suggestion })
    },
    setSessionRoot: (sessionId) => core.setSessionRoot(sessionId),
    clearSessionRoot: (sessionId) => core.clearSessionRoot(sessionId),
    closeSession: (sessionId) => core.closeSession(sessionId),
    deleteSession: (sessionId) => core.deleteRequested(sessionId),
    newTab: (sessionId) => core.newTab(sessionId),
    renameTab: (sessionId) => {
      const tab = focusedTabOf(sessionId)
      if (tab) emit({ type: 'askTabTitle', sessionId, tabId: tab.id, suggestion: titleOf(tab) })
    },
    clearTabTitle: (sessionId) => {
      const tab = focusedTabOf(sessionId)
      if (tab) core.clearTabTitle(tab.id)
    },
    splitPaneVertically: (sessionId) => core.splitPane(sessionId, 'vertical'),
    splitPaneHorizontally: (sessionId) => core.splitPane(sessionId, 'horizontal'),
    closePane: (sessionId) => core.closePane(sessionId),
    nextSession: () => core.focusNextSession(),
    previousSession: () => core.focusPreviousSession(),
    nextTab: (sessionId) => core.focusNextTab(sessionId),
    previousTab: (sessionId) => core.focusPreviousTab(sessionId),
    nextPane: (sessionId) => core.focusNextPane(sessionId),
    previousPane: (sessionId) => core.focusPreviousPane(sessionId),
    focusPaneLeft: (sessionId) => core.focusPaneInDirection(sessionId, 'left'),
    focusPaneRight: (sessionId) => core.focusPaneInDirection(sessionId, 'right'),
    focusPaneUp: (sessionId) => core.focusPaneInDirection(sessionId, 'up'),
    focusPaneDown: (sessionId) => core.focusPaneInDirection(sessionId, 'down'),
    findInPane: (sessionId) => {
      const tab = focusedTabOf(sessionId)
      if (tab) emit({ type: 'findInPane', sessionId, paneId: tab.focusedPaneId })
    },
    // The saved scrollback goes too, so Restore doesn't bring back what was cleared before the terminal reports again.
    clearScrollback: (sessionId) => {
      const tab = focusedTabOf(sessionId)
      if (!tab) return
      const { [tab.focusedPaneId]: _cleared, ...kept } = scrollback
      scrollback = kept
      save()
      emit({ type: 'clearScrollback', sessionId, paneId: tab.focusedPaneId })
    },
  }

  // Without a Session, only the actions that don't act on one run.
  function runAction (action: BoundAction, sessionId: SessionId | undefined) {
    if (action === 'newSession') return core.newSession()
    if (action === 'changeTheme' || action === 'changeMenuBarIcon') {
      const type = action === 'changeTheme' ? 'pickTheme' : 'pickMenuBarIcon'
      return emit(sessionId === undefined ? { type } : { type, sessionId })
    }
    if (action === 'openSettings') return emit({ type: 'openSettings' })
    if (action === 'quit') return core.quitRequested()
    if (sessionId === undefined) return
    if (action === 'openCommandPalette') return emit({ type: 'openPalette', sessionId })
    if (action === 'copy' || action === 'paste') return emit({ type: action, sessionId })
    if (action.startsWith('focusTab')) return core.focusTab(sessionId, Number(action.slice('focusTab'.length)) - 1)
    sessionActions[action as keyof typeof sessionActions](sessionId)
  }

  const core: Core = {
    start: command(({ atLogin }: { atLogin: boolean }) => {
      appShown = !atLogin || settings.loginLaunch === 'shown'
      const saved = stateStore.load()
      if (saved) restore(saved)
      // Started shown, the app needs a Session to show. Started hidden at login, it opens one for the Hotkey to show, or
      // leaves that to the Hotkey, as the setting says.
      const opensSession = appShown || settings.hiddenStartWithNoOpenSessions === 'new'
      if (opensSession && state.currentSessionId === undefined) addSession()
      return { shown: appShown }
    }),
    state: () => state,
    hotkeyPressed: command(() => {
      appShown = !appShown
      if (!appShown) return emit({ type: 'hideApp' })
      if (state.currentSessionId === undefined) {
        if (settings.hotkeyWithNoOpenSessions === 'palette') return emit({ type: 'showPalette' })
        addSession()
      }
      emit({ type: 'showApp', sessionId: state.currentSessionId! })
    }),
    paletteDismissed: command(() => {
      previewedTheme = undefined
      previewedMenuBarIcon = undefined
      applyThemeInEffect()
      applyMenuBarIconInEffect()
      hideWithNoCurrentSession()
    }),
    focusLost: command(() => {
      if (!appShown) return
      appShown = false
      emit({ type: 'hideApp' })
    }),
    quitRequested: command(() => {
      const sessionsToDelete = sessionsDeletedOnQuit().length
      emit(sessionsToDelete > 0 ? { type: 'confirmQuit', sessionsToDelete } : { type: 'confirmQuit' })
    }),
    quitCancelled: command(hideWithNoCurrentSession),
    quitConfirmed: command(() => {
      deleteSessionsOnQuit()
      stateStore.flush()
      emit({ type: 'quit' })
    }),
    configChanged: command((config) => {
      const parsed = parseConfig(config, themeNames())
      configReadable = parsed !== undefined
      if (!parsed) return emit({ type: 'configUnreadable' })
      configText = config
      takeSettings(parsed)
      if (parsed.rejected.length > 0) emit({ type: 'settingsRejected', settings: parsed.rejected })
      applyThemeInEffect()
      applyMenuBarIconInEffect()
    }),
    configUnreadable: command(() => {
      configReadable = false
      emit({ type: 'configUnreadable' })
    }),
    settings: () => settings,
    theme: () => appliedTheme,
    menuBarIcon: () => appliedMenuBarIcon,
    // The theme setting is read again against the Themes now loaded, so a Theme file that appears after the setting
    // named it takes effect, and one that goes takes the Default Theme's place. While the config file can't be read,
    // the settings stay as they are, a Theme chosen meanwhile included.
    themeFilesChanged: command((files) => {
      const loaded = loadThemes(files)
      themes = loaded.themes
      if (loaded.rejected.length > 0) emit({ type: 'themesRejected', rejected: loaded.rejected })
      if (configReadable) {
        const parsed = parseConfig(configText, themeNames())!
        if (parsed.rejected.includes('theme') && !themeSettingRejected) {
          emit({ type: 'settingsRejected', settings: ['theme'] })
        }
        takeSettings(parsed)
      }
      applyThemeInEffect()
    }),
    newSession: command(() => {
      addSession()
      emit({ type: 'showSession', sessionId: state.currentSessionId! })
    }),
    reopenSession: command(reopenSession),
    menuBarSessionChosen: command((sessionId) => {
      if (!findSession(sessionId)) return
      jumpToSession(sessionId)
      showAppIfHidden()
    }),
    menuBarActionChosen: command((action) => {
      if (action !== 'newSession') return runAction(action, undefined)
      addSession()
      if (appShown) return emit({ type: 'showSession', sessionId: state.currentSessionId! })
      appShown = true
      emit({ type: 'showApp', sessionId: state.currentSessionId! })
    }),
    renameSession: command((sessionId, name) => {
      const trimmed = name.trim()
      if (trimmed === '') return
      updateSession(sessionId, (session) => withName(session, trimmed))
    }),
    setSessionRoot: command((sessionId) => {
      updateSession(sessionId, (session) => {
        const tab = focusedTab(session)
        if (!tab) return session
        const rootDirectory = focusedPane(tab).workingDirectory
        if (session.name !== undefined) {
          return rootDirectory === session.rootDirectory ? session : { ...session, rootDirectory }
        }
        return withName({ ...session, rootDirectory }, folderName(rootDirectory))
      })
    }),
    clearSessionRoot: command((sessionId) => {
      updateSession(sessionId, (session) => {
        if (session.rootDirectory === undefined) return session
        const { rootDirectory: _cleared, ...cleared } = session
        return cleared
      })
    }),
    closeSession: command((sessionId) => {
      const session = findSession(sessionId)
      if (session?.status !== 'open') return
      if (deletesOnClose(session)) return deleteSession(session)
      updateSession(sessionId, (session) => ({ ...session, status: 'closed' }))
      for (const paneId of paneIdsOf(session)) shellHost.stop(paneId)
      closeWindow(sessionId)
    }),
    deleteRequested: command((sessionId) => {
      if (findSession(sessionId)) emit({ type: 'confirmDelete', sessionId })
    }),
    deleteConfirmed: command((sessionId) => {
      const session = findSession(sessionId)
      if (session) deleteSession(session)
    }),
    focusPreviousSession: () => focusSessionBy(-1),
    focusNextSession: () => focusSessionBy(1),
    newTab: command((sessionId) => {
      const session = findSession(sessionId)
      const current = session && focusedTab(session)
      if (!current) return
      const tab = openTab(
        resolveStartDirectory(settings.newTabDirectory, session.rootDirectory, focusedPane(current).workingDirectory)
      )
      updateSession(sessionId, (session) => ({ ...session, tabs: [...session.tabs, tab], focusedTabId: tab.id }))
    }),
    splitPane: command((sessionId, direction) => {
      const rootDirectory = findSession(sessionId)?.rootDirectory
      updateFocusedTab(sessionId, (tab) => {
        const current = focusedPane(tab)
        const pane = openPane(resolveStartDirectory(settings.splitPaneDirectory, rootDirectory, current.workingDirectory))
        return {
          ...tab,
          panes: tab.panes.flatMap((candidate) => (candidate === current ? [current, pane] : [candidate])),
          layout: replacePane(tab.layout, current.id, {
            type: 'split',
            direction,
            first: { type: 'pane', paneId: current.id },
            second: { type: 'pane', paneId: pane.id },
          }),
          focusedPaneId: pane.id,
        }
      })
    }),
    closePane: command((sessionId) => {
      const tab = focusedTabOf(sessionId)
      if (!tab) return
      removePaneFromSession(tab.focusedPaneId)
      shellHost.stop(tab.focusedPaneId)
    }),
    focusPreviousPane: command((sessionId) => focusPaneBy(sessionId, -1)),
    focusNextPane: command((sessionId) => focusPaneBy(sessionId, 1)),
    focusPaneInDirection: command((sessionId, direction) => {
      updateFocusedTab(sessionId, (tab) => {
        const neighbour = neighbourOf(tab.layout, tab.focusedPaneId, direction)
        return neighbour ? withFocusedPane(tab, neighbour) : tab
      })
    }),
    // Not a command itself, so that cycling Sessions by shortcut keeps its run of presses going.
    keyPressed (sessionId, keyPress) {
      const bound = Object.entries(settings.keyBindings).find(
        ([, shortcut]) => shortcut && matchesShortcut(keyPress, shortcut)
      )
      if (!bound) return false
      runAction(bound[0] as BoundAction, sessionId)
      return true
    },
    focusPane: command((paneId) => {
      const session = findSessionWithPane(paneId)
      if (!session) return
      updateSession(session.id, (session) => ({
        ...session,
        tabs: session.tabs.map((tab) => (hasPane(tab, paneId) ? withFocusedPane(tab, paneId) : tab)),
      }))
    }),
    focusTab: command((sessionId, position) => {
      updateSession(sessionId, (session) => {
        const tab = session.tabs[position]
        return tab && tab.id !== session.focusedTabId ? { ...session, focusedTabId: tab.id } : session
      })
    }),
    focusPreviousTab: command((sessionId) => focusTabBy(sessionId, -1)),
    focusNextTab: command((sessionId) => focusTabBy(sessionId, 1)),
    renameTab: command((tabId, title) => {
      const trimmed = title.trim()
      updateTab(tabId, (tab) => {
        if (trimmed === '') return clearTitle(tab)
        return trimmed === tab.title ? tab : { ...tab, title: trimmed }
      })
    }),
    clearTabTitle: command((tabId) => updateTab(tabId, clearTitle)),
    tabTitle (tabId) {
      const tab = findTab(tabId)
      return tab && titleOf(tab)
    },
    sessionLabel (sessionId) {
      const session = findSession(sessionId)
      return session && labelOf(session)
    },
    shortSessionLabel (sessionId) {
      const session = findSession(sessionId)
      return session && shortLabelOf(session)
    },
    sessionsInCycleOrder,
    menuBar () {
      const sessions = sessionsInCycleOrder()
      const withStatus = (status: Session['status']) =>
        sessions
          .filter((session) => session.status === status)
          .map((session) => ({ sessionId: session.id, label: labelOf(session) }))
      return {
        open: withStatus('open'),
        closed: withStatus('closed'),
        actions: menuBarActions.map((action) => ({ action, label: paletteActionLabels[action] })),
      }
    },
    paletteResults: searchPalette,
    previewTheme: command((name) => {
      if (!findTheme(name)) return
      previewedTheme = name
      applyThemeInEffect()
    }),
    themeResults (query) {
      const results = themes.map((theme): PaletteResult => ({ type: 'theme', name: theme.name, label: theme.name }))
      return searchResults(results, query)
    },
    previewMenuBarIcon: command((icon) => {
      if (!menuBarIcons.includes(icon)) return
      previewedMenuBarIcon = icon
      applyMenuBarIconInEffect()
    }),
    menuBarIconResults (query) {
      const results = menuBarIcons.map(
        (icon): PaletteResult => ({ type: 'menuBarIcon', icon, label: menuBarIconLabels[icon] })
      )
      return searchResults(results, query)
    },
    // The Command Palette on its own leaves nothing on screen after a choice that shows no Session, except while the
    // quit confirmation waits for an answer or the palette lists the Themes or the menu bar icons.
    choosePaletteResult: command((result) => {
      if (result.type === 'session') jumpToSession(result.sessionId)
      if (result.type === 'tab') jumpToTab(result.tabId)
      if (result.type === 'pane') jumpToPane(result.paneId)
      if (result.type === 'action') runAction(result.action, state.currentSessionId)
      if (result.type === 'theme') chooseTheme(result.name)
      if (result.type === 'menuBarIcon') chooseMenuBarIcon(result.icon)
      const keepsPaletteBusy = ['quit', 'changeTheme', 'changeMenuBarIcon']
      if (!(result.type === 'action' && keepsPaletteBusy.includes(result.action))) {
        hideWithNoCurrentSession()
      }
    }),
    paneRects (tabId) {
      const tab = findTab(tabId)
      return tab ? paneRects(tab.layout) : []
    },
    scrollbackChanged (paneId, reported) {
      if (!findSessionWithPane(paneId)) return
      const text = capScrollback(reported, settings.scrollbackLines)
      scrollback = { ...scrollback, [paneId]: { text, savedAt: clock.now() } }
      save()
    },
    scrollback: (paneId) => scrollback[paneId],
    linkTarget (paneId, text) {
      const pane = findPane(paneId)
      return pane && linkTarget(text, pane.workingDirectory, homeDirectory)
    },
    onEffect (listener) {
      effectListeners.push(listener)
    },
    onStateChange (listener) {
      stateListeners.push(listener)
    },
  }
  return core
}
