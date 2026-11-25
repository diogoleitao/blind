import type { ActivitySidebarRow } from '../core/activity-sidebar'
import type { ProgramStatusReport } from '../core/attention'
import type { ActivitySound, MenuBarIcon, Settings } from '../core/config'
import type { Effect, PaletteResult } from '../core/core'
import type { PaneRect } from '../core/layout'
import type { PaneId, TabId } from '../core/state'
import type { ThemeImport } from '../core/theme-import'
import type { Theme } from '../core/themes'
import type { QuitPrompt } from './quit-prompt'

export interface TerminalSize {
  cols: number;
  rows: number;
}

// What a Session's window draws: the Session's label, followed by the chips naming the other Sessions with Activity,
// its Tabs, in order, each with where its Panes sit and whether it has Activity, and what its Activity Sidebar lists.
export interface SessionView {
  sessionLabel: string;
  activityChips: string[];
  // Every Tab, Hidden Tabs included, so their terminals stay open; the Tab bar shows only the others.
  tabs: { id: TabId; title: string; panes: PaneRect[]; focusedPaneId: PaneId; activity: boolean; hidden: boolean }[];
  focusedTabId?: TabId;
  hiddenTabsWithActivity: number;
  activitySidebar: ActivitySidebarRow[];
}

// The settings a window follows: its terminals' scrollback, whether its Panes are padded and show a scroll bar, how
// transparent its background is, and which side its Activity Sidebar slides over.
export interface WindowSettings {
  pane: Pick<Settings['pane'], 'scrollbackLines' | 'padding' | 'scrollBar'>;
  background: Pick<Settings['background'], 'transparency'>;
  activitySidebar: Settings['activitySidebar'];
}

// What the Command Palette asks for in place of a search: a Session's name or a Tab's title.
export type PalettePrompt = Extract<Effect, { type: 'askSessionName' | 'askTabTitle' }>

export const channels = {
  sessionView: 'session:view',
  windowSettings: 'settings:window',
  showSessionBanner: 'session:banner',
  focusPane: 'pane:focus',
  attachPane: 'pane:attach',
  writeToPane: 'pane:write',
  resizePane: 'pane:resize',
  paneData: 'pane:data',
  reportScrollback: 'pane:scrollback',
  reportNotification: 'pane:notification',
  reportProgramStatus: 'pane:status',
  reportTitle: 'pane:title',
  flushScrollback: 'scrollback:flush',
  scrollbackFlushed: 'scrollback:flushed',
  openPalette: 'palette:open',
  dismissPalette: 'palette:dismiss',
  searchPalette: 'palette:search',
  choosePaletteResult: 'palette:choose',
  promptPalette: 'palette:prompt',
  answerPalettePrompt: 'palette:answer',
  palettePosition: 'palette:position',
  movePalette: 'palette:move',
  toggleActivitySidebar: 'activitySidebar:toggle',
  chooseActivitySidebarPane: 'activitySidebar:choose',
  applyTheme: 'theme:apply',
  pickTheme: 'theme:pick',
  searchThemes: 'theme:search',
  previewTheme: 'theme:preview',
  pickMenuBarIcon: 'menuBarIcon:pick',
  searchMenuBarIcons: 'menuBarIcon:search',
  previewMenuBarIcon: 'menuBarIcon:preview',
  pickActivitySound: 'activitySound:pick',
  searchActivitySounds: 'activitySound:search',
  previewActivitySound: 'activitySound:preview',
  pickBuild: 'build:pick',
  searchBuild: 'build:search',
  showThemeImport: 'themeImport:show',
  saveThemeImport: 'themeImport:save',
  findInPane: 'pane:find',
  clearScrollback: 'pane:clear',
  copy: 'clipboard:copy',
  copyText: 'clipboard:write',
  showCopyBanner: 'clipboard:banner',
  paste: 'clipboard:paste',
  openableLinks: 'link:openable',
  openLink: 'link:open',
  askQuit: 'quit:ask',
  answerQuit: 'quit:answer',
} as const

