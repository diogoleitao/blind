import type { Effect, PaletteResult } from "../core/core";
import type { PaneRect } from "../core/layout";
import type { PaneId, TabId } from "../core/state";

export interface TerminalSize {
  cols: number;
  rows: number;
}

// What a Session's window draws: its Tabs, in order, each with where its Panes sit.
export interface SessionView {
  tabs: { id: TabId; title: string; panes: PaneRect[]; focusedPaneId: PaneId }[];
  focusedTabId?: TabId;
}

// What the Command Palette asks for in place of a search: a Session's name or a Tab's title.
export type PalettePrompt = Extract<Effect, { type: "askSessionName" | "askTabTitle" }>;

export const channels = {
  sessionView: "session:view",
  focusPane: "pane:focus",
  attachPane: "pane:attach",
  writeToPane: "pane:write",
  resizePane: "pane:resize",
  paneData: "pane:data",
  reportScrollback: "pane:scrollback",
  flushScrollback: "scrollback:flush",
  scrollbackFlushed: "scrollback:flushed",
  openPalette: "palette:open",
  searchPalette: "palette:search",
  choosePaletteResult: "palette:choose",
  promptPalette: "palette:prompt",
  answerPalettePrompt: "palette:answer",
} as const;

// What the preload script exposes to the renderer as `window.blind`.
export interface BlindApi {
  // Called once the page has loaded, and again whenever the Session changes.
  onSessionView(listener: (view: SessionView) => void): void;
  focusPane(paneId: PaneId): void;
  attachPane(paneId: PaneId, size: TerminalSize): Promise<void>;
  writeToPane(paneId: PaneId, data: string): void;
  resizePane(paneId: PaneId, size: TerminalSize): void;
  onPaneData(listener: (paneId: PaneId, data: string) => void): void;
  // Sends a Pane's serialized terminal, for Restore.
  reportScrollback(paneId: PaneId, scrollback: string): void;
  // Called before the app quits. The listener reports every Pane's scrollback before it returns.
  onFlushScrollback(listener: () => void): void;
  // Called when Cmd+K asks for the Command Palette.
  onOpenPalette(listener: () => void): void;
  searchPalette(query: string): Promise<PaletteResult[]>;
  choosePaletteResult(result: PaletteResult): void;
  // Called when an app action needs a name or title typed into the Command Palette.
  onPalettePrompt(listener: (prompt: PalettePrompt) => void): void;
  answerPalettePrompt(prompt: PalettePrompt, answer: string): void;
}
