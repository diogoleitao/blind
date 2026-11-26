import type { ActivitySidebarRow } from './activity-sidebar'
import { type ProgramStatusReport, replaces, wantsTheUser } from './attention'
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
  type ActivitySound,
  activitySounds,
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
import type {
  Build,
  Clock,
  PaneReport,
  SavedScrollback,
  ShellEvent,
  ShellFromBefore,
  ShellHost,
  Snapshot,
  StateStore,
} from './ports'
import { capScrollback } from './scrollback'
import {
  importTheme,
  type ReadyThemeImport,
  type ThemeImport,
  type ThemeImportTarget,
  themeImportTargetFor,
  type ThemeSource,
} from './theme-import'
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

// A program running in a Session's Panes, by the name it gives itself, and how many of the Panes it runs in.
export interface RunningProgram {
  program: string;
  count: number;
}

// A Session the quit confirmation names, by its label, with the programs quitting ends in it.
export interface QuitSession {
  label: string;
  programs: RunningProgram[];
}

export type Effect =
  | { type: 'closeWindow'; sessionId: SessionId }
  // Fades the app in with the Session visible.
  | { type: 'showApp'; sessionId: SessionId }
  // Opens the Command Palette over the Session's window.
  | { type: 'openPalette'; sessionId: SessionId }
  // Opens the Activity Sidebar over the Session's window, or closes it there.
  | { type: 'toggleActivitySidebar'; sessionId: SessionId }
  | { type: 'hideApp' }
  // Makes the Session the visible one in place of the Session shown before, without a fade.
  | { type: 'showSession'; sessionId: SessionId }
  // Shows the Session Banner over the Session's window, which cycling has just swapped in.
  | { type: 'showSessionBanner'; sessionId: SessionId }
  // Asks the user whether to quit, or to restart, which quits and starts Blind again, over the Current Session's window,
  // shown first; answered with `quitConfirmed`, passing `endShells` on. It names, each by its label with the programs
  // quitting ends in it, the Sessions quitting deletes; while quitting ends the Shells, the Closed Sessions running
  // programs; and for Quit and End Shells, every Session running programs. Each list is left out when it names none.
  | {
    type: 'confirmQuit';
    restart?: true;
    endShells?: true;
    deleted?: QuitSession[];
    runningClosed?: QuitSession[];
    running?: QuitSession[];
  }
  // Quitting needs no confirmation: the terminals' scrollback is taken first, then `quitConfirmed` is called, passing
  // `endShells` on.
  | { type: 'saveForQuit'; endShells?: true }
  // Every Shell ended at once, as whatever held them went, and fresh Shells took their places in the Open Sessions.
  | { type: 'shellsLost' }
  // Asks the user for the Session's name, offering `suggestion`, answered with `renameSession`.
  | { type: 'askSessionName'; sessionId: SessionId; suggestion: string }
  // Asks the user whether to delete the Session, answered with `deleteConfirmed`, naming the programs deleting ends, if
  // any.
  | { type: 'confirmDelete'; sessionId: SessionId; programs?: RunningProgram[] }
  // Asks the user whether to close the Pane, naming the program closing it ends, answered with `closePaneConfirmed`.
  | { type: 'confirmClosePane'; paneId: PaneId; program: string }
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
  // Plays the sound, for a Pane gaining Activity or for the Command Palette's selection moving to it.
  | { type: 'playActivitySound'; sound: ActivitySound }
  // Replaces the config file's text, e.g. to set the theme setting to the Theme chosen in the Command Palette.
  | { type: 'writeConfig'; text: string }
  // Has the Command Palette list the Themes over the Session's window.
  | { type: 'pickTheme'; sessionId: SessionId }
  // Has the Command Palette list the menu bar icons, like `pickTheme`.
  | { type: 'pickMenuBarIcon'; sessionId: SessionId }
  // Has the Command Palette list the Activity sounds, like `pickTheme`.
  | { type: 'pickActivitySound'; sessionId: SessionId }
  // Has the Command Palette list the Build, like `pickTheme`.
  | { type: 'pickBuild'; sessionId: SessionId }
  // Asks for the file to Import a Theme from, over the Session's window.
  | { type: 'pickThemeImport'; sessionId: SessionId }
  // Has the Command Palette show the Theme file a picked file makes, to be saved, or why the Import was refused.
  | { type: 'showThemeImport'; sessionId: SessionId; themeImport: ThemeImport }
  // Writes a new Theme file to the themes folder, never over one already there.
  | { type: 'writeThemeFile'; fileName: string; text: string }
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
  // Puts the text on the clipboard, showing the Copy Banner over the Session's window.
  | { type: 'copyToClipboard'; sessionId: SessionId; text: string }
  // Forgets where the user dragged the Command Palette, so it next opens where it starts.
  | { type: 'resetPalettePosition' }

// Every app action, in the order the Command Palette offers them, by its label.
export const paletteActionLabels = {
  newSession: 'New Session',
  renameSession: 'Rename Session',
  setSessionRoot: 'Set Session Root',
  clearSessionRoot: 'Clear Session Root',
  closeSession: 'Close Session',
  deleteSession: 'Delete Session',
  newTab: 'New Tab',
  renameTab: 'Rename Tab',
  clearTabTitle: 'Clear Tab Title',
  hideTab: 'Hide Tab',
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
  toggleActivitySidebar: 'Toggle Activity Sidebar',
  findInPane: 'Find in Pane',
  clearScrollback: 'Clear Scrollback',
  changeTheme: 'Change Theme',
  importTheme: 'Import Theme',
  changeMenuBarIcon: 'Change Menu Bar Icon',
  changeActivitySound: 'Change Activity Sound',
  resetCommandPalettePosition: 'Reset Command Palette Position',
  openSettings: 'Open Settings',
  showBuild: 'Show Build',
  quit: 'Quit Blind',
  quitAndEndShells: 'Quit and End Shells',
} as const

export type PaletteAction = keyof typeof paletteActionLabels

// How deep a result sits in the Command Palette's nested view: 0 at the top, 1 under a Session, 2 under a Tab.
export type PaletteLevel = 0 | 1 | 2