// What the preload script exposes to the renderer as `window.blind`.
export interface BlindApi {
  // Called once the page has loaded, and again whenever the Session changes.
  onSessionView(listener: (view: SessionView) => void): void;
  // Called once the page has loaded, before its Session view, and again whenever the config file changes them.
  onWindowSettings(listener: (settings: WindowSettings) => void): void;
  // Called with the Session's label when cycling has just swapped this window in, to show the Session Banner.
  onShowSessionBanner(listener: (label: string) => void): void;
  focusPane(paneId: PaneId): void;
  attachPane(paneId: PaneId, size: TerminalSize): Promise<void>;
  writeToPane(paneId: PaneId, data: string): void;
  resizePane(paneId: PaneId, size: TerminalSize): void;
  onPaneData(listener: (paneId: PaneId, data: string) => void): void;
  // Sends a Pane's serialized terminal, for Restore.
  reportScrollback(paneId: PaneId, scrollback: string): void;
  // A program in the Pane sent a desktop notification.
  reportNotification(paneId: PaneId): void;
  // A program in the Pane reported one of its status records.
  reportProgramStatus(paneId: PaneId, report: ProgramStatusReport): void;
  // The Pane's program, or its Shell, set a title with OSC 0 or 2.
  reportTitle(paneId: PaneId, title: string): void;
  // Called before the app quits. The listener reports every Pane's scrollback before it returns.
  onFlushScrollback(listener: () => void): void;
  // Called when the Command Palette's shortcut asks for it.
  onOpenPalette(listener: () => void): void;
  // The Command Palette closed without a choice.
  dismissPalette(): void;
  searchPalette(query: string): Promise<PaletteResult[]>;
  choosePaletteResult(result: PaletteResult): void;
  // Called when an app action needs a name or title typed into the Command Palette.
  onPalettePrompt(listener: (prompt: PalettePrompt) => void): void;
  answerPalettePrompt(prompt: PalettePrompt, answer: string): void;
  // Called with the Command Palette's position once the page has loaded, and again whenever the user drags it in any
  // window or resets it.
  onPalettePosition(listener: (position: number) => void): void;
  // The user dragged the Command Palette to the position.
  movePalette(position: number): void;
  // Called when the Activity Sidebar's shortcut, or its Command Palette action, asks for it to open or close.
  onToggleActivitySidebar(listener: () => void): void;
  // A row of the Activity Sidebar was chosen, standing for the Pane.
  chooseActivitySidebarPane(paneId: PaneId): void;
  // Called once the page has loaded, before its Session view, and again whenever the Theme in effect changes.
  onTheme(listener: (theme: Theme) => void): void;
  // Called when the Command Palette should list the Themes instead of searching.
  onPickTheme(listener: () => void): void;
  searchThemes(query: string): Promise<PaletteResult[]>;
  // The Theme the Command Palette's selection moved to.
  previewTheme(name: string): void;
  // Called with the icon in effect when the Command Palette should list the menu bar icons instead of searching.
  onPickMenuBarIcon(listener: (icon: MenuBarIcon) => void): void;
  searchMenuBarIcons(query: string): Promise<PaletteResult[]>;
  // The menu bar icon the Command Palette's selection moved to.
  previewMenuBarIcon(icon: MenuBarIcon): void;
  // Called with the sound the activity.sound setting names when the Command Palette should list the Activity sounds
  // instead of searching.
  onPickActivitySound(listener: (sound: ActivitySound) => void): void;
  searchActivitySounds(query: string): Promise<PaletteResult[]>;
  // The Activity sound the Command Palette's selection moved to.
  previewActivitySound(sound: ActivitySound): void;
  // Called when the Command Palette should list the Build instead of searching.
  onPickBuild(listener: () => void): void;
  searchBuild(query: string): Promise<PaletteResult[]>;
  // Called when the Command Palette should show the Theme file an Import makes, to be saved, or why it was refused.
  onShowThemeImport(listener: (themeImport: ThemeImport) => void): void;
  // Saves the Theme file the Command Palette showed.
  saveThemeImport(): void;
  // Called when the Pane's scrollback should be searched.
  onFindInPane(listener: (paneId: PaneId) => void): void;
  // Called when the Pane's scrollback should be cleared.
  onClearScrollback(listener: (paneId: PaneId) => void): void;
  // Called when what is selected should be copied, which the listener sends to `copyText`.
  onCopy(listener: () => void): void;
  // Puts the text on the clipboard.
  copyText(text: string): void;
  // Called when the Command Palette has copied something, to show the Copy Banner.
  onShowCopyBanner(listener: () => void): void;
  // Called with the clipboard's text when it should be pasted.
  onPaste(listener: (text: string) => void): void;
  // Answers, for each link found in the Pane's terminal, whether Cmd+clicking it opens something: a URL, or a path to a
  // file or folder that exists.
  openableLinks(paneId: PaneId, texts: string[]): Promise<boolean[]>;
  // Opens a URL in the default browser, or a path with its default app.
  openLink(paneId: PaneId, text: string): void;
  // Called when the window should ask whether to quit, which the listener answers with `answerQuit`.
  onAskQuit(listener: (asked: QuitPrompt) => void): void;
  answerQuit(confirmed: boolean): void;
}
