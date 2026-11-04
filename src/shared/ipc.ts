import type { PaneId } from "../core/state";

export interface TerminalSize {
  cols: number;
  rows: number;
}

export const channels = {
  sessionPane: "session:pane",
  attachPane: "pane:attach",
  writeToPane: "pane:write",
  resizePane: "pane:resize",
  paneData: "pane:data",
} as const;

// What the preload script exposes to the renderer as `window.blind`.
export interface BlindApi {
  sessionPane(): Promise<PaneId | undefined>;
  attachPane(paneId: PaneId, size: TerminalSize): Promise<void>;
  writeToPane(paneId: PaneId, data: string): void;
  resizePane(paneId: PaneId, size: TerminalSize): void;
  onPaneData(listener: (paneId: PaneId, data: string) => void): void;
}