// The mark the Command Palette shows before a Session's, Tab's or Pane's name, by its kind.
const kindMarkers = { session: 'Ⓢ', tab: 'Ⓣ', pane: 'Ⓟ' } as const

export type KindMarker = (typeof kindMarkers)[keyof typeof kindMarkers]

// One entry the Command Palette offers. `current` marks the Current Session, Current Tab or Current Pane, where the
// user already is, which the Command Palette lists and lets the user select but not choose. `activity` marks a Session,
// Tab or Pane with Activity. `hiddenTab` marks a Hidden Tab and its Panes. `level` is set in the nested view alone.
// `marker` is set while the commandPalette.kindMarkers setting shows them.
export type PaletteResult =
  | {
    type: 'session';
    sessionId: SessionId;
    label: string;
    closed: boolean;
    current: boolean;
    activity: boolean;
    level?: PaletteLevel;
    marker?: KindMarker;
  }
  | {
    type: 'tab';
    tabId: TabId;
    label: string;
    sessionLabel: string;
    current: boolean;
    activity: boolean;
    hiddenTab?: true;
    level?: PaletteLevel;
    marker?: KindMarker;
  }
  | {
    type: 'pane';
    paneId: PaneId;
    label: string;
    workingDirectory: string;
    sessionLabel: string;
    current: boolean;
    activity: boolean;
    hiddenTab?: true;
    level?: PaletteLevel;
    marker?: KindMarker;
  }
  | { type: 'action'; action: PaletteAction; label: string; level?: PaletteLevel }
  // A Theme, labelled with its name.
  | { type: 'theme'; name: string; label: string }
  | { type: 'menuBarIcon'; icon: MenuBarIcon; label: string }
  // An Activity sound, labelled with its name.
  | { type: 'activitySound'; sound: ActivitySound; label: string }
  // A part of a Build, e.g. `Commit: 45e9d74`, with what choosing it copies.
  | { type: 'build'; label: string; copies: string }

const menuBarIconLabels: Record<MenuBarIcon, string> = {
  monochrome: 'Monochrome',
  colour: 'Colour',
}

// The app actions the menu bar icon's menu offers after the Sessions, in order.
const menuBarActions = ['newSession', 'openSettings', 'quit', 'quitAndEndShells'] as const satisfies PaletteAction[]

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

// Why a Pane has Activity: a notification, or its program's status records in a state that wants the user, by id; and
// where its gaining Activity falls among every Pane's, counting up.
interface PaneActivity {
  notified: boolean;
  records: string[];
  gainOrder: number;
}

// How many other Sessions a Session's Tab bar names by their Activity before it only says there are more.
const maximumActivityChips = 3

// The running program Claude Code shows as: it names its process `claude`, unless told not to set titles at all.
const claudeCodeProgram = 'claude'

// Claude Code starts its title with `✳`, or with `◐` and `◑` in turn while it works, which say nothing of the title.
function withoutStatusGlyph (title: string) {
  return title.replace(/^[✳◐◑] /u, '')
}

// A commit's SHA as git abbreviates it, e.g. `45e9d74`.
function shortSha (commit: string) {
  return commit.slice(0, 7)
}

export interface CoreDependencies {
  shellHost: ShellHost;
  stateStore: StateStore;
  clock: Clock;
  homeDirectory: string;
  // The app's own Build.
  build: Build;
}

export interface Core {
  // The Login Launch starts hidden or shown as the loginLaunch.start setting says; started hidden, the app stays off
  // screen until the Hotkey shows it. Answers whether the app started shown.
  start(options: { atLogin: boolean }): { shown: boolean };
  state(): CoreState;
  // With no Open Sessions, opens a new Session and shows it.
  hotkeyPressed(): void;
  // The Command Palette closed without a choice, ending any Theme preview and cancelling any Import it showed.
  paletteDismissed(): void;
  // Blind stopped being the active app, e.g. because another app was clicked.
  focusLost(): void;
  // Quitting asks for confirmation first when it deletes Sessions, or, while it ends the Shells, when Closed Sessions run
  // programs.
  quitRequested(): void;
  // Quits and ends every Shell, asking first when programs are running or Sessions are deleted.
  quitAndEndShellsRequested(): void;
  // Asked from outside, e.g. after a new copy of Blind is installed, so always confirmed, as quitting is.
  restartRequested(): void;
  // Deletes the Sessions quitting deletes and saves. The Shells run on unless `endShells` says, which defaults to what
  // the shell.onQuit setting says, e.g. when the app is told to stop.
  quitConfirmed(options?: { endShells?: boolean }): void;
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
  // The file picked to Import a Theme from, over the Session's window.
  themeImportPicked(sessionId: SessionId, source: ThemeSource): void;
  // Saves the Theme file the Command Palette shows. It joins the Themes once the themes folder is read again, and
  // changes neither the Theme in effect nor the theme setting.
  themeImportSaved(): void;
  // The menu bar icons the Command Palette offers for a query, monochrome first.
  menuBarIconResults(query: string): PaletteResult[];
  // Like `previewTheme`, for the menu bar icon.
  previewMenuBarIcon(icon: MenuBarIcon): void;
  // The Activity sounds the Command Palette offers for a query, by name.
  activitySoundResults(query: string): PaletteResult[];
  // Plays the Activity sound the Command Palette's selection moved to, whatever the activity.ring setting says.
  previewActivitySound(sound: ActivitySound): void;
  // What the Command Palette lists for the Build, for a query: the app's version and commit, then Blind Spot's when its
  // commit differs. A Blind Spot that reports no Build adds nothing, as there would be nothing to copy.
  buildResults(query: string): PaletteResult[];
  // Opens an Unnamed Session with one Tab at the home directory and makes it the Current Session.
  newSession(): void;
  // Opens a Closed Session again as the Current Session, restoring it as Restore does. One closed through its last Tab
  // gets a fresh Tab at the home directory when the tab.startDirectory setting is home, and otherwise at its Root
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
  // Opens a Tab after the others and focuses it, in the directory the tab.startDirectory setting picks.
  newTab(sessionId: SessionId): void;
  // Focuses the shown Tab at a zero-based position among the shown Tabs, if there is one.
  focusTab(sessionId: SessionId, position: number): void;
  // Both wrap around between the first and last shown Tab, passing over the Hidden Tabs.
  focusPreviousTab(sessionId: SessionId): void;
  focusNextTab(sessionId: SessionId): void;
  // Fixes the Tab's title until it's cleared; a blank title clears it.
  renameTab(tabId: TabId, title: string): void;
  // The Tab's title follows its focused Pane again.
  clearTabTitle(tabId: TabId): void;
  // Makes the Session's focused Tab a Hidden Tab, focusing the shown Tab that takes its place, or the new last shown
  // Tab. The Session's only shown Tab stays shown.
  hideTab(sessionId: SessionId): void;
  // Splits the focused Pane in two, starting the new half's Shell in the directory the pane.startDirectory setting
  // picks, and focuses it.
  splitPane(sessionId: SessionId, direction: SplitDirection): void;
  // Closes the focused Pane and stops its Shell, following the same chain as the Shell exiting. A Pane whose Shell runs a
  // program asks for confirmation first.
  closePane(sessionId: SessionId): void;
  // Closes the Pane and stops its Shell, as `closePane` does without asking.
  closePaneConfirmed(paneId: PaneId): void;
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
  // Closed Session first; or runs an app action on the Current Session; or copies what a part of the Build holds.
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
  // A program in the Pane sent a desktop notification, OSC 9, 99 or 777, raising Activity on it.
  notificationReceived(paneId: PaneId): void;
  // A program in the Pane reported one of its status records, OSC 7501: one blocked, done or in error raises Activity on
  // the Pane.
  programStatusReported(paneId: PaneId, report: ProgramStatusReport): void;
  // Whether any of the Tab's Panes has Activity.
  tabHasActivity(tabId: TabId): boolean;
  // How many of the Session's Hidden Tabs have Activity, which the Tab bar shows after its shown Tabs while there are any.
  hiddenTabsWithActivity(sessionId: SessionId): number;
  // What the Session's Tab bar shows after its label: the other Sessions with Activity in cycle order, by their Tab bar
  // labels, up to three of them; past three, a single `3+`.
  activityChips(sessionId: SessionId): string[];
  // What the Activity Sidebar lists: the Panes with Activity across every Open Session, under their Sessions.
  activitySidebarRows(): ActivitySidebarRow[];
  // Jumps to the Pane a row of the Activity Sidebar stands for, as the Command Palette does, clearing its Activity.
  activitySidebarPaneChosen(paneId: PaneId): void;
  onEffect(listener: (effect: Effect) => void): void;
  onStateChange(listener: (state: CoreState) => void): void;
}

