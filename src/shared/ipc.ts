import type { Effect, PaletteResult } from "../core/core";
import type { PaneRect } from "../core/layout";
import type { PaneId, TabId } from "../core/state";
import type { Theme } from "../core/themes";

export interface TerminalSize {
  cols: number;
  rows: number;
}

// What a Session's window draws: its Tabs, in order, each with where its Panes sit.
export interface SessionView {
  tabs: { id: TabId; title: string; panes: PaneRect[]; focusedPaneId: PaneId }[];
  focusedTabId?: TabId;
}

// The settings a window's terminals follow.
export interface TerminalSettings {
  scrollbackLines: number;
}

// What the Command Palette asks for in place of a search: a Session's name or a Tab's title.
export type PalettePrompt = Extract<Effect, { type: "askSessionName" | "askTabTitle" }>;

export const channels = {
  sessionView: "session:view",
  terminalSettings: "settings:terminal",
  focusPane: "pane:focus",
  attachPane: "pane:attach",
  writeToPane: "pane:write",
  resizePane: "pane:resize",
  paneData: "pane:data",
  reportScrollback: "pane:scrollback",
  flushScrollback: "scrollback:flush",
  scrollbackFlushed: "scrollback:flushed",
  openPalette: "palette:open",
  dismissPalette: "palette:dismiss",
  searchPalette: "palette:search",
  choosePaletteResult: "palette:choose",
  promptPalette: "palette:prompt",
  answerPalettePrompt: "palette:answer",
  applyTheme: "theme:apply",
  pickTheme: "theme:pick",
  searchThemes: "theme:search",
  previewTheme: "theme:preview",
  findInPane: "pane:find",
  clearScrollback: "pane:clear",
  copy: "clipboard:copy",
  copyText: "clipboard:write",
  paste: "clipboard:paste",
  openableLinks: "link:openable",
  openLink: "link:open",
} as const;

// What the preload script exposes to the renderer as `window.blind`.
export interface BlindApi {
  // Called once the page has loaded, and again whenever the Session changes.
  onSessionView(listener: (view: SessionView) => void): void;
  // Called once the page has loaded, before its Session view, and again whenever the config file changes them.
  onTerminalSettings(listener: (settings: TerminalSettings) => void): void;
  focusPane(paneId: PaneId): void;
  attachPane(paneId: PaneId, size: TerminalSize): Promise<void>;
  writeToPane(paneId: PaneId, data: string): void;
  resizePane(paneId: PaneId, size: TerminalSize): void;
  onPaneData(listener: (paneId: PaneId, data: string) => void): void;
  // Sends a Pane's serialized terminal, for Restore.
  reportScrollback(paneId: PaneId, scrollback: string): void;
  // Called before the app quits. The listener reports every Pane's scrollback before it returns.
  onFlushScrollback(listener: () => void): void;
  // Called when the Command Palette's shortcut asks for it, or when the app shows it on its own.
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
