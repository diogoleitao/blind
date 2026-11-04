import type { PaneId, TabId } from "../core/state";

export interface TerminalSize {
  cols: number;
  rows: number;
}

// What a Session's window draws: its Tabs, in order, each showing its one Pane.
export interface SessionView {
  tabs: { id: TabId; title: string; paneId: PaneId }[];
  focusedTabId?: TabId;
}

export const channels = {
  sessionView: "session:view",
  attachPane: "pane:attach",
  writeToPane: "pane:write",
  resizePane: "pane:resize",
  paneData: "pane:data",
} as const;

// What the preload script exposes to the renderer as `window.blind`.
export interface BlindApi {
  // Called once the page has loaded, and again whenever the Session changes.
  onSessionView(listener: (view: SessionView) => void): void;
  attachPane(paneId: PaneId, size: TerminalSize): Promise<void>;
  writeToPane(paneId: PaneId, data: string): void;
  resizePane(paneId: PaneId, size: TerminalSize): void;
  onPaneData(listener: (paneId: PaneId, data: string) => void): void;
}
