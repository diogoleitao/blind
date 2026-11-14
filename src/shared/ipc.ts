import type { ProgramStatusReport } from '../core/attention'
import type { MenuBarIcon, PanePadding, PaneScrollBar, SessionLabelPosition } from '../core/config'
import type { Effect, PaletteResult } from '../core/core'
import type { PaneRect } from '../core/layout'
import type { PaneId, TabId } from '../core/state'
import type { Theme } from '../core/themes'

export interface TerminalSize {
  cols: number;
  rows: number;
}

// What a Session's window draws: the Session's label, followed by the chips naming the other Sessions with Activity,
// and its Tabs, in order, each with where its Panes sit and whether it has Activity.
export interface SessionView {
  sessionLabel: string;
  activityChips: string[];
  tabs: { id: TabId; title: string; panes: PaneRect[]; focusedPaneId: PaneId; activity: boolean }[];
  focusedTabId?: TabId;
}

// The settings a window follows: its terminals' scrollback, where its Tab bar shows the Session's label, whether its
// Panes are padded and show a scroll bar, and how transparent its background is.
export interface WindowSettings {
  scrollbackLines: number;
  sessionLabelPosition: SessionLabelPosition;
  panePadding: PanePadding;
  paneScrollBar: PaneScrollBar;
  backgroundTransparency: number;
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
  flushScrollback: 'scrollback:flush',
  scrollbackFlushed: 'scrollback:flushed',
  openPalette: 'palette:open',
  dismissPalette: 'palette:dismiss',
  searchPalette: 'palette:search',
  choosePaletteResult: 'palette:choose',
  promptPalette: 'palette:prompt',
  answerPalettePrompt: 'palette:answer',
  applyTheme: 'theme:apply',
  pickTheme: 'theme:pick',
  searchThemes: 'theme:search',
  previewTheme: 'theme:preview',
  pickMenuBarIcon: 'menuBarIcon:pick',
  searchMenuBarIcons: 'menuBarIcon:search',
  previewMenuBarIcon: 'menuBarIcon:preview',
  findInPane: 'pane:find',
  clearScrollback: 'pane:clear',
  copy: 'clipboard:copy',
  copyText: 'clipboard:write',
  paste: 'clipboard:paste',
  openableLinks: 'link:openable',
  openLink: 'link:open',
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
  // Called when the Pane's scrollback should be searched.
  onFindInPane(listener: (paneId: PaneId) => void): void;
  // Called when the Pane's scrollback should be cleared.
  onClearScrollback(listener: (paneId: PaneId) => void): void;
  // Called when what is selected should be copied, which the listener sends to `copyText`.
  onCopy(listener: () => void): void;
  // Puts the text on the clipboard.
  copyText(text: string): void;
  // Called with the clipboard's text when it should be pasted.
  onPaste(listener: (text: string) => void): void;
  // Answers, for each link found in the Pane's terminal, whether Cmd+clicking it opens something: a URL, or a path to a
  // file or folder that exists.
  openableLinks(paneId: PaneId, texts: string[]): Promise<boolean[]>;
  // Opens a URL in the default browser, or a path with its default app.
  openLink(paneId: PaneId, text: string): void;
}