export function createCore ({ shellHost, stateStore, clock, homeDirectory, build }: CoreDependencies): Core {
  let state: CoreState = { sessions: [] }
  // Kept out of the state: terminals report it far more often than anything else changes.
  let scrollback: Record<PaneId, SavedScrollback> = {}
  // Whether the app is on screen. Not part of the snapshot: it says nothing about Sessions.
  let appShown = true
  // The Panes with Activity. Not part of the snapshot: Restore brings back none.
  let activity: Record<PaneId, PaneActivity> = {}
  // How many times a Pane has gained Activity, which orders the Activity Sidebar: a count rather than the clock's time,
  // so two gains never tie.
  let activityGains = 0
  // The Panes whose Shell is running: started, or kept running from before the app last quit, and neither stopped nor
  // exited. Not part of the snapshot: the ShellHost says which Shells outlived the app.
  const runningShells = new Set<PaneId>()
  // Set while the app, launching, takes what its Panes reported while it was gone.
  let takingMissedReports = false
  let settings: Settings = defaultSettings
  // The config file's text the settings were last read from, read again when the Themes change.
  let configText: string | undefined
  // Whether the config file read as it is now, so that it's written only over text the settings came from.
  let configReadable = true
  // Whether the theme setting names no Theme loaded, so the user hears of it once.
  let themeSettingRejected = false
  let themes: Theme[] = builtInThemes
  // What an Import checks a new Theme file against: the Themes, and the themes folder's files as last read.
  let themeImportTarget: ThemeImportTarget = {
    themeNames: builtInThemes.map((theme) => theme.name),
    fileNamesByTheme: {},
    fileNames: [],
  }
  // The Theme the windows were last told to follow.
  let appliedTheme = defaultTheme
  // The name of the Theme browsed to in the Command Palette, in effect until the palette closes; absent otherwise.
  let previewedTheme: string | undefined
  // The Theme file an Import shows in the Command Palette, to be saved; absent otherwise.
  let themeImportToSave: ReadyThemeImport | undefined
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

  // Sets the setting, or the setting in a group, in the config file too, unless the file can't be read as it is now.
  function writeSetting<Group extends keyof Settings> (
    name: keyof Settings | readonly [group: Group, name: keyof Settings[Group] & string],
    value: string
  ) {
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

  // Sets the activity.sound setting to the sound chosen.
  function chooseActivitySound (sound: ActivitySound) {
    settings = { ...settings, activity: { ...settings.activity, sound } }
    writeSetting(['activity', 'sound'], sound)
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
    dropSettledActivity()
    save()
    for (const listener of stateListeners) listener(state)
  }

  // Tells the state listeners, as a change of state does, without saving: Activity isn't part of the snapshot.
  function setActivity (next: Record<PaneId, PaneActivity>) {
    activity = next
    for (const listener of stateListeners) listener(state)
  }

  function tabHasActivity (tab: Tab) {
    return tab.panes.some((pane) => pane.id in activity)
  }

  // A Closed Session's Activity shows only in the Activity Sidebar, so nothing marks the Session itself.
  function sessionShowsActivity (session: Session) {
    return session.status === 'open' && session.tabs.some(tabHasActivity)
  }

  // The Sessions with Activity among `sessions`, each with its Tabs with Activity and their Panes with it, each list
  // ordered by when its Panes gained Activity, latest first.
  function sessionsByActivity (sessions: Session[]) {
    const latestFirst = <Item extends { gainOrder: number }>(items: Item[]) =>
      items.toSorted((a, b) => b.gainOrder - a.gainOrder)
    const withTabs = sessions.map((session) => {
      const tabs = session.tabs.map((tab) => {
        const panes = latestFirst(
          tab.panes.filter((pane) => pane.id in activity).map((pane) => ({ pane, gainOrder: activity[pane.id].gainOrder }))
        )
        return { tab, panes: panes.map(({ pane }) => pane), gainOrder: panes[0]?.gainOrder ?? 0 }
      })
      const withActivity = latestFirst(tabs.filter(({ panes }) => panes.length > 0))
      return { session, tabs: withActivity, gainOrder: withActivity[0]?.gainOrder ?? 0 }
    })
    return latestFirst(withTabs.filter(({ tabs }) => tabs.length > 0))
  }

  // The Open Sessions with Activity under one group heading, then the Closed Sessions with Activity under another, each
  // heading left out while its group has no Session.
  function activitySidebarRows (): ActivitySidebarRow[] {
    const groups = [
      { label: 'Open Sessions', status: 'open' },
      { label: 'Closed Sessions', status: 'closed' },
    ] as const
    return groups.flatMap(({ label, status }) => {
      const rows = sessionRowsByActivity(sessionsInCycleOrder().filter((session) => session.status === status))
      return rows.length === 0 ? [] : [{ label, level: 0, group: true } as const, ...rows]
    })
  }

  // A Session with Activity is a heading, its Tabs with Activity under it only while there are two or more, and a Tab's
  // Panes with Activity under it only while there are two or more. A Tab with one such Pane stands for it, under the
  // Tab's title, as does a Session's only row.
  function sessionRowsByActivity (sessions: Session[]): ActivitySidebarRow[] {
    return sessionsByActivity(sessions).flatMap(({ session, tabs }) => {
      const tabLevel = tabs.length > 1
      return [
        { label: labelOf(session), level: 0 } as const,
        ...tabs.flatMap(({ tab, panes }): ActivitySidebarRow[] => {
          const mark = hiddenTabMark(tab)
          if (panes.length === 1) return [{ label: titleOf(tab), level: 1, paneId: panes[0].id, ...mark }]
          const paneRows = panes.map(
            (pane) => ({ label: paneTitle(pane), level: tabLevel ? 2 : 1, paneId: pane.id, ...mark }) as const
          )
          return tabLevel ? [{ label: titleOf(tab), level: 1, ...mark }, ...paneRows] : paneRows
        }),
      ]
    })
  }

  // Only a Pane whose Shell is running, in an Open or a Closed Session, and that isn't the Current Pane gets Activity: a
  // stopped Shell can still report on its way out.
  function canRaiseActivity (paneId: PaneId) {
    return runningShells.has(paneId) && findSessionWithPane(paneId) !== undefined && paneId !== currentPaneId()
  }

  // A Pane left with no reason for Activity has none. A Pane gaining Activity plays the Activity sound.
  function updatePaneActivity (paneId: PaneId, update: (pane: PaneActivity) => PaneActivity) {
    const current = activity[paneId] ?? { notified: false, records: [], gainOrder: 0 }
    const updated = update(current)
    if (updated === current) return
    const { [paneId]: _replaced, ...others } = activity
    const hasActivity = updated.notified || updated.records.length > 0
    const gained = hasActivity && !(paneId in activity)
    if (gained) activityGains += 1
    setActivity(hasActivity ? { ...others, [paneId]: gained ? { ...updated, gainOrder: activityGains } : updated } : others)
    if (gained && ringsNow()) emit({ type: 'playActivitySound', sound: settings.activity.sound })
  }

  // Whether the activity.ring setting lets a Pane gaining Activity play the Activity sound now. Activity gained while the
  // app was gone, taken as it launches, plays none.
  function ringsNow () {
    const { ring } = settings.activity
    return !takingMissedReports && (ring === 'always' || (ring === 'whileHidden' && !appShown))
  }

  // The Current Pane's Activity clears as it becomes the Current Pane, and a Pane's goes when it closes or its Session is
  // deleted. Closing its Session keeps it.
  function dropSettledActivity () {
    const currentPane = currentPaneId()
    const panes = new Set(state.sessions.flatMap(paneIdsOf))
    const kept = Object.entries(activity).filter(([paneId]) => paneId !== currentPane && panes.has(paneId))
    if (kept.length < Object.keys(activity).length) activity = Object.fromEntries(kept)
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

  // The Tabs the Tab bar shows: every Tab but the Hidden Tabs, in order.
  function shownTabs (tabs: Tab[]) {
    return tabs.filter((tab) => !tab.hidden)
  }

  // The shown Tab among the Session's new `tabs` that takes the place of its focused Tab, which closed or was hidden: the
  // one at its position among the shown Tabs, or the new last shown Tab. Absent with no shown Tab left.
  function shownTabTakingPlace (session: Session, tabs: Tab[]) {
    const shown = shownTabs(tabs)
    const position = shownTabs(session.tabs).findIndex((tab) => tab.id === session.focusedTabId)
    return shown[Math.min(position, shown.length - 1)]
  }

  function withTabReplaced (tabs: Tab[], tab: Tab, replacement: Tab) {
    return tabs.map((candidate) => (candidate === tab ? replacement : candidate))
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
    shellHost.start(id, { workingDirectory, shell: settings.shell.program })
    runningShells.add(id)
  }

  function stopShell (paneId: PaneId) {
    shellHost.stop(paneId)
    runningShells.delete(paneId)
  }

  // A new Pane whose Shell starts in `workingDirectory`.
  function openPane (workingDirectory: string): Pane {
    const pane = { id: nextId('pane'), workingDirectory }
    startShell(pane)
    return pane
  }

  // The Session's Panes whose Shell isn't running with a fresh Shell each, in their working directories. Nothing that
  // ran before in them runs again; a Shell still running is left as it is.
  function restartShells (session: Session): Session {
    return {
      ...session,
      tabs: session.tabs.map((tab) => ({
        ...tab,
        panes: tab.panes.map((pane) => {
          if (runningShells.has(pane.id)) return pane
          const { runningProgram: _stopped, programTitle: _gone, ...fresh } = pane
          startShell(fresh)
          return fresh
        }),
      })),
    }
  }

  // Brings back the saved Sessions, starting Shells for the Open ones' Panes whose Shells didn't run on since the app
  // quit, once what the Shells from before reported meanwhile is taken, so a fresh Shell starts where the one before it
  // last was. New ids continue after the saved ones. A Pane's scrollback saved while the app was gone replaces an older
  // one the app saved.
  function restore (saved: Snapshot) {
    lastId = Math.max(lastId, ...idsIn(saved.state).map((id) => Number(id.split('-').at(-1))))
    scrollback = { ...saved.scrollback }
    for (const [paneId, savedMeanwhile] of Object.entries(shellHost.savedScrollback())) {
      if (savedMeanwhile.savedAt <= (scrollback[paneId]?.savedAt ?? -Infinity)) continue
      scrollback[paneId] = { ...savedMeanwhile, text: capScrollback(savedMeanwhile.text, settings.pane.scrollbackLines) }
    }
    setState(saved.state)
    const savedPanes = new Set(panesIn(saved.state).map((pane) => pane.id))
    const fromBefore = shellHost.shellsFromBefore().filter(({ paneId }) => savedPanes.has(paneId))
    for (const { paneId } of fromBefore) runningShells.add(paneId)
    takeMissedReports(fromBefore)
    for (const { paneId, exited } of fromBefore) if (exited) runningShells.delete(paneId)
    setState({
      ...state,
      sessions: state.sessions.map((session) => (session.status === 'open' ? restartShells(session) : session)),
    })
  }

  // In order, Activity raised with no sound.
  function takeMissedReports (fromBefore: ShellFromBefore[]) {
    takingMissedReports = true
    for (const { missed } of fromBefore) missed.forEach(paneReported)
    takingMissedReports = false
  }

  // Shells still running from before the app quit that no saved Pane has are ended, having nowhere to show.
  function endShellsWithNoPane () {
    for (const { paneId, exited } of shellHost.shellsFromBefore()) {
      if (!exited && !runningShells.has(paneId)) shellHost.stop(paneId)
    }
  }

  function paneReported (report: PaneReport) {
    if (report.type === 'notification') return core.notificationReceived(report.paneId)
    if (report.type === 'programStatus') return core.programStatusReported(report.paneId, report.report)
    shellEventReceived(report)
  }

  // Whatever held the Shells is gone, and every Shell with it. Every Pane stays: the Open Sessions' get fresh Shells,
  // and the Closed Sessions' get theirs when they're opened again.
  function shellsLost () {
    runningShells.clear()
    setState({
      ...state,
      sessions: state.sessions.map((session) => (session.status === 'open' ? restartShells(session) : session)),
    })
    emit({ type: 'shellsLost' })
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

  // Moves through the shown Tabs, passing over the Hidden Tabs.
  function focusTabBy (sessionId: SessionId, offset: number) {
    updateSession(sessionId, (session) => {
      const shown = shownTabs(session.tabs)
      const count = shown.length
      if (count === 0) return session
      const position = shown.findIndex((tab) => tab.id === session.focusedTabId)
      return { ...session, focusedTabId: shown[(position + offset + count) % count].id }
    })
  }

  // The Pane's sibling fills its space; closing the last Pane closes its Tab, and closing the last Tab closes the Session.
  // When the focused Pane closes, the Pane nearest to it in that sibling is focused. When the focused Tab closes, the
  // shown Tab that takes its place is focused, or the new last shown Tab; with only Hidden Tabs left, the one that takes
  // its place is shown again and focused.
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
      const next = shownTabTakingPlace(session, tabs)
      if (next) return { ...session, tabs, focusedTabId: next.id }
      const hidden = tabs[Math.min(focusedTabPosition(session), tabs.length - 1)]
      return { ...withTabShown({ ...session, tabs }, hidden.id), focusedTabId: hidden.id }
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

  // The program the Pane's Shell runs, if its Shell is still running. A Shell idle at its prompt runs none.
  function programRunningIn (pane: Pane) {
    return runningShells.has(pane.id) ? pane.runningProgram : undefined
  }

  // The programs running in the Session's Panes, Hidden Tabs' included, each once in the order of the Panes it first runs
  // in.
  function programsOf (session: Session): RunningProgram[] {
    const counts = new Map<string, number>()
    for (const pane of session.tabs.flatMap((tab) => tab.panes)) {
      const program = programRunningIn(pane)
      if (program !== undefined) counts.set(program, (counts.get(program) ?? 0) + 1)
    }
    return [...counts].map(([program, count]) => ({ program, count }))
  }

  // Removes the Pane from its Tab and stops its Shell, following the same chain as the Shell exiting.
  function closePaneNow (paneId: PaneId) {
    removePaneFromSession(paneId)
    stopShell(paneId)
  }

  // Whether closing the Session deletes it rather than making it a Closed Session, as the setting says for Sessions with
  // neither a name nor a Root directory.
  function deletesOnClose (session: Session) {
    return (
      settings.session.withoutNameOrRootOnClose === 'delete' && session.name === undefined && session.rootDirectory === undefined
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
    for (const paneId of paneIdsOf(session)) {
      if (runningShells.has(paneId)) stopShell(paneId)
    }
    if (session.status !== 'open') return
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

  // Their windows go with the app, and their Shells end; a Current Session among them passes on to the most recently
  // used Open Session left without being shown.
  function deleteSessionsOnQuit () {
    const deleted = sessionsDeletedOnQuit()
    const wasCurrent = removeSessions(deleted)
    for (const paneId of deleted.flatMap(paneIdsOf)) {
      if (runningShells.has(paneId)) stopShell(paneId)
    }
    if (wasCurrent) setState({ ...state, currentSessionId: mostRecentlyUsedOpenSession()?.id })
  }

  // Asks whether to quit, or to restart, when there's something to tell first, naming each Session by its label in
  // cycle order with the programs quitting ends in it: the Sessions quitting deletes, and the Sessions running programs
  // whose Shells quitting ends besides, only the Closed ones on a plain quit, since the Open ones are on screen. A
  // restart, which anything can ask for, is always confirmed.
  function confirmQuit ({ restart, andEndShells }: { restart?: true; andEndShells?: true }) {
    const endShells = andEndShells || settings.shell.onQuit === 'end'
    const deleted = sessionsDeletedOnQuit()
    const named = (sessions: Session[]) =>
      sessions.toSorted(compareInCycleOrder).map((session) => ({ label: labelOf(session), programs: programsOf(session) }))
    const running = named(
      state.sessions.filter(
        (session) => !deleted.includes(session) && (andEndShells || session.status === 'closed')
      )
    ).filter((session) => session.programs.length > 0)
    const lists = {
      ...(deleted.length > 0 ? { deleted: named(deleted) } : {}),
      ...(endShells && running.length > 0 ? { [andEndShells ? 'running' : 'runningClosed']: running } : {}),
    }
    const options = endShells ? { endShells: true as const } : {}
    if (!restart && Object.keys(lists).length === 0) return emit({ type: 'saveForQuit', ...options })
    if (state.currentSessionId !== undefined) showAppIfHidden()
    emit({ type: 'confirmQuit', ...(restart ? { restart } : {}), ...options, ...lists })
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
    if (settings.session.cycleOrder === 'recent') return b.lastUsedAt - a.lastUsedAt
    if (settings.session.cycleOrder === 'created') return a.createdAt - b.createdAt
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

  // What Rename Tab offers: the focused Pane's Program Title when the tab.renameSuggestion setting takes it from the
  // running program, or else the Tab's title.
  function renameSuggestionOf (tab: Tab) {
    const pane = focusedPane(tab)
    const takesProgramTitle = settings.tab.renameSuggestion === 'all' || pane.runningProgram === claudeCodeProgram
    return (takesProgramTitle ? pane.programTitle : undefined) ?? titleOf(tab)
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
      activity: sessionShowsActivity(session),
      ...markerOf('session'),
    }
  }

  // The kind's marker, as a result's `marker`, while the commandPalette.kindMarkers setting shows them and the
  // commandPalette.nesting setting isn't hidden, searches included; else nothing.
  function markerOf (type: keyof typeof kindMarkers) {
    const shown = settings.commandPalette.kindMarkers && settings.commandPalette.nesting !== 'hidden'
    return shown ? { marker: kindMarkers[type] } : {}
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

  // The Current Pane's id, whether or not the app is on screen; absent without a Current Session.
  function currentPaneId () {
    const tab = state.currentSessionId === undefined ? undefined : focusedTabOf(state.currentSessionId)
    return tab?.focusedPaneId
  }

  function tabResults (tabs = tabsInScope('all')): PaletteResult[] {
    return tabs.map(({ session, tab }) => ({
      type: 'tab' as const,
      tabId: tab.id,
      label: titleOf(tab),
      sessionLabel: labelOf(session),
      current: isCurrentTab(session, tab),
      activity: tabHasActivity(tab),
      ...hiddenTabMark(tab),
      ...markerOf('tab'),
    }))
  }

  // A Hidden Tab's mark, as a result's or row's `hiddenTab`, for the Tab and each of its Panes; else nothing.
  function hiddenTabMark (tab: Tab) {
    return tab.hidden ? { hiddenTab: true as const } : {}
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
        activity: pane.id in activity,
        ...hiddenTabMark(tab),
        ...markerOf('pane'),
      }))
    )
  }

  // The Sessions that match the search, best first, the Open ones before the Closed ones unless the
  // commandPalette.sessionSearchOrder setting keeps them together.
  function searchSessions (search: string) {
    const found = searchResults(sessionResults(), search)
    if (settings.commandPalette.sessionSearchOrder === 'cycle') return found
    const isClosed = (result: PaletteResult) => result.type === 'session' && result.closed
    return [...found.filter((result) => !isClosed(result)), ...found.filter(isClosed)]
  }

  // What each prefix narrows the Command Palette to: the results that match the rest of the query, in the order they're
  // offered.
  const paletteScopes: Record<string, (search: string) => PaletteResult[]> = {
    'ss ': searchSessions,
    'tt ': (search) => searchResults(tabResults(tabsInScope(settings.commandPalette.tabSearchScope)), search),
    'pp ': (search) => searchResults(paneResults(tabsInScope(settings.commandPalette.paneSearchScope)), search),
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
    if (query === '' && settings.commandPalette.nesting === 'nested') return nestedResults()
    if (query === '' && settings.commandPalette.nesting === 'hidden') return [...sessionResults(), ...actionResults()]
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
      const tab = openTab(resolveStartDirectory(settings.tab.startDirectory, rootDirectory, rootDirectory ?? homeDirectory))
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

  // Makes the Tab's Session, when open, the Current Session with the Tab focused, showing it again if it's a Hidden Tab.
  function jumpToTab (tabId: TabId) {
    const session = state.sessions.find((candidate) => candidate.tabs.some((tab) => tab.id === tabId))
    if (session?.status !== 'open') return
    updateSession(session.id, (session) => {
      const updated = withTabShown(session, tabId)
      return updated.focusedTabId === tabId ? updated : { ...updated, focusedTabId: tabId }
    })
    makeCurrent(session.id)
  }

  // A Hidden Tab shown again goes where the hiddenTab.returnPosition setting says: after the other Tabs, as a new Tab
  // does, or back at its place.
  function withTabShown (session: Session, tabId: TabId): Session {
    const tab = session.tabs.find((candidate) => candidate.id === tabId)
    if (!tab?.hidden) return session
    const { hidden: _hidden, ...shownTab } = tab
    if (settings.hiddenTab.returnPosition === 'original') {
      return { ...session, tabs: withTabReplaced(session.tabs, tab, shownTab) }
    }
    return { ...session, tabs: [...session.tabs.filter((candidate) => candidate !== tab), shownTab] }
  }

  // Makes the Pane's Session, when open, the Current Session with the Pane and its Tab focused.
  function jumpToPane (paneId: PaneId) {
    const session = findSessionWithPane(paneId)
    if (session?.status !== 'open') return
    focusPaneInSession(session, paneId)
  }

  // As jumpToPane, reopening the Pane's Session first when it's closed.
  function jumpToPaneReopening (paneId: PaneId) {
    const closed = findSessionWithPane(paneId)
    if (closed?.status === 'closed') reopenSession(closed.id)
    jumpToPane(paneId)
  }

  function focusPaneInSession (session: Session, paneId: PaneId) {
    const tab = session.tabs.find((candidate) => hasPane(candidate, paneId))!
    updateSession(session.id, (session) => ({
      ...session,
      tabs: withTabReplaced(session.tabs, tab, withFocusedPane(tab, paneId)),
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
    return offeredActions(Object.keys(paletteActionLabels) as PaletteAction[]).map((action) => ({
      type: 'action',
      action,
      label: paletteActionLabels[action],
    }))
  }

  // Quit and End Shells is left out while quitting ends the Shells anyway.
  function offeredActions<Action extends PaletteAction> (actions: readonly Action[]) {
    return actions.filter((action) => action !== 'quitAndEndShells' || settings.shell.onQuit === 'keepRunning')
  }

  // A Closed Session's layout never changes while it's closed: a Pane whose Shell exits stays, for a fresh Shell when
  // it's reopened. A stopped Shell's Pane has already gone.
  function shellExited (paneId: PaneId) {
    const wasRunning = runningShells.delete(paneId)
    if (wasRunning && findSessionWithPane(paneId)?.status === 'open') removePaneFromSession(paneId)
  }

  // A Closed Session's Shells keep running and reporting as an Open Session's do. A stopped Shell can still report on
  // its way out, which changes nothing.
  function shellEventReceived (event: ShellEvent) {
    if (event.type === 'shellsLost') return shellsLost()
    if (event.type === 'shellExited') return shellExited(event.paneId)
    if (!runningShells.has(event.paneId)) return
    if (event.type === 'workingDirectoryChanged') {
      updatePane(event.paneId, (pane) => ({ ...pane, workingDirectory: event.workingDirectory }))
    }
    // The Program Title belongs to the program that set it.
    if (event.type === 'runningProgramChanged') {
      updatePane(event.paneId, ({ programTitle: _stopped, ...pane }) => ({
        ...pane,
        runningProgram: event.runningProgram,
      }))
    }
    // A title set while the Shell is idle is the Shell's own, such as a prompt theme's, not a program's. Claude Code
    // sets its title again each time its status glyph turns, which changes nothing here.
    if (event.type === 'titleChanged') {
      const pane = findPane(event.paneId)
      const programTitle = withoutStatusGlyph(event.title) || undefined
      if (pane?.runningProgram === undefined || programTitle === pane.programTitle) return
      updatePane(event.paneId, ({ programTitle: _replaced, ...unchanged }) =>
        programTitle === undefined ? unchanged : { ...unchanged, programTitle }
      )
    }
  }

  shellHost.subscribe(shellEventReceived)

  // The app actions on the Current Session, by the core's own commands.
  const sessionActions: Record<
    Exclude<PaletteAction, 'newSession' | 'resetCommandPalettePosition' | 'openSettings' | 'quit' | 'quitAndEndShells'>,
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
      if (tab) emit({ type: 'askTabTitle', sessionId, tabId: tab.id, suggestion: renameSuggestionOf(tab) })
    },
    clearTabTitle: (sessionId) => {
      const tab = focusedTabOf(sessionId)
      if (tab) core.clearTabTitle(tab.id)
    },
    hideTab: (sessionId) => core.hideTab(sessionId),
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
    toggleActivitySidebar: (sessionId) => emit({ type: 'toggleActivitySidebar', sessionId }),
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
    changeTheme: (sessionId) => emit({ type: 'pickTheme', sessionId }),
    importTheme: (sessionId) => emit({ type: 'pickThemeImport', sessionId }),
    changeMenuBarIcon: (sessionId) => emit({ type: 'pickMenuBarIcon', sessionId }),
    changeActivitySound: (sessionId) => emit({ type: 'pickActivitySound', sessionId }),
    showBuild: (sessionId) => emit({ type: 'pickBuild', sessionId }),
  }

  // Without a Session, only the actions that don't act on one run.
  function runAction (action: BoundAction, sessionId: SessionId | undefined) {
    if (action === 'newSession') return core.newSession()
    if (action === 'resetCommandPalettePosition') return emit({ type: 'resetPalettePosition' })
    if (action === 'openSettings') return emit({ type: 'openSettings' })
    if (action === 'quit') return core.quitRequested()
    if (action === 'quitAndEndShells') return core.quitAndEndShellsRequested()
    if (sessionId === undefined) return
    if (action === 'openCommandPalette') return emit({ type: 'openPalette', sessionId })
    if (action === 'copy' || action === 'paste') return emit({ type: action, sessionId })
    if (action.startsWith('focusTab')) return core.focusTab(sessionId, Number(action.slice('focusTab'.length)) - 1)
    sessionActions[action as keyof typeof sessionActions](sessionId)
  }

  const core: Core = {
    start: command(({ atLogin }: { atLogin: boolean }) => {
      appShown = !atLogin || settings.loginLaunch.start === 'shown'
      const saved = stateStore.load()
      if (saved) restore(saved)
      endShellsWithNoPane()
      // Started shown, the app needs a Session to show. Started hidden at login, it opens one for the Hotkey to show, or
      // leaves that to the Hotkey, as the setting says.
      const opensSession = appShown || settings.loginLaunch.withNoOpenSessions === 'new'
      if (opensSession && state.currentSessionId === undefined) addSession()
      return { shown: appShown }
    }),
    state: () => state,
    hotkeyPressed: command(() => {
      appShown = !appShown
      if (!appShown) return emit({ type: 'hideApp' })
      if (state.currentSessionId === undefined) addSession()
      emit({ type: 'showApp', sessionId: state.currentSessionId! })
    }),
    paletteDismissed: command(() => {
      themeImportToSave = undefined
      previewedTheme = undefined
      previewedMenuBarIcon = undefined
      applyThemeInEffect()
      applyMenuBarIconInEffect()
    }),
    focusLost: command(() => {
      if (!appShown) return
      appShown = false
      emit({ type: 'hideApp' })
    }),
    quitRequested: command(() => confirmQuit({})),
    quitAndEndShellsRequested: command(() => confirmQuit({ andEndShells: true })),
    restartRequested: command(() => confirmQuit({ restart: true })),
    quitConfirmed: command(({ endShells = settings.shell.onQuit === 'end' } = {}) => {
      deleteSessionsOnQuit()
      if (endShells) [...runningShells].forEach(stopShell)
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
      themeImportTarget = themeImportTargetFor(files, loaded)
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
    themeImportPicked: command((sessionId, source) => {
      const themeImport = importTheme(source, themeImportTarget)
      themeImportToSave = themeImport.type === 'ready' ? themeImport : undefined
      emit({ type: 'showThemeImport', sessionId, themeImport })
    }),
    themeImportSaved: command(() => {
      if (!themeImportToSave) return
      const { fileName, text } = themeImportToSave
      themeImportToSave = undefined
      emit({ type: 'writeThemeFile', fileName, text })
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
      closeWindow(sessionId)
    }),
    deleteRequested: command((sessionId) => {
      const session = findSession(sessionId)
      if (!session) return
      const programs = programsOf(session)
      emit({ type: 'confirmDelete', sessionId, ...(programs.length > 0 ? { programs } : {}) })
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
        resolveStartDirectory(settings.tab.startDirectory, session.rootDirectory, focusedPane(current).workingDirectory)
      )
      updateSession(sessionId, (session) => ({ ...session, tabs: [...session.tabs, tab], focusedTabId: tab.id }))
    }),
    splitPane: command((sessionId, direction) => {
      const rootDirectory = findSession(sessionId)?.rootDirectory
      updateFocusedTab(sessionId, (tab) => {
        const current = focusedPane(tab)
        const pane = openPane(resolveStartDirectory(settings.pane.startDirectory, rootDirectory, current.workingDirectory))
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
      const program = programRunningIn(focusedPane(tab))
      if (program !== undefined) return emit({ type: 'confirmClosePane', paneId: tab.focusedPaneId, program })
      closePaneNow(tab.focusedPaneId)
    }),
    closePaneConfirmed: command((paneId) => {
      if (findPane(paneId)) closePaneNow(paneId)
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
        const tab = shownTabs(session.tabs)[position]
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
    hideTab: command((sessionId) => {
      updateSession(sessionId, (session) => {
        const tab = focusedTab(session)
        if (!tab || shownTabs(session.tabs).length < 2) return session
        const tabs = withTabReplaced(session.tabs, tab, { ...tab, hidden: true })
        return { ...session, tabs, focusedTabId: shownTabTakingPlace(session, tabs).id }
      })
    }),
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
        actions: offeredActions(menuBarActions).map((action) => ({ action, label: paletteActionLabels[action] })),
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
    previewActivitySound: command((sound) => {
      if (activitySounds.includes(sound)) emit({ type: 'playActivitySound', sound })
    }),
    activitySoundResults (query) {
      const results = activitySounds.map((sound): PaletteResult => ({ type: 'activitySound', sound, label: sound }))
      return searchResults(results, query)
    },
    buildResults (query) {
      const results: PaletteResult[] = [
        { type: 'build', label: `Version: ${build.version}`, copies: build.version },
        { type: 'build', label: `Commit: ${shortSha(build.commit)}${build.dev ? ' (dev)' : ''}`, copies: build.commit },
      ]
      const blindSpotBuild = shellHost.blindSpotBuild()
      if (blindSpotBuild && blindSpotBuild.commit !== build.commit) {
        results.push(
          { type: 'build', label: `Blind Spot Version: ${blindSpotBuild.version}`, copies: blindSpotBuild.version },
          { type: 'build', label: `Blind Spot Commit: ${shortSha(blindSpotBuild.commit)}`, copies: blindSpotBuild.commit }
        )
      }
      return searchResults(results, query)
    },
    choosePaletteResult: command((result) => {
      if (result.type === 'session') jumpToSession(result.sessionId)
      if (result.type === 'tab') jumpToTab(result.tabId)
      if (result.type === 'pane') jumpToPane(result.paneId)
      if (result.type === 'action') runAction(result.action, state.currentSessionId)
      if (result.type === 'theme') chooseTheme(result.name)
      if (result.type === 'menuBarIcon') chooseMenuBarIcon(result.icon)
      if (result.type === 'activitySound') chooseActivitySound(result.sound)
      if (result.type === 'build' && state.currentSessionId !== undefined) {
        emit({ type: 'copyToClipboard', sessionId: state.currentSessionId, text: result.copies })
      }
    }),
    paneRects (tabId) {
      const tab = findTab(tabId)
      return tab ? paneRects(tab.layout) : []
    },
    scrollbackChanged (paneId, reported) {
      if (!findSessionWithPane(paneId)) return
      const text = capScrollback(reported, settings.pane.scrollbackLines)
      scrollback = { ...scrollback, [paneId]: { text, savedAt: clock.now() } }
      save()
    },
    scrollback: (paneId) => scrollback[paneId],
    linkTarget (paneId, text) {
      const pane = findPane(paneId)
      return pane && linkTarget(text, pane.workingDirectory, homeDirectory)
    },
    notificationReceived (paneId) {
      if (!canRaiseActivity(paneId)) return
      updatePaneActivity(paneId, (pane) => ({ ...pane, notified: true }))
    },
    // A report in a state that doesn't want the user drops the records it replaces.
    programStatusReported (paneId, report) {
      if (!wantsTheUser(report.state)) {
        const dropped = (record: string) => replaces(report, record)
        return updatePaneActivity(paneId, (pane) =>
          pane.records.some(dropped) ? { ...pane, records: pane.records.filter((record) => !dropped(record)) } : pane
        )
      }
      if (!canRaiseActivity(paneId)) return
      const { id } = report
      updatePaneActivity(paneId, (pane) => (pane.records.includes(id) ? pane : { ...pane, records: [...pane.records, id] }))
    },
    tabHasActivity (tabId) {
      const tab = findTab(tabId)
      return tab !== undefined && tabHasActivity(tab)
    },
    hiddenTabsWithActivity (sessionId) {
      return findSession(sessionId)?.tabs.filter((tab) => tab.hidden && tabHasActivity(tab)).length ?? 0
    },
    activityChips (sessionId) {
      const labels = sessionsInCycleOrder()
        .filter((session) => session.id !== sessionId && sessionShowsActivity(session))
        .map(shortLabelOf)
      return labels.length > maximumActivityChips ? [`${maximumActivityChips}+`] : labels
    },
    activitySidebarRows,
    activitySidebarPaneChosen: command(jumpToPaneReopening),
    onEffect (listener) {
      effectListeners.push(listener)
    },
    onStateChange (listener) {
      stateListeners.push(listener)
    },
  }
  return core
}
